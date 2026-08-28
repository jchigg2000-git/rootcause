"use client";

/* eslint-disable @next/next/no-img-element --
   Same call as `diagnostic-app.tsx`: the one image here is a brand-board icon
   from `public/icons`, a few KB served at its native size, so next/image's
   loader would add a request path for no measurable gain. */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogoMark } from "../components/logo.tsx";
import type { CaseOutcome, LibraryEntry } from "../lib/library.ts";

/**
 * Report Library — a page of its own, reached from the intake stage and never
 * from the header, which is reserved for account details.
 *
 * Nothing new is stored for this. Every diagnosis has been writing case and
 * report rows from the start; this is the query over them. Reports are
 * stored as JSON and re-rendered by the server at the current template, so an
 * old report opens wearing today's chassis and its manufacturer's livery.
 */

type RankedFix = { rank: number; problem: string; action: string };

type OpenReport = {
  caseId: string;
  html: string;
  machineLabel: string;
  generatedAt: string;
  /** The report's ranked candidates, for the "which fix worked" selector. */
  ranked: RankedFix[];
  outcome: CaseOutcome | null;
};

const STATUS_COPY: Record<string, string> = {
  interviewing: "Interview in progress",
  ready: "Interview complete",
  reported: "Report generated",
};

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "equipment"
  );
}

export function LibraryView({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const [cases, setCases] = useState<LibraryEntry[]>([]);
  // Starts true: the page mounts straight into its first load.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenReport | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [selectedRank, setSelectedRank] = useState("");
  const reportFrameRef = useRef<HTMLIFrameElement>(null);
  const readerHeadingRef = useRef<HTMLHeadingElement>(null);

  // No state is touched before the first await, so the mount effect below
  // never sets state synchronously (react-hooks/set-state-in-effect).
  // Returns the loaded list so the deep-link effect can act on it without
  // waiting a render.
  const load = useCallback(async (): Promise<LibraryEntry[]> => {
    try {
      const response = await fetch("/api/library");
      const payload = (await response.json()) as { cases?: LibraryEntry[]; error?: string };
      if (!response.ok) {
        setError(payload.error || "Your reports could not be loaded.");
        return [];
      }
      setCases(payload.cases ?? []);
      setError("");
      return payload.cases ?? [];
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await load();
      // Deep link from a machine card: /library?open=<caseId> goes straight to
      // the reading view. Plain window.location rather than useSearchParams —
      // this is a one-shot read on mount, not a subscription. An id that is
      // not in the caller's list is silently ignored: not-yours == not-exists.
      const openId = new URLSearchParams(window.location.search).get("open");
      const entry = openId ? loaded.find((candidate) => candidate.id === openId) : undefined;
      if (entry?.hasReport) await openReport(entry);
    })();
  }, [load]);

  // Opening a report replaces the list, so focus has to follow it — otherwise
  // the reader appears with the keyboard still parked on a button that is no
  // longer on the page.
  useEffect(() => {
    if (open) readerHeadingRef.current?.focus();
  }, [open]);

  async function openReport(entry: LibraryEntry) {
    setOpeningId(entry.id);
    setError("");
    try {
      const response = await fetch(`/api/library/${entry.id}`);
      const payload = (await response.json()) as {
        html?: string;
        machineLabel?: string;
        generatedAt?: string;
        ranked?: RankedFix[];
        outcome?: CaseOutcome | null;
        error?: string;
      };
      if (!response.ok || !payload.html) {
        setError(payload.error || "That report could not be opened.");
        return;
      }
      setSelectedRank("");
      setOpen({
        caseId: entry.id,
        html: payload.html,
        machineLabel: payload.machineLabel || "Field report",
        generatedAt: payload.generatedAt || entry.updatedAt,
        ranked: payload.ranked ?? [],
        outcome: payload.outcome ?? null,
      });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setOpeningId(null);
    }
  }

  async function markFix() {
    if (!open || !selectedRank) return;
    setFixBusy(true);
    try {
      const response = await fetch(`/api/library/${open.caseId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rank: Number(selectedRank) }),
      });
      const payload = (await response.json()) as { outcome?: CaseOutcome; error?: string };
      if (!response.ok || !payload.outcome) {
        setError(payload.error || "That fix could not be recorded.");
        return;
      }
      setError("");
      setOpen({ ...open, outcome: payload.outcome });
      // Refresh the list so its "Fix confirmed" chip agrees with the reader.
      void load();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setFixBusy(false);
    }
  }

  async function clearFix() {
    if (!open) return;
    setFixBusy(true);
    try {
      const response = await fetch(`/api/library/${open.caseId}/outcome`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error || "The recorded fix could not be cleared.");
        return;
      }
      setError("");
      setSelectedRank("");
      setOpen({ ...open, outcome: null });
      void load();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setFixBusy(false);
    }
  }

  function downloadReport() {
    if (!open) return;
    const blob = new Blob([open.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(open.machineLabel)}-diagnostic-field-report.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // The frame is sandboxed without allow-same-origin, so contentWindow.print()
  // throws a SecurityError from here. postMessage is the one channel that
  // survives that boundary, and the report's own script listens for it — same
  // mechanism as the diagnostic app's report stage.
  function printReport() {
    reportFrameRef.current?.contentWindow?.postMessage("rootcause:print", "*");
  }

  return (
    // The reader needs the report's own width, not the 900px reading column
    // `.settings-shell` sets for the list.
    <main className={`settings-shell library-shell${open ? " is-reading" : ""}`}>
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Report library</h1>
          <p>
            Signed in as {userEmail} · {isAdmin ? "Administrator" : "Viewer"}
          </p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      {open ? (
        <section className="report-page" aria-labelledby="library-report-title">
          <div className="report-toolbar">
            <div>
              <p className="eyebrow">
                <img src="/icons/reports.png" width={22} height={22} alt="" />
                Saved field report
              </p>
              <h1 id="library-report-title" ref={readerHeadingRef} tabIndex={-1}>
                {open.machineLabel}
              </h1>
              <p>Generated {formatDate(open.generatedAt)}. Re-rendered from the stored report.</p>
            </div>
            <div className="report-actions">
              <div className="report-actions-buttons">
                <button className="primary-button" type="button" onClick={downloadReport}>
                  Download HTML report <span aria-hidden="true">↓</span>
                </button>
                <button className="ghost-button" type="button" onClick={printReport}>
                  Print / save as PDF <span aria-hidden="true">⎙</span>
                </button>
                <button className="ghost-button" type="button" onClick={() => setOpen(null)}>
                  Back to library
                </button>
              </div>
              <p className="report-actions-hint">
                On a phone? Download the HTML report — it reflows for small screens. Print / save
                as PDF is laid out for paper.
              </p>
            </div>
          </div>
          {open.ranked.length > 0 && (
            <div className="fix-panel">
              {open.outcome ? (
                <>
                  <p>
                    <span className="fix-confirmed-mark" aria-hidden="true">✓</span>
                    <strong>Fix confirmed</strong> — #{open.outcome.rank}{" "}
                    {open.outcome.problem}
                    {open.outcome.action && `: ${open.outcome.action}`}
                  </p>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void clearFix()}
                    disabled={fixBusy}
                  >
                    Clear
                  </button>
                </>
              ) : (
                <>
                  <label htmlFor="fix-select">
                    <strong>Which fix worked?</strong> Recording it builds this
                    machine&rsquo;s history.
                  </label>
                  <select
                    id="fix-select"
                    value={selectedRank}
                    disabled={fixBusy}
                    onChange={(event) => setSelectedRank(event.target.value)}
                  >
                    <option value="">Pick from the ranked list…</option>
                    {open.ranked.map((fix) => (
                      <option key={fix.rank} value={String(fix.rank)}>
                        #{fix.rank} — {fix.problem}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void markFix()}
                    disabled={fixBusy || !selectedRank}
                  >
                    {fixBusy ? "Recording…" : "Mark as the fix"}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="report-frame-shell">
            {/* Same sandbox as the diagnostic app's report stage: scripts and
                modals for the document's own sorting/print/contents behaviour,
                no same-origin, no forms, no popups. The document carries its
                own CSP and every model-supplied string was escaped by
                report-template.ts before it reached the page. */}
            <iframe
              ref={reportFrameRef}
              className="report-frame"
              srcDoc={open.html}
              title={`${open.machineLabel} diagnostic field report`}
              sandbox="allow-scripts allow-modals"
            />
          </div>
        </section>
      ) : (
        <>
          <p className="page-lede">
            Every diagnosis you have run, newest first. Reports are stored as data and
            rebuilt on open, so an older one comes back in the current layout.
          </p>

          {loading ? (
            <p className="small">Loading your reports…</p>
          ) : cases.length === 0 ? (
            <p className="empty-state">
              No diagnoses yet. Run one from the <Link href="/">intake page</Link> and it
              will be saved here.
            </p>
          ) : (
            <ul className="library-list">
              {cases.map((entry) => {
                const label =
                  [entry.year, entry.make, entry.model].filter(Boolean).join(" ") || entry.make;
                return (
                  <li className="library-card" key={entry.id}>
                    <div className="library-card-head">
                      <h2>{label}</h2>
                      {entry.outcome ? (
                        <span
                          className="library-status status-confirmed"
                          title={`Fix confirmed: ${entry.outcome.problem}`}
                        >
                          Fix confirmed
                        </span>
                      ) : (
                        <span className={`library-status status-${entry.status}`}>
                          {STATUS_COPY[entry.status] ?? entry.status}
                        </span>
                      )}
                    </div>
                    <p className="library-problem">{entry.problem}</p>
                    <dl className="library-facts">
                      <div>
                        <dt>Started</dt>
                        <dd>{formatDate(entry.createdAt)}</dd>
                      </div>
                      {entry.reportedAt && (
                        <div>
                          <dt>Report</dt>
                          <dd>{formatDate(entry.reportedAt)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Turns</dt>
                        <dd>{entry.turnCount}</dd>
                      </div>
                      {entry.serialPin && (
                        <div>
                          <dt>Serial / PIN</dt>
                          <dd className="mono">{entry.serialPin}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="library-card-actions">
                      {entry.hasReport ? (
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => void openReport(entry)}
                          disabled={openingId !== null}
                        >
                          {openingId === entry.id ? "Opening…" : "Open report"}
                        </button>
                      ) : (
                        // Resuming an unfinished case is not built yet, so
                        // this says so rather than offering a control that does
                        // nothing.
                        <p className="small">
                          This case never reached a report—the interview was not finished.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
