/**
 * Entitlement: what a signed-in principal is allowed to spend.
 *
 * Replaced the Stripe `billing.ts` on 2026-08-18, when payments were removed
 * outright in favour of owner-issued access codes. There are exactly two
 * principals:
 *
 * - the **skeleton key** holder, role `admin` — unlimited and never blocked;
 * - a **redeemed access token**, role `viewer` — a LIFETIME allowance, not a
 *   monthly one, held in `token_grant`.
 *
 * **What a code buys is N generated reports**, decided 2026-08-19. `runs_used`
 * is the headline limit and the number quoted to a holder: "this code is good
 * for three field reports."
 *
 * Two ceilings sit behind it, because a run count alone bounds nothing:
 *
 * - **`token_cap`** — the lifetime backstop. A code can never spend more than
 *   this in total, however few reports it produced. Demoted from headline to
 *   backstop, not deleted: a run count bounds report volume, never spend.
 * - **the per-case ceiling** — `perCaseTokenCeiling`, enforced in the diagnose
 *   route against `diagnostic_case.tokens_spent`. A run is only counted when a
 *   report is delivered, so without this an interview that never converges
 *   spends forever and is never charged for it. That is the hole the two
 *   together close.
 *
 * Both caps are enforced against counters rather than a SUM over `usage_ledger`:
 * the ledger prunes past 13 months and would hand a long-lived token its
 * allowance back. The ledger still records every event — it is the audit trail
 * and what `/api/usage` reports — it is just not the enforcement point.
 *
 * Default-deny: a viewer with no grant row cannot spend. Absence of a record is
 * never permission.
 */
import tokenGrantSchema from "../../migrations/0012_token_grant.sql?raw";
import type { Database } from "./db.ts";
import { createColumnGuard, createSchemaRunner } from "./sql.ts";
import { recordUsage, tokensOf } from "./budget.ts";
import { type AccessCheck, decideAccess } from "./access-policy.ts";

export { ACCESS_UNVERIFIABLE_MESSAGE, accessDeniedMessage, decideAccess } from "./access-policy.ts";
export type { AccessCheck } from "./access-policy.ts";

const runTokenGrantSchema = createSchemaRunner(tokenGrantSchema);
// Grown databases predate the run columns. The CREATE in 0012 covers fresh
// ones; migrations re-run in full on every boot, so a bare ALTER there would
// fail boot #2.
const runCapGuard = createColumnGuard("token_grant", "run_cap", "INTEGER NOT NULL DEFAULT 0");
const runsUsedGuard = createColumnGuard("token_grant", "runs_used", "INTEGER NOT NULL DEFAULT 0");

export async function ensureTokenGrantSchema(db: Database): Promise<void> {
  await runTokenGrantSchema(db);
  await runCapGuard(db);
  await runsUsedGuard(db);
}

export type TokenGrant = {
  user_id: string;
  run_cap: number;
  runs_used: number;
  token_cap: number;
  tokens_used: number;
  source_token_id: string | null;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

export async function grantFor(db: Database, userId: string): Promise<TokenGrant | null> {
  await ensureTokenGrantSchema(db);
  const row = await db
    .prepare("SELECT * FROM token_grant WHERE user_id = ?")
    .bind(userId)
    .first<TokenGrant>();
  return row ?? null;
}

/** Written once, at redemption. Idempotent so a retried redemption is safe. */
export async function createGrant(
  db: Database,
  userId: string,
  runCap: number,
  tokenCap: number,
  sourceTokenId: string | null,
): Promise<void> {
  await ensureTokenGrantSchema(db);
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO token_grant (user_id, run_cap, runs_used, token_cap, tokens_used, source_token_id, created_at, updated_at)
       VALUES (?, ?, 0, ?, 0, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, runCap, tokenCap, sourceTokenId, timestamp, timestamp)
    .run();
}

/**
 * May this principal spend? Admins (the skeleton key) are exempt. A cap of 0 is
 * unlimited. Deliberately NOT fail-open: unlike the old budget check, a viewer
 * without a readable grant is refused, because a grant is the only thing that
 * authorises spend now. A storage failure therefore denies rather than gifting
 * an unmetered call against the owner's Anthropic key.
 */
export async function checkAccess(
  db: Database,
  user: { id: string; role: string },
): Promise<AccessCheck> {
  if (user.role === "admin") return { allowed: true, exempt: true };
  return decideAccess(user.role, await grantFor(db, user.id));
}

/**
 * Drop-in replacement for the old `recordUsageWithOverage` at every billable
 * call site: the ledger write, then the lifetime counter. Fire-and-forget —
 * a metering hiccup must never fail the diagnosis that produced it — but the
 * counter increment is the thing that makes the cap real, so it is attempted
 * even when the ledger write fails. Admins are recorded and never capped.
 */
export async function recordGrantUsage(
  db: Database,
  actor: { id: string; role: string },
  operation: string,
  usage: { inputTokens: number | null; outputTokens: number | null } | null | undefined,
): Promise<void> {
  await recordUsage(db, actor.id, operation, usage);
  if (actor.role === "admin") return;
  try {
    const tokens = tokensOf(usage);
    if (tokens === null || tokens <= 0) return;
    await ensureTokenGrantSchema(db);
    await db
      .prepare(
        "UPDATE token_grant SET tokens_used = tokens_used + ?, updated_at = ? WHERE user_id = ?",
      )
      .bind(tokens, now(), actor.id)
      .run();
  } catch (grantError) {
    console.error(`[access] grant counter update failed: ${(grantError as Error).message}`);
  }
}

/**
 * Count a delivered report against the grant.
 *
 * Deliberately NOT called next to `recordGrantUsage`, which fires right after
 * the model returns. A report can still fail to parse after that, and charging
 * a run for a report the operator never received is the one unfairness this
 * scheme has to avoid. The call site is the success path, after the document
 * renders.
 *
 * Fire-and-forget, like the spend counter: a metering hiccup must never fail a
 * diagnosis. Admins are exempt and never counted.
 */
export async function recordGrantRun(
  db: Database,
  actor: { id: string; role: string },
): Promise<void> {
  if (actor.role === "admin") return;
  try {
    await ensureTokenGrantSchema(db);
    await db
      .prepare("UPDATE token_grant SET runs_used = runs_used + 1, updated_at = ? WHERE user_id = ?")
      .bind(now(), actor.id)
      .run();
  } catch (runError) {
    console.error(`[access] grant run counter update failed: ${(runError as Error).message}`);
  }
}
