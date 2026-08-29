import { env } from "../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../lib/http.ts";
import { listCases } from "../../lib/library.ts";

/** Every diagnostic case, newest activity first. */
export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Report storage is not configured on the server.", 500);

  return jsonResponse({ cases: await listCases(db) });
}
