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
 * Refuse a state-changing API call that came from another site.
 *
 * This is not CSRF defence — there is no session cookie left for an attacker to
 * ride. It is a spend guard. `/api/diagnose`, `/api/spec-lookup`,
 * `/api/parts-lookup` and `/api/random-scenario` all reach a billable provider
 * key, and a page the operator happens to be visiting can otherwise
 * `fetch("http://localhost:5211/…")` in the background and run up their bill.
 * Nothing is stolen; the cost is the attack.
 *
 * **`Sec-Fetch-Site` decides on its own whenever it is present.** It is the
 * browser's own verdict about the initiating document, and it is a forbidden
 * header name, so page script cannot set it. It is also the only signal a proxy
 * cannot disturb — which matters, because the deployment this app tells people
 * to use is behind one.
 *
 * **Falling back to `Origin`, only the HOST is compared, never the scheme.**
 * Behind a TLS-terminating proxy the browser sends `Origin: https://host` while
 * the server sees `http://host` internally, so comparing whole origins refuses
 * every write in exactly the configuration `SECURITY.md` recommends. That was
 * the bug this shape exists to avoid. Comparing hosts is still the real control:
 * a genuinely cross-site page is at a different host, and an attacker who
 * already controls `http://` on your own hostname has beaten you elsewhere.
 *
 * An unparseable or opaque `Origin` — the literal `null` a sandboxed frame
 * sends — counts as cross-site and is refused.
 *
 * A request carrying NEITHER header is not a browser: it is a script or a
 * terminal, which the operator ran themselves, and it carries no ambient
 * authority for a third party to borrow. It passes.
 */
export function isCrossOriginWrite(
  method: string,
  origin: string | null,
  secFetchSite: string | null,
  appOrigin: string,
): boolean {
  if (!STATE_CHANGING.has(method)) return false;
  if (secFetchSite) return secFetchSite !== "same-origin" && secFetchSite !== "none";
  if (origin) return !sameHost(origin, appOrigin);
  return false;
}

/** Host and port, ignoring the scheme. Anything unparseable is not same-host. */
function sameHost(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).host === new URL(appOrigin).host;
  } catch {
    return false;
  }
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
