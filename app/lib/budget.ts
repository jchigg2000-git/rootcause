/**
 * Per-user token accounting. This module RECORDS; it does not enforce.
 *
 * The ledger lives in APP_DB, deliberately NOT observability.db: the
 * observability store is prunable exhaust with a one-way data flow and must
 * never be read for enforcement — its 14-day retention would silently erase
 * the numbers a monthly budget adds up. Routes write here themselves from the
 * `ChatOutcome.usage` they already hold, so `providers.ts`'s telemetry emit
 * stays the observability subsystem's only feed and the one-way rule holds.
 *
 * ⚠ The calendar-month scheme decided 2026-08-06 — hard block when exhausted,
 * admins exempt, 0 means unlimited — was SUPERSEDED by the access-code grant.
 * `checkBudget` and `budgetExhaustedMessage` below have no callers; entitlement
 * is decided by `decideAccess` in `access-policy.ts` against a code's lifetime
 * allowance, not against a month. What is live here is `monthlyTokensUsed`, a
 * display read behind `/api/usage`, and `monthStartUtc`.
 */
import usageLedgerSchema from "../../migrations/0009_usage_ledger.sql?raw";
import type { Database } from "./db.ts";
import { createSchemaRunner } from "./sql.ts";

export const ensureUsageLedgerSchema = createSchemaRunner(usageLedgerSchema);

/** Keep well past any month a budget can ask about; prune the rest on write. */
const LEDGER_RETAIN_MONTHS = 13;

/** "2026-08-01T00:00:00.000Z" for any instant in Aug 2026. UTC on purpose —
 *  one boundary for every viewer, not one per timezone. */
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
export async function monthlyTokensUsed(db: Database, userId: string): Promise<number> {
  await ensureUsageLedgerSchema(db);
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(tokens), 0) AS total FROM usage_ledger WHERE user_id = ? AND ts >= ?",
    )
    .bind(userId, monthStartUtc())
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * Fire-and-forget: never throws, skips when the outcome carried no usage.
 * Prunes ledger rows older than the retention horizon in the same visit.
 */
export async function recordUsage(
  db: Database,
  userId: string,
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
        .prepare("INSERT INTO usage_ledger (user_id, ts, operation, tokens) VALUES (?, ?, ?, ?)")
        .bind(userId, now.toISOString(), operation, tokens),
      db.prepare("DELETE FROM usage_ledger WHERE ts < ?").bind(horizon),
    ]);
  } catch (ledgerError) {
    console.error(`[budget] failed to record usage: ${(ledgerError as Error).message}`);
  }
}

export type BudgetCheck =
  | { allowed: true }
  | { allowed: false; used: number; budget: number };

/** Admins are exempt; a budget of 0 means unlimited. */
export async function checkBudget(
  db: Database,
  user: { id: string; role: string },
  budget: number,
): Promise<BudgetCheck> {
  if (budget <= 0 || user.role === "admin") return { allowed: true };
  const used = await monthlyTokensUsed(db, user.id);
  if (used < budget) return { allowed: true };
  return { allowed: false, used, budget };
}

/** The operator-facing refusal, worded once so every billable route matches. */
export function budgetExhaustedMessage(budget: number): string {
  return (
    `You've used this month's allowance of ${budget.toLocaleString("en-US")} tokens. ` +
    "It resets on the 1st; an administrator can raise it in Settings."
  );
}
