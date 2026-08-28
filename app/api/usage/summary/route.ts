/**
 * Month-to-date token spend per user — the admin Accounts view's column.
 * Admin-only via ADMIN_API_PREFIXES; `/api/usage` (a viewer's own number)
 * stays separately session-gated.
 */
import { env } from "../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import { ensureUsageLedgerSchema, monthStartUtc } from "../../../lib/budget.ts";

export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Usage storage is not configured on the server.", 500);

  await ensureUsageLedgerSchema(db);
  const rows = await db
    .prepare(
      "SELECT user_id, COALESCE(SUM(tokens), 0) AS total FROM usage_ledger WHERE ts >= ? GROUP BY user_id",
    )
    .bind(monthStartUtc())
    .all<{ user_id: string; total: number }>();

  const byUser: Record<string, number> = {};
  let total = 0;
  for (const row of rows.results ?? []) {
    byUser[row.user_id] = row.total;
    total += row.total;
  }
  return jsonResponse({ byUser, total });
}
