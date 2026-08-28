import { env } from "../../lib/server-env.ts";
import { clientIp } from "../../lib/auth/cookies.ts";
import { currentUser, jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { recordAuthEvent } from "../../lib/auth/store.ts";
import { MODEL_CATALOG, PROVIDERS, applySettingsPatch, getSettings } from "../../lib/settings.ts";
import { providerConfigured } from "../diagnose/providers.ts";

/**
 * Which providers have credentials, as booleans.
 *
 * Deliberately not a masked prefix or a key length: an admin needs to know
 * *whether* a provider will work, and nothing about the secret itself should
 * cross the wire. `HF_TOKEN` and `ANTHROPIC_API_KEY` are billable.
 *
 */
const providerStatus = () =>
  Object.fromEntries(PROVIDERS.map((provider) => [provider, providerConfigured(provider)]));

/** Readable by any signed-in user; the gate rejects anonymous callers. */
export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Settings storage is not configured on the server.", 500);
  return jsonResponse({
    settings: await getSettings(db),
    catalog: MODEL_CATALOG,
    providers: providerStatus(),
  });
}

/** Admin-only — enforced in the gate (`isAdminWrite`), not here. */
export async function PUT(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Settings storage is not configured on the server.", 500);

  let patch: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("Send an object of settings to change.", 400);
    }
    patch = body as Record<string, unknown>;
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const result = await applySettingsPatch(db, patch);
  if (!result.ok) return jsonError(result.error, 400);

  if (result.changed.length && env.AUTH_DB) {
    const actor = await currentUser(request);
    await recordAuthEvent(
      env.AUTH_DB,
      "settings.updated",
      actor?.email ?? null,
      clientIp(request),
      result.changed.join(", "),
    );
  }

  return jsonResponse({
    settings: await getSettings(db),
    catalog: MODEL_CATALOG,
    providers: providerStatus(),
  });
}
