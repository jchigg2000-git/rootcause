"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LogoMark } from "../components/logo.tsx";
import type { MachineRecord } from "../api/inventory/contract.ts";
import type { PartsData } from "../api/parts-lookup/schema";

/**
 * Cheap-parts lookup, scoped to one of the caller's own machines. Reached
 * from a machine card's "Find parts" — `/parts-lookup?machine=<id>` — or bare,
 * in which case it offers the caller's machines to pick from.
 *
 * The lookup is grounded web search on a model pinned to `claude-sonnet-5`, so
 * a $-per-click surface cannot follow the admin's report model up to Opus. It
 * takes a couple of minutes, and the wait borrows the report's generating
 * treatment, exactly as spec lookup does.
 */

/** Drives the progress bar only; mirrors the route's 3+2 search budget. */
const LOOKUP_ESTIMATE_SECONDS = 130;

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

const machineLabel = (machine: MachineRecord) =>
  [machine.year, machine.make, machine.model].filter(Boolean).join(" ") || machine.make;

export function PartsLookupView({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [machineId, setMachineId] = useState("");
  const [partQuery, setPartQuery] = useState("");
  const [data, setData] = useState<PartsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const loadMachines = useCallback(async () => {
    try {
      const response = await fetch("/api/inventory");
      const payload = (await response.json()) as { machines?: MachineRecord[]; error?: string };
      if (!response.ok) {
        setError(payload.error || "Your machines could not be loaded.");
        return;
      }
      const loaded = payload.machines ?? [];
      setMachines(loaded);
      // Deep link from a machine card: /parts-lookup?machine=<id>. One-shot
      // read on mount; an id not in the caller's list is silently ignored.
      const wanted = new URLSearchParams(window.location.search).get("machine");
      if (wanted && loaded.some((machine) => machine.id === wanted)) {
        setMachineId(wanted);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadMachines();
    })();
  }, [loadMachines]);

  // Keyed to `busy` so it resets cleanly on every lookup, retries included.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [busy]);

  const remaining = Math.max(LOOKUP_ESTIMATE_SECONDS - elapsed, 0);
  const progress = Math.min(elapsed / LOOKUP_ESTIMATE_SECONDS, 1);
  const selected = machines.find((machine) => machine.id === machineId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!machineId) {
      setError("Pick a machine from your inventory.");
      return;
    }
    if (!partQuery.trim()) {
      setError("Name the part you need.");
      return;
    }
    setBusy(true);
    setError("");
    setData(null);
    setElapsed(0);
    try {
      const response = await fetch("/api/parts-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, partQuery }),
      });
      const payload = (await response.json()) as { data?: PartsData; error?: string };
      if (!response.ok) {
        setError(payload.error || "That lookup failed.");
        return;
      }
      setData(payload.data ?? null);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="settings-shell parts-lookup-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Parts lookup</h1>
          <p>
            Signed in as {userEmail} · {isAdmin ? "Administrator" : "Viewer"}
          </p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      <p className="page-lede">
        Real purchasable options for one of your machines, cheapest viable first —
        searched from live listings, never recalled from memory.
      </p>

      <form className="spec-lookup-form" onSubmit={submit}>
        <label className="field">
          <span>Machine</span>
          {loadingMachines ? (
            <p className="small">Loading your machines…</p>
          ) : machines.length === 0 ? (
            <p className="small">
              No machines in your <Link href="/inventory">inventory</Link> yet — run a
              diagnosis or add one there first.
            </p>
          ) : (
            <select
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              required
            >
              <option value="">Pick a machine…</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machineLabel(machine)}
                  {machine.label ? ` — ${machine.label}` : ""}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="field">
          <span>Part needed</span>
          <input
            value={partQuery}
            onChange={(event) => setPartQuery(event.target.value)}
            maxLength={200}
            placeholder="e.g. hydraulic return filter, final drive seal kit"
          />
          <small>
            A part number sharpens the search when you have one.
          </small>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="primary-button" type="submit" disabled={busy || machines.length === 0}>
          {busy ? "Finding parts…" : "Find parts"}
        </button>
      </form>

      {busy && (
        <section className="generating-panel spec-lookup-progress" role="status" aria-live="polite">
          <span className="generating-spinner" aria-hidden="true" />
          <p className="eyebrow">Finding parts</p>
          <h2>
            Searching live listings
            {selected ? ` for the ${machineLabel(selected)}.` : "."}
          </h2>
          <p className="generating-copy">
            RootCause is pinning the part number and reading real listings for prices
            rather than recalling them. This takes a couple of minutes—no need to
            refresh or navigate away.
          </p>
          <div className="generating-progress">
            <div
              className="generating-progress-bar"
              style={{ width: `${Math.round(progress * 92)}%` }}
            />
          </div>
          <p className="generating-countdown">
            {remaining > 0
              ? `About ${formatCountdown(remaining)} remaining`
              : "Almost there—finishing up…"}
          </p>
        </section>
      )}

      {data && <PartsResult data={data} />}
    </main>
  );
}

const PART_COLUMNS = [
  "Part",
  "Number",
  "Condition",
  "Price",
  "Vendor",
  "Fitment",
  "Confidence",
  "Notes",
] as const;

function PartsResult({ data }: { data: PartsData }) {
  return (
    <div className="spec-result">
      <div className="spec-result-head">
        <h2>{data.title}</h2>
        {data.lede && <p className="spec-lede">{data.lede}</p>}
      </div>

      {data.options.length === 0 ? (
        <p className="empty-state">
          Nothing purchasable was found within the search budget. Try a more specific
          part name, or add the part number if you have it.
        </p>
      ) : (
        <div className="spec-block-table-wrap">
          <table className="spec-block-table parts-table">
            <thead>
              <tr>
                {PART_COLUMNS.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.options.map((option, index) => (
                <tr key={index}>
                  <td data-label="Part">{option.name}</td>
                  <td data-label="Number" className="mono">{option.partNumber}</td>
                  <td data-label="Condition">{option.condition}</td>
                  <td data-label="Price">{option.price}</td>
                  <td data-label="Vendor">
                    {option.url ? (
                      <a href={option.url} target="_blank" rel="noopener noreferrer">
                        {option.vendor || "Listing"}
                        <b aria-hidden="true"> ↗</b>
                      </a>
                    ) : (
                      option.vendor
                    )}
                  </td>
                  <td data-label="Fitment">{option.fitment}</td>
                  <td data-label="Confidence">{option.confidence}</td>
                  <td data-label="Notes">{option.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.cautions.length > 0 && (
        <div className="spec-callout tone-warning">
          <strong>Before you order</strong>
          <ul className="spec-block-list">
            {data.cautions.map((caution, index) => (
              <li key={index}>{caution}</li>
            ))}
          </ul>
        </div>
      )}

      {data.disclaimer && <p className="spec-disclaimer">{data.disclaimer}</p>}
    </div>
  );
}
