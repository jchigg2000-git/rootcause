/**
 * Session lookup for server components.
 *
 * Pages are not covered by the API gate — the gate deliberately lets non-API
 * paths through so the login page can render — so each page resolves its own
 * session and redirects.
 */
import { env } from "../server-env.ts";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./cookies.ts";
import { ensureAuthSchema, ensureOwner, resolveSession, type User } from "./store.ts";

export async function pageUser(): Promise<User | null> {
  const db = env.AUTH_DB;
  if (!db) return null;

  // A first visit may land on a page before any API call has initialized the
  // schema, so the page path has to be able to bootstrap it too.
  await ensureAuthSchema(db);
  await ensureOwner(db);

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(db, token) : null;
}

export type { User };
