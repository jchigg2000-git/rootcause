"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "../components/logo.tsx";
import { CollapsibleCard } from "../components/collapsible-card";
import type { ObservabilityPayload } from "../api/observability/stats";

/**
 * Model-call telemetry, from `GET /api/observability`.
 *
 * Data delivery is fetch-on-mount plus a manual Refresh — not interval
 * polling. Model calls arrive rarely — a diagnosis is minutes long — so a
 * poller would mostly re-render an unchanged panel.
 */
export function ObservabilityView() {
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
    void (async () => {
      await load();
    })();
  }, [load]);

  function refresh() {
    setBusy(true);
    setError("");
    void load();
  }

  return (
    <main className="settings-shell">
      <header className="settings-head">
        <Link className="settings-logo" href="/" aria-label="RootCause HME home">
          <LogoMark size={40} />
        </Link>
        <div>
          <h1>Observability</h1>
          <p>What the model calls cost, and how long they took</p>
        </div>
        <Link className="settings-back" href="/">Back to diagnostics</Link>
      </header>

      <div className="obs-toolbar">
        <p className="small">Model-call telemetry, kept for 14 days.</p>
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
