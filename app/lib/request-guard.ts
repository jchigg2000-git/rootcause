/**
 * The two things `middleware.ts` does to every request.
 *
 * RootCause has no accounts, no sessions and no login. Whoever can reach the
 * server is the operator, so there is no identity to check and no allowlist to
 * keep — a route added later needs nothing done to it. What survives from the
 * gate that used to live here is the part that was never about identity.
 *
 * Kept free of the database and of the `?raw` schema imports so it can be
 * exercised under a plain `node --test` run; `tests/request-guard.test.mjs`
 * pins both halves.
 */

/** Methods that change state, and therefore get the origin check below. */
export const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Trailing slashes are stripped so `/api/diagnose/` classifies like `/api/diagnose`. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export const isApiPath = (pathname: string) => pathname.startsWith("/api/");

/**
 * Refuse a state-changing API call that came from another origin.
 *
 * This is no longer CSRF defence — there is no session cookie left for an
 * attacker to ride. It is a spend guard. `/api/diagnose`, `/api/spec-lookup`
 * and `/api/parts-lookup` all reach a billable provider key, and a page the
 * operator happens to visit can otherwise `fetch("http://localhost:5211/…")`
 * in the background and run up their bill. Nothing is stolen; the cost is the
 * attack.
 *
 * Two signals, because either alone fails open. `Origin` is absent on some
 * requests browsers make and on every `curl`. `Sec-Fetch-Site` is always sent
 * by browsers and cannot be set from page script, so a cross-site value is
 * refused even when `Origin` is missing. A request carrying NEITHER header is
 * not a browser — it is a script or a terminal, which the operator ran
 * themselves — so it is allowed through rather than blocked.
 */
export function isCrossOriginWrite(
  method: string,
  origin: string | null,
  secFetchSite: string | null,
  appOrigin: string,
): boolean {
  if (!STATE_CHANGING.has(method)) return false;
  if (origin && origin !== appOrigin) return true;
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return true;
  return false;
}

/**
 * Applied to every response, refused or not.
 *
 * HSTS only in production: sending it from a plain-HTTP local dev server would
 * pin `localhost` to HTTPS in the browser for a year, which breaks every other
 * project on the machine and is not undoable from the app.
 */
export function withSecurityHeaders(response: Response, isProduction: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  if (isProduction) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
