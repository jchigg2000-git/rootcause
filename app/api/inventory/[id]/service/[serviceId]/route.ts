import { env } from "../../../../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../../../../lib/auth/current-user.ts";
import { deleteServiceEntry } from "../../../../../lib/inventory.ts";

type Context = { params: Promise<{ id: string; serviceId: string }> };

/** Remove one maintenance entry; ownership is the delete's own WHERE. */
export async function DELETE(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Inventory storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to remove a maintenance entry.", 401);

  const { id: machineId, serviceId } = await context.params;
  if (!(await deleteServiceEntry(db, user.id, machineId, serviceId))) {
    return jsonError("That maintenance entry is no longer recorded.", 404);
  }
  return jsonResponse({ ok: true });
}
