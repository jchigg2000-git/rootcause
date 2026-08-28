"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "../components/logo.tsx";
import { CollapsibleCard } from "../components/collapsible-card";
import type { ObservabilityPayload } from "../api/observability/stats";

/**
 * Admin observability panel: model-call telemetry + the auth audit trail,
 * from `GET /api/observability`.
 *
 * Data delivery is fetch-on-mount plus a manual Refresh — not interval
 * polling. Model calls here arrive at household rate (a diagnosis is minutes
 * long), so a poller would mostly re-render an unchanged panel.
 */
export function ObservabilityView({
  userEmail,
  isAdmin,
}: {
  userEmail: string;
  isAdmin: boolean;
}) {
  const [data, setData] = useState<ObservabilityPayload | null>(null);
  const [error, setError] = useState("");
  // Starts true: the page mounts straight into its first load.
  const [busy, setBusy] = useState(true);

  // No state is touched before the first await, so the mount effect below
  // never sets state synchronously (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/observability");
      const payload = (await response.json()) as ObservabilityPayload & { error?: string };
      if (!response.ok) {
        setError(payload.error || "Could not load observability data.");
        return;
      }
      setData(payload);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      await load();
    })();
  }, [isAdmin, load]);

  function refresh() {
    setBusy(true);
    setError("");
    void load();
  }

  return (
    <main className="settings-shell obs-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Observability</h1>
          <p>
            Signed in as {userEmail} · {isAdmin ? "Administrator" : "Viewer"}
          </p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      {/* Defense in depth: the API answers 403 to a viewer anyway, but a
          direct hit on this page should say so rather than show empty tiles. */}
      {!isAdmin ? (
        <section className="obs-denied">
          <h2>Administrator access required</h2>
          <p>This page shows model telemetry and the sign-in audit log. Ask an administrator.</p>
        </section>
      ) : (
        <>
          <div className="obs-toolbar">
            <p className="small">
              Model-call telemetry (14-day retention) and the sign-in audit log (90-day).
            </p>
            <button type="button" className="ghost-button" onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {data && (
            <>
              <div className="stat-tiles" aria-label="Key metrics">
                <StatTile label="Model calls · 24h" value={String(data.summary.calls24h)} />
                <StatTile
                  label="Success rate · 24h"
                  value={
                    data.summary.successRate24h === null
                      ? "—"
                      : `${Math.round(data.summary.successRate24h * 100)}%`
                  }
                  tone={
                    data.summary.successRate24h !== null && data.summary.successRate24h < 0.9
                      ? "caution"
                      : undefined
                  }
                />
                <StatTile label="Tokens · 24h" value={formatTokens(data.summary.tokens24h)} />
                <StatTile
                  label="Latency p95"
                  value={formatMs(data.summary.p95Ms)}
                  sub={`p50 ${formatMs(data.summary.p50Ms)}`}
                />
                <StatTile label="Sign-ins · 24h" value={String(data.summary.logins24h)} />
                <StatTile
                  label="Failed sign-ins · 24h"
                  value={String(data.summary.failedLogins24h)}
                  tone={data.summary.failedLogins24h > 0 ? "caution" : undefined}
                />
              </div>

              <CollapsibleCard
                collapseKey="obs-operations"
                title="Model calls by operation"
                subtitle="Over the retained telemetry window"
              >
                {data.operations.length === 0 ? (
                  <p className="small">No model calls recorded yet.</p>
                ) : (
                  <table className="spec-block-table">
                    <thead>
                      <tr>
                        <th>Operation</th>
                        <th>Calls</th>
                        <th>Failures</th>
                        <th>Avg</th>
                        <th>p95</th>
                        <th>Tokens</th>
                        <th>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.operations.map((op) => (
                        <tr key={op.operation}>
                          <td data-label="Operation">{op.operation}</td>
                          <td data-label="Calls">{op.calls}</td>
                          <td data-label="Failures">{op.failures}</td>
                          <td data-label="Avg">{formatMs(op.avgMs)}</td>
                          <td data-label="p95">{formatMs(op.p95Ms)}</td>
                          <td data-label="Tokens">{formatTokens(op.tokens)}</td>
                          <td data-label="Share">
                            <span className="share-bar" aria-hidden="true">
                              <span style={{ width: `${Math.round(op.share * 100)}%` }} />
                            </span>
                            {Math.round(op.share * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CollapsibleCard>

              <CollapsibleCard
                collapseKey="obs-recent-calls"
                title="Recent model calls"
                subtitle="Newest first"
              >
                {data.recentCalls.length === 0 ? (
                  <p className="small">No model calls recorded yet.</p>
                ) : (
                  <table className="spec-block-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Operation</th>
                        <th>Model</th>
                        <th>Duration</th>
                        <th>Tokens in / out</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentCalls.map((call, index) => (
                        <tr key={`${call.ts}-${index}`} className={call.ok ? undefined : "obs-row-failed"}>
                          <td data-label="When">{formatWhen(call.ts)}</td>
                          <td data-label="Operation">{call.operation}</td>
                          <td data-label="Model">{call.model}</td>
                          <td data-label="Duration">{formatMs(call.durationMs)}</td>
                          <td data-label="Tokens in / out">
                            {call.inputTokens === null && call.outputTokens === null
                              ? "—"
                              : `${formatTokens(call.inputTokens ?? 0)} / ${formatTokens(call.outputTokens ?? 0)}`}
                          </td>
                          <td data-label="Outcome">
                            {call.ok
                              ? call.truncated
                                ? "OK (truncated)"
                                : "OK"
                              : `Failed (${call.status ?? "?"})`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CollapsibleCard>

              <CollapsibleCard
                collapseKey="obs-audit"
                title="Sign-in and audit log"
                subtitle="Logins, account changes, settings changes"
              >
                {data.recentEvents.length === 0 ? (
                  <p className="small">No audit events recorded yet.</p>
                ) : (
                  <table className="spec-block-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Event</th>
                        <th>Actor</th>
                        <th>IP</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentEvents.map((event, index) => (
                        <tr
                          key={`${event.ts}-${index}`}
                          className={
                            event.event === "login.failure" || event.event === "login.throttled"
                              ? "obs-row-failed"
                              : undefined
                          }
                        >
                          <td data-label="When">{formatWhen(event.ts)}</td>
                          <td data-label="Event">{event.event}</td>
                          <td data-label="Actor">{event.actorEmail ?? "—"}</td>
                          <td data-label="IP">{event.clientIp ?? "—"}</td>
                          <td data-label="Detail">{event.detail ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CollapsibleCard>
            </>
          )}
        </>
      )}
    </main>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "caution";
}) {
  return (
    <div className={`stat-tile${tone ? ` tone-${tone}` : ""}`}>
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value">{value}</strong>
      {sub && <span className="stat-tile-sub">{sub}</span>}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  return count.toLocaleString();
}

function formatWhen(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
