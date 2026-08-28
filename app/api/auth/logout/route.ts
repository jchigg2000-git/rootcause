import { env } from "../../../lib/server-env.ts";
import { clearSessionCookie, clientIp, readSessionCookie } from "../../../lib/auth/cookies.ts";
import { jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import { deleteSession, recordAuthEvent, resolveSession } from "../../../lib/auth/store.ts";

export async function POST(request: Request) {
  const db = env.AUTH_DB;
  if (!db) return jsonError("Auth storage is not configured on the server.", 500);

  const token = readSessionCookie(request);
  // A logout with no cookie presented is a no-op. Treating it as success
  // without touching state keeps it from being usable to force anyone out.
  if (!token) return jsonResponse({ ok: true });

  const user = await resolveSession(db, token);
  await deleteSession(db, token);
  if (user) await recordAuthEvent(db, "logout", user.email, clientIp(request));

  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": clearSessionCookie(env.COOKIE_SECURE),
  });
}
