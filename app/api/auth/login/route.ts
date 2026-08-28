import { env } from "../../../lib/server-env.ts";
import { clientIp, serializeSessionCookie } from "../../../lib/auth/cookies.ts";
import { jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import { createGrant } from "../../../lib/access.ts";
import { redeemAccessToken } from "../../../lib/auth/access-tokens.ts";
import { looksLikeSkeletonKey, verifySkeletonKey } from "../../../lib/auth/skeleton-key.ts";
import {
  SESSION_TTL_REMEMBER_MS,
  SESSION_TTL_SESSION_MS,
  clearLoginAttempts,
  createSession,
  createTokenUser,
  ensureOwner,
  findUserById,
  isLoginThrottled,
  recordAuthEvent,
  recordLoginAttempt,
} from "../../../lib/auth/store.ts";

/**
 * Sign in with ONE credential field.
 *
 * There are no passwords in this app (2026-08-18). Two things get you in:
 *
 * - the **skeleton key** from `$DB_DIR/skeleton.key` — the owner, role admin;
 * - an **access token code** the owner issued — role viewer, with a lifetime
 *   allowance recorded in `token_grant`.
 *
 * Both are bearer secrets presented in the same box, which is deliberate: the
 * operator does not need to know which kind they were handed, and the server
 * does not leak which kind was guessed. Every failure answers with one string
 * and one status, so this endpoint cannot be used as an oracle for whether a
 * given code exists.
 */
const INVALID = "That key or access code is not recognized.";

/**
 * The whole body is `{ credential, remember }` — a skeleton key or a 24-char
 * `RC-` code, plus a boolean. 4KB is orders of magnitude more than that needs
 * and still small enough to be free to buffer.
 *
 * This is the only PUBLIC route that reads a body (`PUBLIC_API` in
 * `app/lib/auth/paths.ts`), so it is the only one an anonymous caller can make
 * allocate. It used to call `request.json()` directly, which buffers the entire
 * body before parsing, while all three billable routes measured `byteLength`
 * first. The throttle below is no help here: it does not run until after the
 * body has already been read.
 *
 * `content-length` is not the check — it is absent on chunked uploads and
 * trivially wrong on hostile ones. Measure what actually arrived.
 */
const MAX_LOGIN_BYTES = 4 * 1024;

export async function POST(request: Request) {
  const authDb = env.AUTH_DB;
  const appDb = env.APP_DB;
  if (!authDb) return jsonError("Auth storage is not configured on the server.", 500);

  const ip = clientIp(request);

  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return jsonError("The sign-in request could not be read.", 400);
  }
  if (raw.byteLength > MAX_LOGIN_BYTES) {
    return jsonError("The sign-in request is too large.", 413);
  }

  // The object check is not belt-and-braces: a body of literally `null` parses
  // fine and then throws on `body.credential`, so it answered an unauthenticated
  // 500 rather than a 400.
  let body: { credential?: unknown; remember?: unknown };
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as { credential?: unknown; remember?: unknown };
  } catch {
    return jsonError("The sign-in request could not be read.", 400);
  }

  // Per-IP only: there is no account identifier to bucket by any more, and a
  // code is high-entropy enough that the realistic attack is volume, not a
  // targeted guess against one known account.
  if (await isLoginThrottled(authDb, ip, null)) {
    await recordAuthEvent(authDb, "login.throttled", null, ip);
    return jsonError("Too many sign-in attempts. Try again in 15 minutes.", 429);
  }

  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  if (!credential) {
    await recordLoginAttempt(authDb, ip, null);
    await recordAuthEvent(authDb, "login.failure", null, ip);
    return jsonError(INVALID, 401);
  }

  const remember = body.remember === true;
  const ttl = remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_SESSION_MS;

  const issue = async (userId: string, actorLabel: string, detail: string) => {
    const token = await createSession(authDb, userId, ttl);
    await clearLoginAttempts(authDb, ip, null);
    await recordAuthEvent(authDb, "login.success", actorLabel, ip, detail);
    return token;
  };

  // ---- the skeleton key -----------------------------------------------
  if (looksLikeSkeletonKey(credential)) {
    if (!verifySkeletonKey(credential)) {
      await recordLoginAttempt(authDb, ip, null);
      await recordAuthEvent(authDb, "login.failure", "skeleton-key", ip);
      return jsonError(INVALID, 401);
    }
    const owner = await ensureOwner(authDb);
    const token = await issue(owner.id, owner.email, remember ? "key/remembered" : "key");
    return jsonResponse({ user: owner }, 200, {
      "Set-Cookie": serializeSessionCookie(
        token,
        remember ? Math.floor(SESSION_TTL_REMEMBER_MS / 1000) : null,
        env.COOKIE_SECURE,
      ),
    });
  }

  // ---- an access token code -------------------------------------------
  if (!appDb) return jsonError("Access storage is not configured on the server.", 500);

  const outcome = await redeemAccessToken(authDb, credential, async () => {
    const user = await createTokenUser(authDb, null);
    return user.id;
  });

  if (!outcome.ok) {
    await recordLoginAttempt(authDb, ip, null);
    await recordAuthEvent(authDb, "login.failure", `token:${outcome.reason}`, ip);
    return jsonError(INVALID, 401);
  }

  const userId = outcome.token.user_id as string;

  // The grant is written only for the account that actually won the claim. A
  // user minted by a losing concurrent redemption is left with no grant and no
  // session, so it is unreachable rather than an unbudgeted way in.
  if (outcome.firstUse) {
    await createGrant(
      appDb,
      userId,
      outcome.token.run_cap,
      outcome.token.token_cap,
      outcome.token.id,
    );
  }

  const user = await findUserById(authDb, userId);
  if (!user) {
    await recordAuthEvent(authDb, "login.failure", "token:orphaned", ip);
    return jsonError(INVALID, 401);
  }

  const token = await issue(
    user.id,
    user.email,
    `${outcome.firstUse ? "token/first" : "token/resume"}${remember ? "/remembered" : ""}`,
  );
  return jsonResponse({ user }, 200, {
    "Set-Cookie": serializeSessionCookie(
      token,
      remember ? Math.floor(SESSION_TTL_REMEMBER_MS / 1000) : null,
      env.COOKIE_SECURE,
    ),
  });
}
