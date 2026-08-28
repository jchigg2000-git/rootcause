import { env } from "../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { createMachine, listMachines } from "../../lib/inventory.ts";
import { validateMachineInput } from "./contract.ts";

/**
 * The signed-in user's machine inventory.
 *
 * Session-gated by default-deny: `middleware.ts` runs ahead of the app router
 * and `/api/inventory` is not in `PUBLIC_API` (`app/lib/auth/paths.ts`), so an
 * anonymous caller never reaches this file. It is deliberately **not** in
 * `ADMIN_API_PREFIXES` — an inventory is a viewer's own record, not an admin
 * surface, and nothing here costs money.
 *
 * `currentUser()` is still called, because the gate answers *whether* the
 * caller is allowed in and this handler needs to know *who* they are: the id
 * is the ownership filter on every statement, not a display detail.
 */
export async function GET(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to view your machines.", 401);

  return jsonResponse({ machines: await listMachines(db, user.id) });
}

export async function POST(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to add a machine.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const validated = validateMachineInput(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  return jsonResponse({ machine: await createMachine(db, user.id, validated.value) }, 201);
}
