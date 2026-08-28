import { env } from "../../../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../../../lib/auth/current-user.ts";
import { addServiceEntry } from "../../../../lib/inventory.ts";
import { validateServiceEntry } from "../../contract.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Add one dated maintenance entry to a machine. The insert itself proves
 * machine ownership (INSERT … SELECT with the owner in the WHERE), so a
 * machine that is not the caller's answers the same 404 as one that does not
 * exist.
 */
export async function POST(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to record maintenance.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const validated = validateServiceEntry(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const { id } = await context.params;
  const entry = await addServiceEntry(db, user.id, id, validated.value);
  if (!entry) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({ entry }, 201);
}
