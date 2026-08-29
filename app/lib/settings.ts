/**
 * Server-backed settings.
 *
 * One KV row per logical setting in `app_setting`, value held as JSON text, so
 * adding a setting is never a migration. The typed object is assembled here
 * with read-time coercion: a row whose stored value has the wrong shape falls
 * back to its declared default rather than propagating a bad value.
 */
import appSettingSchema from "../../migrations/0002_app_setting.sql?raw";
import type { Database } from "./db.ts";
import { createSchemaRunner } from "./sql.ts";

/**
 * The providers the app can drive.
 *
 * Not a base-URL difference — the two speak different wire protocols, so each
 * has its own client in `app/api/diagnose/providers.ts`. Decided 2026-08-04:
 * the catalog carries the provider, so a model id resolves to its own client.
 */
export const PROVIDERS = ["huggingface", "anthropic"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  huggingface: "Hugging Face",
  anthropic: "Anthropic",
};

/**
 * Models the app is allowed to drive.
 *
 * `activeModel` reaches a billable external call, so it is validated against
 * this catalog on write. An arbitrary id must never be persistable — that is
 * the difference between a settings row and an open door onto paid inference.
 * Vision capability matters: the intake accepts photos.
 *
 * The `provider` field is what selects the client, so an id alone is no longer
 * enough to place a call — everything downstream looks the entry up here.
 */
export type CatalogEntry = {
  id: string;
  label: string;
  vision: boolean;
  provider: ProviderId;
};

export const MODEL_CATALOG: readonly CatalogEntry[] = [
  // Anthropic. Vision on all three; ids carry no date suffix by design.
  { id: "claude-opus-5", label: "Claude Opus 5 (vision)", vision: true, provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (vision)", vision: true, provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (vision)", vision: true, provider: "anthropic" },

  // Hugging Face router.
  { id: "Qwen/Qwen3-VL-30B-A3B-Instruct", label: "Qwen3-VL 30B (vision)", vision: true, provider: "huggingface" },
  { id: "Qwen/Qwen2.5-VL-72B-Instruct", label: "Qwen2.5-VL 72B (vision)", vision: true, provider: "huggingface" },
  { id: "meta-llama/Llama-3.2-11B-Vision-Instruct", label: "Llama 3.2 11B (vision)", vision: true, provider: "huggingface" },
  { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen2.5 7B (text only)", vision: false, provider: "huggingface" },
];

/**
 * The provider that owns a model id.
 *
 * Falls back to `huggingface` for an id that is not in the catalog, which is
 * exactly the `HF_MODEL` env-default case: that value is deliberately *not*
 * catalog-checked, because it is set by whoever runs the server rather than
 * over HTTP.
 */
export function providerFor(modelId: string): ProviderId {
  return MODEL_CATALOG.find((entry) => entry.id === modelId)?.provider ?? "huggingface";
}

export type AppSettings = {
  /** Overrides HF_MODEL when set. Empty string means "use the env default". */
  activeModel: string;
  /** Hard ceiling on photos per case, never above the transport limit. */
  maxPhotos: number;
  /**
   * Tokens one case may spend before the next call is refused — the app's only
   * spend guard. Nothing else stops an interview that never converges from
   * running up the provider bill in a tab nobody is watching. 0 disables it.
   */
  perCaseTokenCeiling: number;
};

export const SETTINGS_DEFAULTS: AppSettings = {
  // Anthropic is the primary provider. Sonnet rather than Opus because a
  // measured Opus 5 report ran 5m29s; it can be switched in Settings. Empty
  // string still means "fall back to HF_MODEL".
  activeModel: "claude-sonnet-5",
  maxPhotos: 4,
  // Sized above a normal case and below a runaway one: the report alone has a
  // 32k completion ceiling, and a long interview adds turns on top. A case that
  // passes 400k has stopped converging. This is an ESTIMATE — no Opus report
  // has been token-measured, so it is sized from the completion ceiling plus
  // interview overhead rather than from a bill. Re-derive it from llm_telemetry
  // once real data exists.
  perCaseTokenCeiling: 400_000,
};

type Coercion<K extends keyof AppSettings> = (value: unknown) => AppSettings[K] | undefined;

const COERCIONS: { [K in keyof AppSettings]: Coercion<K> } = {
  activeModel: (value) => {
    if (typeof value !== "string") return undefined;
    if (value === "") return "";
    return MODEL_CATALOG.some((model) => model.id === value) ? value : undefined;
  },
  maxPhotos: (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4
      ? value
      : undefined,
  perCaseTokenCeiling: (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000
      ? value
      : undefined,
};

const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof AppSettings>;

export const ensureSettingsSchema = createSchemaRunner(appSettingSchema);

export async function getSettings(db: Database): Promise<AppSettings> {
  await ensureSettingsSchema(db);
  const result = await db.prepare("SELECT key, value FROM app_setting").all<{
    key: string;
    value: string;
  }>();

  const settings: AppSettings = { ...SETTINGS_DEFAULTS };
  for (const row of result.results ?? []) {
    if (!SETTING_KEYS.includes(row.key as keyof AppSettings)) continue;
    const key = row.key as keyof AppSettings;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    const coerced = (COERCIONS[key] as Coercion<typeof key>)(parsed);
    if (coerced !== undefined) {
      (settings[key] as AppSettings[typeof key]) = coerced;
    }
  }
  return settings;
}

export type SettingsPatchResult =
  | { ok: true; changed: Array<keyof AppSettings> }
  | { ok: false; error: string };

/**
 * Validate and persist a partial patch.
 *
 * Validation is a real guard, not decoration: an out-of-catalog model or an
 * out-of-range photo cap is a 400 and nothing is written, including the keys in
 * the same patch that were individually valid.
 */
export async function applySettingsPatch(
  db: Database,
  patch: Record<string, unknown>,
): Promise<SettingsPatchResult> {
  await ensureSettingsSchema(db);

  const writes: Array<{ key: keyof AppSettings; value: unknown }> = [];

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(rawKey as keyof AppSettings)) {
      return { ok: false, error: `Unknown setting: ${rawKey}` };
    }
    const key = rawKey as keyof AppSettings;
    const coerced = (COERCIONS[key] as Coercion<typeof key>)(rawValue);
    if (coerced === undefined) {
      return {
        ok: false,
        error:
          key === "activeModel"
            ? "That model is not in the approved catalog."
            : `Invalid value for ${key}.`,
      };
    }
    writes.push({ key, value: coerced });
  }

  if (!writes.length) return { ok: true, changed: [] };

  const timestamp = new Date().toISOString();
  await db.batch(
    writes.map(({ key, value }) =>
      db
        .prepare(
          `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, JSON.stringify(value), timestamp),
    ),
  );

  return { ok: true, changed: writes.map((write) => write.key) };
}
