/**
 * Pins the pure aggregation behind `/api/observability` — the percentile
 * window math and the degraded-mode zeroed payload. Deliberately small, same
 * discipline as the other contract tests: no HTTP handler, no database.
 * Endpoint-level coverage is deliberately not attempted here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyPayload,
  percentile,
  rollupByOperation,
  summarizeTelemetry,
} from "../app/api/observability/stats.ts";

const call = (overrides = {}) => ({
  ts: "2026-08-06T12:00:00.000Z",
  operation: "interview",
  provider: "anthropic",
  model: "claude-sonnet-5",
  durationMs: 1000,
  inputTokens: 100,
  outputTokens: 50,
  ok: true,
  status: null,
  truncated: false,
  ...overrides,
});

test("percentile is nearest-rank and safe on empty input", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([42], 0.5), 42);
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(hundred, 0.5), 50);
  assert.equal(percentile(hundred, 0.95), 95);
  // Input order must not matter.
  assert.equal(percentile([...hundred].reverse(), 0.95), 95);
});

test("summary counts the 24h slice but takes percentiles over the window", () => {
  const now = Date.parse("2026-08-06T12:00:00.000Z");
  const rows = [
    call({ durationMs: 100 }),
    call({ durationMs: 200, ok: false, status: 502, inputTokens: null, outputTokens: null }),
    // Older than 24h: excluded from counts, included in percentiles.
    call({ ts: "2026-08-01T12:00:00.000Z", durationMs: 9000 }),
  ];
  const summary = summarizeTelemetry(rows, now);
  assert.equal(summary.calls24h, 2);
  assert.equal(summary.failures24h, 1);
  assert.equal(summary.successRate24h, 0.5);
  assert.equal(summary.tokens24h, 150);
  assert.equal(summary.p95Ms, 9000);

  // No calls at all → null success rate, zeroed percentiles, no crash.
  const empty = summarizeTelemetry([], now);
  assert.equal(empty.successRate24h, null);
  assert.equal(empty.p50Ms, 0);
});

test("rollup groups by operation, computes share, sorts by call count", () => {
  const rows = [
    call({ operation: "interview", durationMs: 100 }),
    call({ operation: "interview", durationMs: 300 }),
    call({ operation: "interview", durationMs: 200, ok: false, status: 400 }),
    call({ operation: "spec-research", durationMs: 140_000 }),
  ];
  const rollup = rollupByOperation(rows);
  assert.deepEqual(rollup.map((entry) => entry.operation), ["interview", "spec-research"]);
  assert.equal(rollup[0].calls, 3);
  assert.equal(rollup[0].failures, 1);
  assert.equal(rollup[0].avgMs, 200);
  assert.equal(rollup[0].share, 0.75);
  assert.equal(rollup[1].tokens, 150);
});

test("the degraded-mode payload is fully zeroed, never undefined", () => {
  const payload = emptyPayload();
  assert.equal(payload.summary.calls24h, 0);
  assert.equal(payload.summary.successRate24h, null);
  assert.deepEqual(payload.operations, []);
  assert.deepEqual(payload.recentCalls, []);
  assert.deepEqual(payload.recentEvents, []);
});
