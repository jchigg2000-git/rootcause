import { env } from "../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../lib/http.ts";
import { monthlyTokensUsed } from "../../lib/usage.ts";

/**
 * Month-to-date token spend, from the usage ledger.
 *
 * Informational only — nothing in the app refuses a request over this number.
 * It exists because running RootCause spends the operator's own provider key,
 * and a figure they have to open a SQLite file to see is a figure nobody looks
 * at until the bill arrives.
 */
export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Usage storage is not configured on the server.", 500);

  return jsonResponse({ monthTokens: await monthlyTokensUsed(db) });
}
