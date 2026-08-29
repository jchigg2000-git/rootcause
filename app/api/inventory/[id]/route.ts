import { env } from "../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../lib/http.ts";
import {
  deleteMachine,
  getMachine,
  listServiceEntries,
  updateMachine,
} from "../../../lib/inventory.ts";
import { listCasesForMachine } from "../../../lib/library.ts";
import { validateMachineInput } from "../contract.ts";

type Context = { params: Promise<{ id: string }> };

/** Read, edit and delete one machine. */

/** Everything a machine's expanded card shows, in one round trip. */
export async function GET(_request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const { id } = await context.params;
  const machine = await getMachine(db, id);
  if (!machine) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({
    machine,
    service: await listServiceEntries(db, id),
    cases: await listCasesForMachine(db, id),
  });
}

export async function PUT(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const validated = validateMachineInput(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const { id } = await context.params;
  const machine = await updateMachine(db, id, validated.value);
  if (!machine) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({ machine });
}

export async function DELETE(_request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const { id } = await context.params;
  if (!(await deleteMachine(db, id))) {
    return jsonError("That machine is no longer in your inventory.", 404);
  }

  return jsonResponse({ ok: true });
}
