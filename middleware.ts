/**
 * Runs ahead of both page and API dispatch.
 *
 * There is no authentication in this app, so this is not a gate: it adds
 * security headers to every response and refuses a state-changing API call
 * that arrived from another origin, which is a spend guard rather than a CSRF
 * one. Both rules live in `app/lib/request-guard.ts` with the reasoning; this
 * file is only the wiring.
 *
 * Note the filename. vinext looks for `proxy.ts` first and warns that this is
 * the Next.js 15 spelling; both work. Renaming is a one-line change whenever
 * that warning becomes noise.
 *
 * Headers ride on EVERY response, not just refusals. Returning `undefined`
 * continues to the route but drops them, which is what an earlier version
 * regressed. The fix is vinext's continue-with-headers signal: a response
 * carrying `x-middleware-next: 1` means "keep routing", and
 * `mergeMiddlewareResponseHeaders` copies the rest of its headers onto
 * whatever the route eventually returns. Verified against
 * `node_modules/vinext/dist/server/middleware-runtime.js` (the
 * `x-middleware-next` branch) and `middleware-response-headers.js`.
 */
import {
  isApiPath,
  isCrossOriginWrite,
  normalizePath,
  withSecurityHeaders,
} from "./app/lib/request-guard.ts";
import { env } from "./app/lib/server-env.ts";

/** vinext's "continue routing" marker; stripped before the client sees it. */
const CONTINUE = () => new Response(null, { headers: { "x-middleware-next": "1" } });

export async function middleware(request: Request): Promise<Response> {
  const isProduction = env.ENVIRONMENT === "production";
  const url = new URL(request.url);

  if (
    isApiPath(normalizePath(url.pathname)) &&
    isCrossOriginWrite(
      request.method,
      request.headers.get("origin"),
      request.headers.get("sec-fetch-site"),
      url.origin,
    )
  ) {
    const refusal = new Response(JSON.stringify({ error: "Cross-origin request rejected." }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
    return withSecurityHeaders(refusal, isProduction);
  }

  return withSecurityHeaders(CONTINUE(), isProduction);
}
