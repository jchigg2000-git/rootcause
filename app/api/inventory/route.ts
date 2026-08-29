import { env } from "../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../lib/http.ts";
import { createMachine, listMachines } from "../../lib/inventory.ts";
import { validateMachineInput } from "./contract.ts";

/** The machine inventory: list, and add. */
export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  return jsonResponse({ machines: await listMachines(db) });
}

export async function POST(request: Request) {
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

  return jsonResponse({ machine: await createMachine(db, validated.value) }, 201);
}
