import { env } from "../../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import {
  deleteMachine,
  getMachine,
  listServiceEntries,
  updateMachine,
} from "../../../lib/inventory.ts";
import { listCasesForMachine } from "../../../lib/library.ts";
import { validateMachineInput } from "../contract.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Read, edit and delete one machine.
 *
 * The writes go straight through with the owner in the `WHERE`, so a caller who
 * does not own the row changes nothing and gets the same 404 as for an id that
 * never existed — a check-then-write pair would both race and leak existence.
 */

/** Everything a machine's expanded card shows, in one round trip. */
export async function GET(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to view a machine.", 401);

  const { id } = await context.params;
  const machine = await getMachine(db, user.id, id);
  if (!machine) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({
    machine,
    service: await listServiceEntries(db, user.id, id),
    cases: await listCasesForMachine(db, user.id, id),
  });
}
export async function PUT(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to edit a machine.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const validated = validateMachineInput(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const { id } = await context.params;
  const machine = await updateMachine(db, user.id, id, validated.value);
  if (!machine) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({ machine });
}

export async function DELETE(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to remove a machine.", 401);

  const { id } = await context.params;
  if (!(await deleteMachine(db, user.id, id))) {
    return jsonError("That machine is no longer in your inventory.", 404);
  }

  return jsonResponse({ ok: true });
}
