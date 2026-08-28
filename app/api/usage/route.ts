import { env } from "../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { monthlyTokensUsed } from "../../lib/budget.ts";
import { grantFor } from "../../lib/access.ts";

/**
 * The caller's own spend against their own allowance. Session-gated by
 * default-deny, deliberately not admin-gated — a viewer reads only their own
 * number, and the number is what explains a 429 before it happens.
 *
 * `runsUsed`/`runCap` are the headline limit — the reports the code was sold
 * as. `tokensUsed`/`tokenCap` are the lifetime backstop behind it, shown as a
 * secondary figure. `monthTokens` is the calendar-month figure the ledger still
 * reports. All three differ on purpose and the client labels them differently.
 */
export async function GET(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Usage storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to view usage.", 401);

  const exempt = user.role === "admin";
  const grant = exempt ? null : await grantFor(db, user.id);

  return jsonResponse({
    monthTokens: await monthlyTokensUsed(db, user.id),
    runsUsed: grant?.runs_used ?? 0,
    runCap: grant?.run_cap ?? 0,
    tokensUsed: grant?.tokens_used ?? 0,
    tokenCap: grant?.token_cap ?? 0,
    hasGrant: exempt || grant !== null,
    exempt,
  });
}
