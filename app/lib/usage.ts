/**
 * Token accounting. This module RECORDS; it does not enforce.
 *
 * It was `budget.ts` while there were budgets to enforce — a monthly ceiling,
 * then per-code allowances. Both are gone, and nothing that remains here can
 * refuse anything, so the name follows the ledger rather than the concept.
 *
 * The ledger lives in APP_DB, deliberately NOT observability.db: the
 * observability store is prunable exhaust with a one-way data flow, and its
 * 14-day retention would silently erase the numbers this is kept for. Routes
 * write here themselves from the `ChatOutcome.usage` they already hold, so
 * `providers.ts`'s telemetry emit stays the observability subsystem's only feed
 * and the one-way rule holds.
 *
 * Nothing here refuses anything. The app has no allowances to enforce — this is
 * the record of what running it has cost, for an operator spending their own
 * provider key. The one live spend guard is `perCaseTokenCeiling`, checked in
 * `app/api/diagnose/route.ts` against `diagnostic_case.tokens_spent`.
 */
import usageLedgerSchema from "../../migrations/0009_usage_ledger.sql?raw";
import type { Database } from "./db.ts";
import { createColumnDropper, createSchemaRunner } from "./sql.ts";

const runUsageLedgerSchema = createSchemaRunner(usageLedgerSchema);
// Databases that predate the removal of accounts carry a NOT NULL owner column,
// which would reject every insert below. 0009 drops the index over it first,
// because SQLite refuses DROP COLUMN while one stands.
const userIdDropper = createColumnDropper("usage_ledger", "user_id");

export async function ensureUsageLedgerSchema(db: Database): Promise<void> {
  await runUsageLedgerSchema(db);
  await userIdDropper(db);
}

/** Long enough that a year-over-year comparison is possible; pruned on write. */
const LEDGER_RETAIN_MONTHS = 13;

/** "2026-08-01T00:00:00.000Z" for any instant in Aug 2026. UTC on purpose —
 *  one boundary rather than one per timezone. */
export function monthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Input + output summed, nulls as 0; null when there is nothing to record at
 * all (both absent — some HF-routed models report no usage).
 */
export function tokensOf(
  usage?: { inputTokens: number | null; outputTokens: number | null } | null,
): number | null {
  if (!usage || (usage.inputTokens === null && usage.outputTokens === null)) return null;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** ISO-8601 Z strings compare lexicographically, so string >= is the window. */
export async function monthlyTokensUsed(db: Database): Promise<number> {
  await ensureUsageLedgerSchema(db);
  const row = await db
    .prepare("SELECT COALESCE(SUM(tokens), 0) AS total FROM usage_ledger WHERE ts >= ?")
    .bind(monthStartUtc())
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * Fire-and-forget: never throws, skips when the outcome carried no usage.
 * Prunes ledger rows older than the retention horizon in the same visit.
 */
export async function recordUsage(
  db: Database,
  operation: string,
  usage?: { inputTokens: number | null; outputTokens: number | null } | null,
): Promise<void> {
  try {
    const tokens = tokensOf(usage);
    if (tokens === null) return;
    await ensureUsageLedgerSchema(db);
    const now = new Date();
    const horizon = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - LEDGER_RETAIN_MONTHS, 1),
    ).toISOString();
    await db.batch([
      db
        .prepare("INSERT INTO usage_ledger (ts, operation, tokens) VALUES (?, ?, ?)")
        .bind(now.toISOString(), operation, tokens),
      db.prepare("DELETE FROM usage_ledger WHERE ts < ?").bind(horizon),
    ]);
  } catch (ledgerError) {
    console.error(`[budget] failed to record usage: ${(ledgerError as Error).message}`);
  }
}
