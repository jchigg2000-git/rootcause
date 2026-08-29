import { env } from "../../../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../../../lib/http.ts";
import { deleteServiceEntry } from "../../../../../lib/inventory.ts";

type Context = { params: Promise<{ id: string; serviceId: string }> };

/** Remove one maintenance entry. Both path ids are part of the delete's key. */
export async function DELETE(_request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const { id: machineId, serviceId } = await context.params;
  if (!(await deleteServiceEntry(db, machineId, serviceId))) {
    return jsonError("That maintenance entry is no longer recorded.", 404);
  }
  return jsonResponse({ ok: true });
}
