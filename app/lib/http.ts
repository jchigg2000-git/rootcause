/** JSON responses for route handlers. */

export const jsonResponse = (body: unknown, status = 200, extraHeaders?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });

/**
 * A refusal, worded for the operator. `app/lib/request.ts` reads the `error`
 * key back out on the client, so the sentence written here is the sentence the
 * operator sees — the caller's fallback wording is only for a refusal that
 * names no reason at all.
 */
export const jsonError = (error: string, status: number) => jsonResponse({ error }, status);
