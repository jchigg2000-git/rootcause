import { env } from "../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { grantFor } from "../../lib/access.ts";
import { issueAccessToken, listAccessTokens } from "../../lib/auth/access-tokens.ts";

/**
 * The owner's console for access codes. Admin-only by `ADMIN_API_PREFIXES`, so
 * the handlers do not re-check the role — one global gate, per the house rule.
 *
 * There is no other way to create an account in this app, which makes POST here
 * the entire customer on-ramp.
 */

const MAX_LABEL = 120;
const MAX_CAP = 1_000_000_000;
const MAX_RUNS = 100_000;

/** Metadata only — the plaintext code is unrecoverable after issue. */
export async function GET() {
  const authDb = env.AUTH_DB;
  const appDb = env.APP_DB;
  if (!authDb) return jsonError("Auth storage is not configured on the server.", 500);

  const tokens = await listAccessTokens(authDb);
  const withSpend = await Promise.all(
    tokens.map(async (token) => {
      // A grant only exists once the code has been redeemed. Report spend as
      // null rather than 0 for an unredeemed code, so "issued but untouched"
      // and "redeemed but unspent" stay distinguishable in the UI.
      const grant = appDb && token.user_id ? await grantFor(appDb, token.user_id) : null;
      return {
        ...token,
        runs_used: grant?.runs_used ?? null,
        tokens_used: grant?.tokens_used ?? null,
      };
    }),
  );
  return jsonResponse({ tokens: withSpend });
}

export async function POST(request: Request) {
  const authDb = env.AUTH_DB;
  if (!authDb) return jsonError("Auth storage is not configured on the server.", 500);

  let body: { label?: unknown; runCap?: unknown; tokenCap?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_LABEL) : null;

  // What the code is sold as. The token cap below is the backstop behind it.
  const rawRuns = Number(body.runCap);
  if (!Number.isFinite(rawRuns) || rawRuns < 0 || rawRuns > MAX_RUNS) {
    return jsonError("Reports must be a whole number (0 for unlimited).", 400);
  }
  const runCap = Math.floor(rawRuns);

  const rawCap = Number(body.tokenCap);
  if (!Number.isFinite(rawCap) || rawCap < 0 || rawCap > MAX_CAP) {
    return jsonError("Token limit must be a whole number of tokens (0 for unlimited).", 400);
  }
  const tokenCap = Math.floor(rawCap);

  let expiresAt: string | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== "") {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return jsonError("Expiry must be between 1 and 3650 days, or blank for none.", 400);
    }
    expiresAt = new Date(Date.now() + Math.floor(days) * 86_400_000).toISOString();
  }

  const issued = await issueAccessToken(authDb, { label, runCap, tokenCap, expiresAt });

  // The one and only time the plaintext leaves the server. Only the SHA-256 is
  // stored, so this response cannot be reconstructed from the database later.
  return jsonResponse({ ...issued, expiresAt }, 201);
}
