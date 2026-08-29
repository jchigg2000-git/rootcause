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
import { TokenManager } from "./token-manager";
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
  userRunBudget: number;
  userTokenBudget: number;
  perCaseTokenCeiling: number;
};
/** What GET and PUT on `/api/settings` both answer with. */
type SettingsPayload = {
  settings?: Settings;
  catalog?: CatalogEntry[];
  providers?: Partial<Record<ProviderId, boolean>>;
};
type Usage = {
  monthTokens: number;
  runsUsed: number;
  runCap: number;
  tokensUsed: number;
  tokenCap: number;
  hasGrant: boolean;
  exempt: boolean;
};

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

export function SettingsView({
  userEmail,
  isAdmin,
}: {
  userEmail: string;
  isAdmin: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [providers, setProviders] = useState<Partial<Record<ProviderId, boolean>>>({});
  // Defaults null, not a zeroed Usage: a failed or in-flight load must render
  // as "not known yet" rather than as an allowance of nothing, which the
  // allowance card would otherwise show as spent.
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
      // The caller's own spend. A failure here is reported inside the allowance
      // card rather than at the top of the page: it is a secondary figure, and
      // an admin — for whom it is only the trailing usage line — has nothing to
      // do about it. Either way the card must stop claiming to be loading.
      const spend = await requestJson<Usage>(
        "/api/usage",
        undefined,
        "Your allowance could not be loaded.",
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
          <p>
            Signed in as {userEmail} · {isAdmin ? "Administrator" : "Viewer"}
          </p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      <CollapsibleCard
        collapseKey="diagnostics"
        title="Diagnostic engine"
        subtitle={isAdmin ? "Applies to everyone" : "Read-only — administrator access required"}
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
                disabled={!isAdmin || busy}
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
                      // Left selectable when unconfigured: an admin may be
                      // setting the key and the model in either order, and the
                      // status line below says plainly what is missing.
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
                disabled={!isAdmin || busy}
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
              label="Reports per access code"
              settingKey="userRunBudget"
              settings={settings}
              drafts={drafts}
              setDrafts={setDrafts}
              isAdmin={isAdmin}
              busy={busy}
              patch={patch}
              hint="Prefilled when you issue a code. A report is counted only when it reaches
                    the operator, so a failed generation costs nobody a run. Changing this never
                    alters a code already issued. 0 means unlimited."
            />

            <NumberSetting
              label="Token limit per access code"
              settingKey="userTokenBudget"
              settings={settings}
              drafts={drafts}
              setDrafts={setDrafts}
              isAdmin={isAdmin}
              busy={busy}
              patch={patch}
              hint="The backstop behind the report count: total spend one code can ever reach,
                    whatever it produced. Lifetime, not monthly. 0 means unlimited."
            />

            <NumberSetting
              label="Token ceiling per diagnosis"
              settingKey="perCaseTokenCeiling"
              settings={settings}
              drafts={drafts}
              setDrafts={setDrafts}
              isAdmin={isAdmin}
              busy={busy}
              patch={patch}
              hint="Ends one runaway interview. Since a run is only charged on delivery, a
                    diagnosis that never converges would otherwise spend without limit and never
                    be counted. 0 disables it."
            />

            {usage && (
              <small role="status">
                {usage.exempt
                  ? `You've used ${usage.monthTokens.toLocaleString()} tokens this month — the skeleton key has no limit.`
                  : usage.runCap > 0
                    ? `You've used ${usage.runsUsed.toLocaleString()} of ${usage.runCap.toLocaleString()} reports on your access code.`
                    : `You've generated ${usage.runsUsed.toLocaleString()} reports — no limit is set on your access code.`}
              </small>
            )}
          </div>
        )}
      </CollapsibleCard>

      {!isAdmin && <AllowanceCard usage={usage} error={usageError} />}

      <DefaultMachineCard />

      {isAdmin && (
        <CollapsibleCard
          collapseKey="accounts"
          title="Access codes"
          subtitle="Issue and revoke the codes that let people in"
          badge="Admin"
          defaultCollapsed
        >
          <TokenManager />
        </CollapsibleCard>
      )}
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
type NumericKey = "userRunBudget" | "userTokenBudget" | "perCaseTokenCeiling";

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
  isAdmin,
  busy,
  patch,
  hint,
}: {
  label: string;
  settingKey: NumericKey;
  settings: Settings;
  drafts: Partial<Record<NumericKey, string>>;
  setDrafts: React.Dispatch<React.SetStateAction<Partial<Record<NumericKey, string>>>>;
  isAdmin: boolean;
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
          disabled={!isAdmin || busy}
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [settingKey]: event.target.value.replace(/[^\d]/g, ""),
            }))
          }
        />
        {isAdmin && dirty && (
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

/**
 * What a code holder has left.
 *
 * There is nothing to buy in the app: an allowance arrives with an access code
 * and runs out. The card states the number and how to get more, and deliberately
 * offers no purchase control — there is no self-serve path to one.
 *
 * Reports are the headline because that is what the code was sold as. The token
 * figure is shown underneath only when a limit is actually set, so a holder who
 * will never hit the backstop is not made to think about it.
 *
 * `error` replaces the loading line rather than joining it: a holder who cannot
 * see their remaining reports needs to know the number is unavailable, not
 * watch a spinner that has already given up.
 */
function AllowanceCard({ usage, error }: { usage: Usage | null; error: string }) {
  return (
    <CollapsibleCard
      collapseKey="billing"
      title="Your allowance"
      subtitle="Reports remaining on this access code"
    >
      {!usage ? (
        <p className="muted">{error || "Loading…"}</p>
      ) : !usage.hasGrant ? (
        <p className="muted">This account has no allowance. Ask for an access code to continue.</p>
      ) : (
        <>
          {usage.runCap > 0 ? (
            <>
              <p>
                <strong>{(usage.runCap - usage.runsUsed).toLocaleString()}</strong> of{" "}
                {usage.runCap.toLocaleString()} reports left.
              </p>
              <p className="muted">
                A report is counted only when it reaches you — a generation that fails costs
                nothing. This is a lifetime figure, not a monthly one. When it runs out, ask for
                a new code.
              </p>
            </>
          ) : (
            <p>
              {usage.runsUsed.toLocaleString()} reports generated — this access code has no
              report limit.
            </p>
          )}
          {usage.tokenCap > 0 && (
            <p className="muted">
              Spending backstop: {usage.tokensUsed.toLocaleString()} of{" "}
              {usage.tokenCap.toLocaleString()} tokens used.
            </p>
          )}
        </>
      )}
    </CollapsibleCard>
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
