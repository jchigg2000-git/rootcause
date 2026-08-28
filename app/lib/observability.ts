/**
 * LLM telemetry store — the observability half that did not already exist.
 * (The audit half predates this module: auth.db's `auth_events`, written
 * best-effort by `auth/store.ts` `recordAuthEvent`.)
 *
 * Decoupling rules, in force here:
 *
 * - This module imports nothing from auth, providers, or the data layer.
 *   Emitters call it; it never calls them. The `auth_events` readers below
 *   run raw SQL against a handle they are handed rather than importing
 *   `auth/store.ts` — observability *consumes* auth's audit rows, it must
 *   never *depend on* the auth module.
 * - Every write is best-effort: a failing telemetry write logs and returns.
 *   It can never throw into, or slow, the request that produced the call.
 * - The store is disposable by design: its own file (db/observability.db,
 *   riding `DB_DIR` onto the mounted volume), pruned on every panel read, so
 *   no cron is needed and a retention bug can only ever eat metrics.
 */
import observabilitySchema from "../../migrations/0005_observability.sql?raw";
import type { Database } from "./db.ts";
import { createSchemaRunner } from "./sql.ts";

export const ensureObservabilitySchema = createSchemaRunner(observabilitySchema);

/** Telemetry is high-churn exhaust: keep two weeks, hard-capped. */
const TELEMETRY_RETAIN_DAYS = 14;
const TELEMETRY_RETAIN_MAX_ROWS = 20_000;

/** Audit rows are security signal: keep longer, capped lower (they're small). */
const AUDIT_RETAIN_DAYS = 90;
const AUDIT_RETAIN_MAX_ROWS = 10_000;

/** The bounded most-recent window percentiles are computed over (in JS —
 * SQLite has no percentile_cont, and a bounded window keeps the math
 * identical if the store ever moves). */
export const TELEMETRY_STATS_WINDOW = 5_000;

export type LlmTelemetryWrite = {
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

export type LlmTelemetryRow = LlmTelemetryWrite & { ts: string };

export type AuthEventRow = {
  ts: string;
  event: string;
  actorEmail: string | null;
  clientIp: string | null;
  detail: string | null;
};

const nowIso = () => new Date().toISOString();
const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * Fire-and-forget telemetry write. Undefined db (store not opened, e.g. under
 * tests) and a throwing db both degrade to a log line — never an error in the
 * request that produced the call.
 */
export async function recordLlmTelemetry(
  db: Database | undefined,
  row: LlmTelemetryWrite,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO llm_telemetry
           (ts, operation, provider, model, duration_ms, input_tokens, output_tokens, ok, status, truncated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        nowIso(),
        row.operation,
        row.provider,
        row.model,
        Math.max(0, Math.round(row.durationMs)),
        row.inputTokens,
        row.outputTokens,
        row.ok ? 1 : 0,
        row.status,
        row.truncated ? 1 : 0,
      )
      .run();
  } catch (error) {
    console.error(`[observability] telemetry write failed: ${String(error).slice(0, 200)}`);
  }
}

type TelemetryDbRow = {
  ts: string;
  operation: string;
  provider: string;
  model: string;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  ok: number;
  status: number | null;
  truncated: number;
};

const fromDbRow = (row: TelemetryDbRow): LlmTelemetryRow => ({
  ts: row.ts,
  operation: row.operation,
  provider: row.provider,
  model: row.model,
  durationMs: row.duration_ms,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  ok: row.ok === 1,
  status: row.status,
  truncated: row.truncated === 1,
});

/** Most-recent telemetry, newest first, bounded. */
export async function readTelemetryWindow(
  db: Database,
  limit = TELEMETRY_STATS_WINDOW,
): Promise<LlmTelemetryRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM llm_telemetry ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<TelemetryDbRow>();
  return results.map(fromDbRow);
}

/** Age + row-count prune, run opportunistically on each panel read. */
export async function pruneTelemetry(db: Database): Promise<void> {
  await db
    .prepare("DELETE FROM llm_telemetry WHERE ts < ?")
    .bind(daysAgoIso(TELEMETRY_RETAIN_DAYS))
    .run();
  await db
    .prepare(
      `DELETE FROM llm_telemetry WHERE id NOT IN
         (SELECT id FROM llm_telemetry ORDER BY id DESC LIMIT ?)`,
    )
    .bind(TELEMETRY_RETAIN_MAX_ROWS)
    .run();
}

/** Most-recent audit rows from auth.db's auth_events, newest first. */
export async function readRecentAuthEvents(
  db: Database,
  limit: number,
): Promise<AuthEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT occurred_at, event, actor_email, client_ip, detail
       FROM auth_events ORDER BY id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{
      occurred_at: string;
      event: string;
      actor_email: string | null;
      client_ip: string | null;
      detail: string | null;
    }>();
  return results.map((row) => ({
    ts: row.occurred_at,
    event: row.event,
    actorEmail: row.actor_email,
    clientIp: row.client_ip,
    detail: row.detail,
  }));
}

/** Login KPIs for the summary tiles. */
export async function countAuthEvents24h(
  db: Database,
): Promise<{ logins: number; failures: number }> {
  const cutoff = daysAgoIso(1);
  const count = async (event: string) =>
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event = ? AND occurred_at >= ?")
        .bind(event, cutoff)
        .first<{ n: number }>()
    )?.n ?? 0;
  return { logins: await count("login.success"), failures: await count("login.failure") };
}

/**
 * Retention for the pre-existing audit table, which had none. Scoped to
 * auth_events only — this is the single place observability writes into a
 * file it does not own.
 */
export async function pruneAuthEvents(db: Database): Promise<void> {
  await db
    .prepare("DELETE FROM auth_events WHERE occurred_at < ?")
    .bind(daysAgoIso(AUDIT_RETAIN_DAYS))
    .run();
  await db
    .prepare(
      `DELETE FROM auth_events WHERE id NOT IN
         (SELECT id FROM auth_events ORDER BY id DESC LIMIT ?)`,
    )
    .bind(AUDIT_RETAIN_MAX_ROWS)
    .run();
}
