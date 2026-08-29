/**
 * Pure aggregation for `/api/observability` — no DB, no `?raw` imports, so it
 * is unit-testable under plain `node --test`, the same discipline as the
 * diagnose and spec-lookup contracts.
 *
 * Percentiles are computed here in JS over a bounded most-recent window
 * rather than in SQL: SQLite has no `percentile_cont`, and the JS window
 * keeps the math identical if the store ever changes dialect.
 */

export type TelemetryCall = {
  ts: string;
  operation: string;
  provider: string;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  ok: boolean;
  status: number | null;
  truncated: boolean;
};

export type ObservabilitySummary = {
  /** Model-call KPIs, from the telemetry store. */
  calls24h: number;
  failures24h: number;
  /** 0–1, null when there were no calls in the last 24h. */
  successRate24h: number | null;
  tokens24h: number;
  /** Latency percentiles over the whole bounded window, not just 24h. */
  p50Ms: number;
  p95Ms: number;
};

export type OperationRollup = {
  operation: string;
  calls: number;
  failures: number;
  avgMs: number;
  p95Ms: number;
  tokens: number;
  /** 0–1 share of all calls in the window; drives the share bar. */
  share: number;
};

export type ObservabilityPayload = {
  summary: ObservabilitySummary;
  operations: OperationRollup[];
  recentCalls: TelemetryCall[];
};

/** Degraded-mode baseline: a broken or empty store renders as zeros, not a 500. */
export function emptyPayload(): ObservabilityPayload {
  return {
    summary: {
      calls24h: 0,
      failures24h: 0,
      successRate24h: null,
      tokens24h: 0,
      p50Ms: 0,
      p95Ms: 0,
    },
    operations: [],
    recentCalls: [],
  };
}

/** Nearest-rank percentile; `p` in [0, 1]. Empty input yields 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const tokensOf = (call: TelemetryCall) => (call.inputTokens ?? 0) + (call.outputTokens ?? 0);

/** The telemetry half of the summary. `nowMs` is injected for testability. */
export function summarizeTelemetry(
  window: TelemetryCall[],
  nowMs: number,
): Pick<
  ObservabilitySummary,
  "calls24h" | "failures24h" | "successRate24h" | "tokens24h" | "p50Ms" | "p95Ms"
> {
  const cutoff = new Date(nowMs - DAY_MS).toISOString();
  const recent = window.filter((call) => call.ts >= cutoff);
  const failures = recent.filter((call) => !call.ok).length;
  const durations = window.map((call) => call.durationMs);
  return {
    calls24h: recent.length,
    failures24h: failures,
    successRate24h: recent.length ? (recent.length - failures) / recent.length : null,
    tokens24h: recent.reduce((sum, call) => sum + tokensOf(call), 0),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
}

/** Per-operation rollup over the window, largest call-count first. */
export function rollupByOperation(window: TelemetryCall[]): OperationRollup[] {
  const groups = new Map<string, TelemetryCall[]>();
  for (const call of window) {
    const group = groups.get(call.operation);
    if (group) group.push(call);
    else groups.set(call.operation, [call]);
  }
  return [...groups.entries()]
    .map(([operation, calls]) => ({
      operation,
      calls: calls.length,
      failures: calls.filter((call) => !call.ok).length,
      avgMs: Math.round(calls.reduce((sum, call) => sum + call.durationMs, 0) / calls.length),
      p95Ms: percentile(calls.map((call) => call.durationMs), 0.95),
      tokens: calls.reduce((sum, call) => sum + tokensOf(call), 0),
      share: window.length ? calls.length / window.length : 0,
    }))
    .sort((a, b) => b.calls - a.calls);
}
