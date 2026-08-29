import type { Database } from "../../lib/db.ts";
import { env } from "../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../lib/http.ts";
import { MODEL_CATALOG, PROVIDERS, applySettingsPatch, getSettings } from "../../lib/settings.ts";
import { providerConfigured } from "../diagnose/providers.ts";

/**
 * Which providers have credentials, as booleans.
 *
 * Deliberately not a masked prefix or a key length: the operator needs to know
 * *whether* a provider will work, and nothing about the secret itself should
 * cross the wire. `HF_TOKEN` and `ANTHROPIC_API_KEY` are billable.
 */
const providerStatus = () =>
  Object.fromEntries(PROVIDERS.map((provider) => [provider, providerConfigured(provider)]));

/** GET and PUT answer with the same shape, so the client has one type to hold. */
const payload = async (db: Database) => ({
  settings: await getSettings(db),
  catalog: MODEL_CATALOG,
  providers: providerStatus(),
});

export async function GET() {
  const db = env.APP_DB;
  if (!db) return jsonError("Settings storage is not configured on the server.", 500);
  return jsonResponse(await payload(db));
}

export async function PUT(request: Request) {
  const db = env.APP_DB;
  if (!db) return jsonError("Settings storage is not configured on the server.", 500);

  let patch: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("Send an object of settings to change.", 400);
    }
    patch = body as Record<string, unknown>;
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const result = await applySettingsPatch(db, patch);
  if (!result.ok) return jsonError(result.error, 400);

  return jsonResponse(await payload(db));
}
