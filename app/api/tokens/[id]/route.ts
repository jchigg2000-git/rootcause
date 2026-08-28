import { env } from "../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import { revokeAccessToken } from "../../../lib/auth/access-tokens.ts";
import { deleteSessionsForUser } from "../../../lib/auth/store.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Revoke an access code.
 *
 * Two things have to happen or revocation is theatre: the row is marked so the
 * code can never be redeemed or resumed again, AND every session the holder is
 * already carrying is dropped. Marking the row alone would leave a signed-in
 * holder working for up to 30 days on a revoked code.
 *
 * The grant row in app.db is deliberately left in place — it is the spend
 * record, and deleting it would erase what the code actually cost.
 */
export async function DELETE(_request: Request, context: Context) {
  const authDb = env.AUTH_DB;
  if (!authDb) return jsonError("Auth storage is not configured on the server.", 500);

  const { id } = await context.params;
  const row = await revokeAccessToken(authDb, id);
  if (!row) return jsonError("That access code does not exist.", 404);

  if (row.user_id) await deleteSessionsForUser(authDb, row.user_id);

  return jsonResponse({ revoked: true, id, sessionsCleared: Boolean(row.user_id) });
}
