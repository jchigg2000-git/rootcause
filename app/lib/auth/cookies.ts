/** Session cookie handling and the client-IP rule for a single-proxy deploy. */

export const SESSION_COOKIE = "rootcause_session";

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * `Secure` is on unless COOKIE_SECURE is explicitly "false", so a forgotten env
 * var fails closed. `SameSite=Lax` plus the Origin check in the gate is the
 * CSRF pair — neither is relied on alone.
 */
export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number | null,
  cookieSecure: string | undefined,
): string {
  const secure = cookieSecure?.trim().toLowerCase() !== "false";
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    ...(secure ? ["Secure"] : []),
    // No Max-Age at all makes it a browser-session cookie, which is what the
    // 12-hour "not remembered" case wants on the client side; the server-side
    // session row still expires on its own schedule.
    ...(maxAgeSeconds === null ? [] : [`Max-Age=${maxAgeSeconds}`]),
  ];
  return parts.join("; ");
}

export function clearSessionCookie(cookieSecure: string | undefined): string {
  const secure = cookieSecure?.trim().toLowerCase() !== "false";
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    ...(secure ? ["Secure"] : []),
    "Max-Age=0",
  ].join("; ");
}

/**
 * Client IP for throttling.
 *
 * Running on plain Node with no reverse proxy in front, NEITHER header is
 * normally present and this returns "unknown" — every caller then shares one
 * throttle bucket, which is strict rather than permissive and so fails safe.
 *
 * CF-Connecting-IP is checked first and is now effectively dead: it was set by
 * Cloudflare and unspoofable there, but nothing injects it here. Kept because a
 * proxy that does set it should still win. Falling back to X-Forwarded-For,
 * take the RIGHTMOST hop: the left of that chain is caller-supplied and forging
 * it would hand an attacker an unlimited number of throttle buckets.
 */
export function clientIp(request: Request): string {
  const connecting = request.headers.get("cf-connecting-ip");
  if (connecting) return connecting.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }

  return "unknown";
}
