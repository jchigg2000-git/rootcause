"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { LogoMark } from "../components/logo.tsx";
import { CollapsibleCard } from "../components/collapsible-card";
import {
  MANUFACTURERS,
  MACHINE_TYPES,
  modelsForMake,
  parseModelYear,
} from "../lib/equipment-catalog.ts";
import { ComboField } from "../components/combobox.tsx";
import { SPEC_SECTIONS, type Block, type SpecData } from "../api/spec-lookup/schema";

type LookupForm = { pin: string; year: string; make: string; model: string; machineType: string };
const initialForm: LookupForm = { pin: "", year: "", make: "", model: "", machineType: "" };

/**
 * Drives the progress bar and countdown only — the request itself is not capped
 * here. Measured end to end through the route on a 2014 John Deere 344K:
 * 149s and 186s across two runs, both dominated by the research phase's web
 * search. Overshooting is the safer error: the countdown degrades to
 * "Almost there" rather than sitting at 0:00.
 *
 * The PIN-only figure mirrors the route's larger PIN-only search budget
 * (`route.ts` `PIN_ONLY_SEARCH_BUDGET`) — identification searches run before
 * the spec search, so the whole lookup takes longer. Keep the split in sync
 * with the route.
 */
const LOOKUP_ESTIMATE_SECONDS = 170;
const PIN_ONLY_ESTIMATE_SECONDS = 250;

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

export function SpecLookupView({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const [form, setForm] = useState<LookupForm>(initialForm);
  const [data, setData] = useState<SpecData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Frozen at submit so editing the form mid-lookup can't warp the countdown.
  const [estimateSeconds, setEstimateSeconds] = useState(LOOKUP_ESTIMATE_SECONDS);

  // parseModelYear, not Number(): a half-typed "201" used to narrow the list
  // to nothing mid-keystroke.
  const modelOptions = modelsForMake(form.make, parseModelYear(form.year));

  // Keyed to `busy` rather than a start-timestamp ref so it resets cleanly on
  // every lookup, including a retry after a failure.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [busy]);

  const remaining = Math.max(estimateSeconds - elapsed, 0);
  const progress = Math.min(elapsed / estimateSeconds, 1);
  const machineLabel = [form.year, form.make, form.model].filter(Boolean).join(" ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.pin.trim()) {
      setError("Enter a product identification number.");
      return;
    }
    setBusy(true);
    setError("");
    setData(null);
    setElapsed(0);
    // Same make+model condition as the route's `modelKnown` budget switch.
    setEstimateSeconds(
      form.make.trim() && form.model.trim() ? LOOKUP_ESTIMATE_SECONDS : PIN_ONLY_ESTIMATE_SECONDS,
    );
    try {
      const response = await fetch("/api/spec-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: form.pin,
          year: form.year || undefined,
          make: form.make || undefined,
          model: form.model || undefined,
          machineType: form.machineType || undefined,
        }),
      });
      const payload = (await response.json()) as { data?: SpecData; error?: string };
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
    <main className="settings-shell spec-lookup-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Spec lookup</h1>
          <p>
            Signed in as {userEmail} · {isAdmin ? "Administrator" : "Viewer"}
          </p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      <form className="spec-lookup-form" onSubmit={submit}>
        <label className="field">
          <span>Product identification number (PIN)</span>
          <input
            value={form.pin}
            onChange={(event) => setForm({ ...form, pin: event.target.value })}
            placeholder="e.g. 1FF350GXKFF123456"
            maxLength={40}
            autoFocus
          />
        </label>

        <button type="button" className="ghost-button spec-more-toggle" onClick={() => setShowMore((v) => !v)}>
          {showMore ? "Hide machine details" : "Know the machine? Add details for a better match"}
        </button>

        {showMore && (
          <div className="field-grid spec-detail-fields">
            <label className="field">
              <span>Year</span>
              <input
                value={form.year}
                onChange={(event) => setForm({ ...form, year: event.target.value })}
                inputMode="numeric"
                maxLength={4}
              />
            </label>
            {/* Only a committed make clears the model — typing one used to
                wipe it on every keystroke. */}
            <ComboField
              label="Make"
              options={MANUFACTURERS}
              value={form.make}
              onChange={(next) => setForm({ ...form, make: next })}
              onSelect={(next) => setForm({ ...form, make: next, model: "" })}
            />
            <ComboField
              label="Model"
              options={modelOptions}
              value={form.model}
              onChange={(next) => setForm({ ...form, model: next })}
            />
            <ComboField
              label="Machine type"
              options={MACHINE_TYPES}
              value={form.machineType}
              onChange={(next) => setForm({ ...form, machineType: next })}
            />
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Looking up specs…" : "Look up specs"}
        </button>
      </form>

      {/* A grounded lookup runs ~2.5 minutes because it reads the manufacturer's
          spec sheet rather than answering from recall, so the wait needs the same
          treatment the report's generating stage gets — silence here reads as a
          hang. Reuses the `generating-*` styles rather than adding new ones. */}
      {busy && (
        <section className="generating-panel spec-lookup-progress" role="status" aria-live="polite">
          <span className="generating-spinner" aria-hidden="true" />
          <p className="eyebrow">Looking up specifications</p>
          <h2>Searching published sources{machineLabel ? ` for ${machineLabel}.` : "."}</h2>
          <p className="generating-copy">
            RootCause is finding the manufacturer&rsquo;s spec sheet and reading the
            figures off it rather than recalling them, so the numbers can be trusted.
            This takes a couple of minutes—no need to refresh or navigate away.
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

      {data && <SpecResult data={data} />}
    </main>
  );
}

function SpecResult({ data }: { data: SpecData }) {
  const { machine } = data;
  return (
    <div className="spec-result">
      <div className="spec-result-head">
        <h2>{data.title}</h2>
        {data.lede && <p className="spec-lede">{data.lede}</p>}
        {(machine.year || machine.make || machine.model || machine.machineType) && (
          <dl className="spec-machine-chips">
            {machine.year && (
              <div>
                <dt>Year</dt>
                <dd>{machine.year}</dd>
              </div>
            )}
            {machine.make && (
              <div>
                <dt>Make</dt>
                <dd>{machine.make}</dd>
              </div>
            )}
            {machine.model && (
              <div>
                <dt>Model</dt>
                <dd>{machine.model}</dd>
              </div>
            )}
            {machine.machineType && (
              <div>
                <dt>Type</dt>
                <dd>{machine.machineType}</dd>
              </div>
            )}
            {machine.confidence && (
              <div>
                <dt>Confidence</dt>
                <dd>{machine.confidence}</dd>
              </div>
            )}
          </dl>
        )}
        {data.metaChips.length > 0 && (
          <ul className="spec-meta-chips">
            {data.metaChips.map((chip, index) => (
              <li key={index}>{chip}</li>
            ))}
          </ul>
        )}
      </div>

      {SPEC_SECTIONS.map((section, index) => {
        const blocks = data.sections[section.id];
        return (
          <CollapsibleCard
            key={section.id}
            collapseKey={`spec-${section.id}`}
            title={`${index + 1}. ${section.title}`}
          >
            {blocks && blocks.length > 0 ? (
              blocks.map((block, blockIndex) => <BlockView key={blockIndex} block={block} />)
            ) : (
              <p className="small">No content returned for this section.</p>
            )}
          </CollapsibleCard>
        );
      })}

      {data.disclaimer && <p className="spec-disclaimer">{data.disclaimer}</p>}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="spec-block-paragraph">
          {block.label && <span className="spec-badge">{block.label}</span>}
          {block.text}
        </p>
      );
    case "list": {
      const items = block.items.map((item, index) => <li key={index}>{item}</li>);
      return block.style === "steps" ? (
        <ol className="spec-block-list">{items}</ol>
      ) : (
        <ul className={`spec-block-list${block.style === "checklist" ? " checklist" : ""}`}>{items}</ul>
      );
    }
    case "table":
      return (
        <div className="spec-block-table-wrap">
          {block.caption && <p className="spec-table-caption">{block.caption}</p>}
          <table className="spec-block-table">
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} data-label={block.columns[cellIndex] ?? ""}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div className={`spec-callout tone-${block.tone}`}>
          {block.title && <strong>{block.title}</strong>}
          <p>{block.text}</p>
        </div>
      );
    case "cards":
      return (
        <div className="spec-block-cards">
          {block.cards.map((card, index) => (
            <div className="spec-card" key={index}>
              {card.label && <span className="spec-badge">{card.label}</span>}
              {card.title && <strong>{card.title}</strong>}
              {card.text && <p>{card.text}</p>}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}
