/**
 * Path classification for the gate.
 *
 * Kept free of D1 and of the `?raw` schema imports so the allowlist can be
 * unit-tested directly — this is the piece where a mistake silently exposes a
 * route, so it should not require a running Worker to check.
 */

/** Reachable without a session. `/api/auth/login` is the only way in and takes
 *  either the skeleton key or an access code — there is no signup, no password
 *  reset, and no unauthenticated billing callback any more. */
export const PUBLIC_API = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

/** Requires role === "admin" — in practice, the skeleton-key holder. Prefix
 *  match, so /api/tokens/:id is covered. Issuing and revoking access codes is
 *  the owner's console and must never be reachable by a token holder;
 *  random-scenario is a billable demo affordance; usage/summary is every
 *  user's spend, which no viewer may read. */
export const ADMIN_API_PREFIXES = [
  "/api/observability",
  "/api/random-scenario",
  "/api/tokens",
  "/api/usage/summary",
];

/** Trailing slashes are stripped so `/api/health/` cannot slip past the set. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export const isApiPath = (pathname: string) => pathname.startsWith("/api/");

export const isPublicPath = (pathname: string) => PUBLIC_API.has(pathname);

export const isAdminPath = (pathname: string) =>
  ADMIN_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * Admin-gated writes that are not simply prefix-matched: settings are readable
 * by any signed-in viewer but writable only by an admin.
 */
export const isAdminWrite = (pathname: string, method: string) =>
  pathname === "/api/settings" && method !== "GET";

/** Methods that mutate state and therefore need the Origin check. */
export const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
