import { env } from "../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { listCasesForUser } from "../../lib/library.ts";

/**
 * The signed-in user's own diagnostic cases, newest activity first.
 *
 * Session-gated by default-deny (`middleware.ts` + `PUBLIC_API`), and
 * deliberately not admin-gated: this is a viewer's own history. `currentUser()`
 * supplies the id that every statement in `library.ts` filters on — an admin
 * gets their own rows here and nobody else's, which is unratified territory.
 */
export async function GET(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Report storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to view your reports.", 401);

  return jsonResponse({ cases: await listCasesForUser(db, user.id) });
}
