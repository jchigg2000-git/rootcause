/**
 * The single global request gate.
 *
 * Replaces `worker/index.ts`. vinext compiles this into the RSC entry and runs
 * it ahead of both page and API dispatch, so a route added later is protected
 * by default. Opting a route out means editing PUBLIC_API in
 * `app/lib/auth/paths.ts` — never decorating the route itself.
 *
 * Note this file is named `middleware.ts` rather than `proxy.ts`. vinext looks
 * for `proxy.ts` first and warns that this name is the Next.js 15 spelling;
 * both work. Renaming is a one-line change whenever that warning becomes noise.
 *
 * Security headers ride on EVERY response, not just rejections. Returning
 * `undefined` continues to the route but drops them, which is what the Worker
 * removal regressed. The fix is vinext's continue-with-
 * headers signal: a response carrying `x-middleware-next: 1` means "keep
 * routing", and `mergeMiddlewareResponseHeaders` copies the rest of its headers
 * onto whatever the route eventually returns. Verified against
 * `node_modules/vinext/dist/server/middleware-runtime.js` (the
 * `x-middleware-next` branch) and `middleware-response-headers.js`.
 */
import { gate, withSecurityHeaders } from "./app/lib/auth/gate.ts";
import { env } from "./app/lib/server-env.ts";

/** vinext's "continue routing" marker; stripped before the client sees it. */
const CONTINUE = () => new Response(null, { headers: { "x-middleware-next": "1" } });

export async function middleware(request: Request): Promise<Response> {
  const isProduction = env.ENVIRONMENT === "production";

  const decision = await gate(request, env);
  if (decision.kind === "reject") {
    return withSecurityHeaders(decision.response, isProduction);
  }

  return withSecurityHeaders(CONTINUE(), isProduction);
}
