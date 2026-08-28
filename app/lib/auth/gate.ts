/**
 * The single global request gate.
 *
 * It runs in `middleware.ts`, ahead of the app router, so a route added later
 * is protected by default. Opting a route out means editing PUBLIC_API here —
 * never decorating the route itself.
 */
import type { Database } from "../db.ts";
import { clientIp, readSessionCookie } from "./cookies.ts";
import {
  STATE_CHANGING,
  isAdminPath,
  isAdminWrite,
  isApiPath,
  isPublicPath,
  normalizePath,
} from "./paths.ts";
import { ensureAuthSchema, ensureOwner, resolveSession, type User } from "./store.ts";


export type GateEnv = {
  AUTH_DB?: Database;
  COOKIE_SECURE?: string;
  ENVIRONMENT?: string;
};

export type GateResult =
  | { kind: "pass"; user: User | null }
  | { kind: "reject"; response: Response };

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Applied to every response, authenticated or not. */
export function withSecurityHeaders(response: Response, isProduction: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  if (isProduction) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function gate(request: Request, env: GateEnv): Promise<GateResult> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);

  // Non-API paths are the app shell and its assets. They render their own
  // signed-out state; blocking them here would break the login page itself.
  if (!isApiPath(pathname)) return { kind: "pass", user: null };

  if (!env.AUTH_DB) {
    return {
      kind: "reject",
      response: json({ error: "Auth storage is not configured on the server." }, 500),
    };
  }

  try {
    await ensureAuthSchema(env.AUTH_DB);
    await ensureOwner(env.AUTH_DB);
  } catch (schemaError) {
    // These run on every request, so an auth-store failure previously threw
    // unhandled through middleware and surfaced as a bare 500 with nothing in
    // the logs to find it by. Fail closed, loudly, and say which half broke.
    console.error(`[auth] auth store unavailable: ${(schemaError as Error).message}`);
    return {
      kind: "reject",
      response: json({ error: "Authentication is temporarily unavailable." }, 503),
    };
  }

  // Same-origin check on every state-changing API call. SameSite=Lax is the
  // other half of this pair, deliberately not the whole of it.
  //
  // `Origin` alone fails open when the header is absent, which every browser
  // sends but no curl does. `Sec-Fetch-Site` is the second signal: browsers
  // always send it and it cannot be set by page script, so a cross-site value
  // is refused even when Origin is missing. A request with neither header is
  // not a browser, so it carries no ambient cookie for an attacker to ride.
  if (STATE_CHANGING.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return { kind: "reject", response: json({ error: "Cross-origin request rejected." }, 403) };
    }
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return { kind: "reject", response: json({ error: "Cross-origin request rejected." }, 403) };
    }
  }

  const token = readSessionCookie(request);
  let user: User | null = null;
  if (token) {
    try {
      user = await resolveSession(env.AUTH_DB, token);
    } catch (sessionError) {
      // Same reasoning as the schema block above. Failing closed here means a
      // storage fault can never be mistaken for a valid session.
      console.error(`[auth] session resolve failed: ${(sessionError as Error).message}`);
      return {
        kind: "reject",
        response: json({ error: "Authentication is temporarily unavailable." }, 503),
      };
    }
  }

  if (isPublicPath(pathname)) return { kind: "pass", user };

  if (!user) {
    return { kind: "reject", response: json({ error: "Sign in to continue." }, 401) };
  }

  if ((isAdminPath(pathname) || isAdminWrite(pathname, request.method)) && user.role !== "admin") {
    return { kind: "reject", response: json({ error: "Administrator access is required." }, 403) };
  }

  return { kind: "pass", user };
}

export { clientIp };
export { PUBLIC_API, ADMIN_API_PREFIXES } from "./paths.ts";
