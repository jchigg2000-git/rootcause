/**
 * Identity for route handlers.
 *
 * The gate has already decided whether the request is allowed through; handlers
 * call this only to learn *who* is calling. It re-reads the cookie rather than
 * threading worker context through the app router, which vinext does not expose.
 */
import { env } from "../server-env.ts";
import { readSessionCookie } from "./cookies.ts";
import { resolveSession, type User } from "./store.ts";

export async function currentUser(request: Request): Promise<User | null> {
  const db = env.AUTH_DB;
  if (!db) return null;
  const token = readSessionCookie(request);
  return token ? resolveSession(db, token) : null;
}

export const jsonResponse = (body: unknown, status = 200, extraHeaders?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });

export const jsonError = (error: string, status: number) => jsonResponse({ error }, status);

export type { User };
