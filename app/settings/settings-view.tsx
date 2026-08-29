"use client";

import Link from "next/link";
import { LogoMark } from "../components/logo.tsx";
import { FormEvent, useEffect, useState } from "react";
import { CollapsibleCard } from "../components/collapsible-card";
import {
  EMPTY_MACHINE,
  clearDefaultMachine,
  saveDefaultMachine,
  useDefaultMachine,
  type DefaultMachine,
} from "../lib/prefs.ts";
import { requestJson } from "../lib/request.ts";
import {
  DEFAULT_MARKET,
  MACHINE_TYPES,
  MANUFACTURERS,
  modelsForMake,
  parseModelYear,
} from "../lib/equipment-catalog.ts";
import { ComboField } from "../components/combobox.tsx";

type ProviderId = "huggingface" | "anthropic";
type CatalogEntry = { id: string; label: string; vision: boolean; provider: ProviderId };
type Settings = {
  activeModel: string;
  maxPhotos: number;
  perCaseTokenCeiling: number;
};
/** What GET and PUT on `/api/settings` both answer with. */
type SettingsPayload = {
  settings?: Settings;
  catalog?: CatalogEntry[];
  providers?: Partial<Record<ProviderId, boolean>>;
};
type Usage = { monthTokens: number };

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  huggingface: "Hugging Face",
};

/** The env var an operator has to set to make a provider usable. */
const PROVIDER_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  huggingface: "HF_TOKEN",
};

/**
 * Shown when the page could not read its own settings.
 *
 * Used twice on purpose: as the fallback wording when the server refuses
 * without saying why, and as the state of the card body, which would otherwise
 * sit on "Loading…" forever with the reason only visible at the top of the page.
 */
const LOAD_FAILED = "Could not load settings.";

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [providers, setProviders] = useState<Partial<Record<ProviderId, boolean>>>({});
  // Defaults null, not a zeroed Usage: a failed or in-flight load has to read
  // as "not known yet" rather than as a month with no spend in it.
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<NumericKey, string>>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const loaded = await requestJson<SettingsPayload>(
        "/api/settings",
        undefined,
        LOAD_FAILED,
      );
      if (!loaded.ok) {
        setError(loaded.message);
        return;
      }
      setSettings(loaded.data.settings ?? null);
      setCatalog(loaded.data.catalog ?? []);
      setProviders(loaded.data.providers ?? {});
      // Month-to-date spend. A failure here is reported next to the figure
      // rather than at the top of the page: it is informational, nothing is
      // blocked by it, and the settings above still saved fine.
      const spend = await requestJson<Usage>(
        "/api/usage",
        undefined,
        "This month's token spend could not be loaded.",
      );
      if (spend.ok) setUsage(spend.data);
      else setUsageError(spend.message);
    })();
  }, []);

  /** Saves one change and reports whether it stuck, so a rejected draft is kept. */
  async function patch(change: Partial<Settings>): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    const saved = await requestJson<SettingsPayload>(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      },
      "That change was rejected.",
    );
    setBusy(false);
    if (!saved.ok) {
      setError(saved.message);
      return false;
    }
    setSettings(saved.data.settings ?? null);
    setNotice("Saved.");
    return true;
  }

  return (
    <main className="settings-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Settings</h1>
          <p>How this install runs, and what it has cost</p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      <CollapsibleCard
        collapseKey="diagnostics"
        title="Diagnostic engine"
        subtitle="Stored on the server; applies to every browser"
        badge="Server"
      >
        {!settings ? (
          <p className="small">{error ? LOAD_FAILED : "Loading…"}</p>
        ) : (
          <div className="settings-rows">
            <label className="field">
              <span>Active model</span>
              <select
                value={settings.activeModel}
                disabled={busy}
                onChange={(event) => void patch({ activeModel: event.target.value })}
              >
                <option value="">Server default (HF_MODEL)</option>
                {providerGroups(catalog).map(([provider, entries]) => (
                  <optgroup
                    key={provider}
                    label={
                      providers[provider] === false
                        ? `${PROVIDER_LABELS[provider]} — not configured`
                        : PROVIDER_LABELS[provider]
                    }
                  >
                    {entries.map((entry) => (
                      // Left selectable when unconfigured: the key and the
                      // model can be set in either order, and the status line
                      // below says plainly what is missing.
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <small>
                Only models in the approved catalog can be selected. Photo intake needs a
                vision-capable model.
              </small>
              <ProviderStatus providers={providers} activeModel={settings.activeModel} catalog={catalog} />
            </label>

            <label className="field">
              <span>Maximum photos per case</span>
              <select
                value={String(settings.maxPhotos)}
                disabled={busy}
                onChange={(event) => void patch({ maxPhotos: Number(event.target.value) })}
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
              <small>Each photo is re-sent with the report request, so this drives cost.</small>
            </label>

            <NumberSetting
              label="Token ceiling per diagnosis"
              settingKey="perCaseTokenCeiling"
              settings={settings}
              drafts={drafts}
              setDrafts={setDrafts}
              busy={busy}
              patch={patch}
              hint="The only spend limit in the app. An interview that never converges keeps
                    calling the model for as long as the tab is open; this ends it. 0 disables
                    the guard entirely."
            />

            <small role="status">
              {usage
                ? `${usage.monthTokens.toLocaleString()} tokens spent this month.`
                : usageError || "Loading this month's spend…"}
            </small>
          </div>
        )}
      </CollapsibleCard>

      <DefaultMachineCard />
    </main>
  );
}

/** Catalog order decides group order, so the list stays stable across reloads. */
function providerGroups(catalog: CatalogEntry[]): Array<[ProviderId, CatalogEntry[]]> {
  const groups = new Map<ProviderId, CatalogEntry[]>();
  for (const entry of catalog) {
    const existing = groups.get(entry.provider);
    if (existing) existing.push(entry);
    else groups.set(entry.provider, [entry]);
  }
  return [...groups];
}

/**
 * Says whether the selected model can actually be called.
 *
 * Booleans only — the server never sends key material, not even a masked
 * prefix, so this can name the missing env var but never its value.
 */
function ProviderStatus({
  providers,
  activeModel,
  catalog,
}: {
  providers: Partial<Record<ProviderId, boolean>>;
  activeModel: string;
  catalog: CatalogEntry[];
}) {
  const missing = (Object.keys(PROVIDER_LABELS) as ProviderId[]).filter(
    (provider) => providers[provider] === false,
  );
  const selected = catalog.find((entry) => entry.id === activeModel);

  if (selected && providers[selected.provider] === false) {
    return (
      <small className="field-warning" role="status">
        {PROVIDER_LABELS[selected.provider]} has no credentials on this server, so this model
        will fail at request time. Set <code>{PROVIDER_ENV[selected.provider]}</code> and restart.
      </small>
    );
  }
  if (!missing.length) return null;
  return (
    <small className="field-warning" role="status">
      Not configured on this server:{" "}
      {missing.map((provider) => `${PROVIDER_LABELS[provider]} (${PROVIDER_ENV[provider]})`).join(", ")}.
    </small>
  );
}

/** Settings whose value is a free number and needs an explicit commit. */
type NumericKey = "perCaseTokenCeiling";

/**
 * A number field that saves on a button, not on a keystroke.
 *
 * Patching every keystroke would spam writes the server rejects — "50" is not a
 * valid cap on the way to "500000". The Save button appears only once the draft
 * differs from what is stored.
 */
function NumberSetting({
  label,
  settingKey,
  settings,
  drafts,
  setDrafts,
  busy,
  patch,
  hint,
}: {
  label: string;
  settingKey: NumericKey;
  settings: Settings;
  drafts: Partial<Record<NumericKey, string>>;
  setDrafts: React.Dispatch<React.SetStateAction<Partial<Record<NumericKey, string>>>>;
  busy: boolean;
  patch: (change: Partial<Settings>) => Promise<boolean>;
  hint: string;
}) {
  const stored = String(settings[settingKey]);
  const draft = drafts[settingKey];
  const dirty = draft !== undefined && draft !== stored;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="budget-row">
        <input
          inputMode="numeric"
          value={draft ?? stored}
          disabled={busy}
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [settingKey]: event.target.value.replace(/[^\d]/g, ""),
            }))
          }
        />
        {dirty && (
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => {
              // Only a save that stuck clears the draft. Dropping it on a
              // refusal would snap the input back to the stored number and
              // throw away what the operator typed, right next to the line
              // explaining why they should try again.
              void patch({ [settingKey]: Number(draft) } as Partial<Settings>).then((saved) => {
                if (saved) setDrafts((current) => ({ ...current, [settingKey]: undefined }));
              });
            }}
          >
            Save
          </button>
        )}
      </div>
      <small>{hint}</small>
    </label>
  );
}

function DefaultMachineCard() {
  const stored = useDefaultMachine();
  // Null means "not edited yet", so the stored value shows through without an
  // effect copying it into state on every change.
  const [draft, setDraft] = useState<DefaultMachine | null>(null);
  const [saved, setSaved] = useState(false);
  const value = draft ?? stored;
  const modelOptions = modelsForMake(value.make, parseModelYear(value.year));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveDefaultMachine({ ...value, market: DEFAULT_MARKET });
    setDraft(null);
    setSaved(true);
  }

  const update = (field: keyof DefaultMachine, fieldValue: string) =>
    setDraft({ ...value, [field]: fieldValue });

  return (
    <CollapsibleCard
      collapseKey="default-machine"
      title="Default machine"
      subtitle="Prefills the intake form on this browser"
      badge="This device"
    >
      <form className="settings-rows" onSubmit={submit}>
        {/* Same suggestion lists as the intake form; still free text. */}
        <div className="field-grid">
          <label className="field">
            <span>Year</span>
            <input value={value.year} onChange={(e) => update("year", e.target.value)} placeholder="2014" />
          </label>
          {/* Picking a make from the list invalidates any typed model. Typing
              one character of a make does not — that used to wipe a model on
              every keystroke in the inventory and spec-lookup views. */}
          <ComboField
            label="Make"
            options={MANUFACTURERS}
            value={value.make}
            onChange={(next) => update("make", next)}
            onSelect={(next) => setDraft({ ...value, make: next, model: "" })}
            placeholder="John Deere"
          />
          <ComboField
            label="Model"
            options={modelOptions}
            value={value.model}
            onChange={(next) => update("model", next)}
            placeholder="350G LC"
          />
          <ComboField
            label="Machine type"
            options={MACHINE_TYPES}
            value={value.machineType}
            onChange={(next) => update("machineType", next)}
            placeholder="Excavator"
          />
          <label className="field">
            <span>Country / market</span>
            <input value={DEFAULT_MARKET} disabled />
            <small>Pinned to United States for now.</small>
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary-button" type="submit">Save for this browser</button>
          <button
            type="button"
            onClick={() => {
              clearDefaultMachine();
              setDraft(EMPTY_MACHINE);
              setSaved(false);
            }}
          >
            Clear
          </button>
          {saved && <span className="form-notice" role="status">Saved on this device.</span>}
        </div>
      </form>
    </CollapsibleCard>
  );
}
