import { env } from "../../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../../lib/http.ts";
import { addServiceEntry } from "../../../../lib/inventory.ts";
import { validateServiceEntry } from "../../contract.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Add one dated maintenance entry to a machine. The insert is an
 * `INSERT … SELECT` against the machine row, so a machine that has since been
 * deleted inserts nothing and answers 404 rather than orphaning an entry.
 */
export async function POST(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const validated = validateServiceEntry(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const { id } = await context.params;
  const entry = await addServiceEntry(db, id, validated.value);
  if (!entry) return jsonError("That machine is no longer in your inventory.", 404);

  return jsonResponse({ entry }, 201);
}
