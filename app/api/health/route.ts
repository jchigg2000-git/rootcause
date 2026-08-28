import type { Database } from "../../lib/db.ts";
import { env } from "../../lib/server-env.ts";

/**
 * Liveness *and* readiness. Public by allowlist (`PUBLIC_API` in
 * `app/lib/auth/paths.ts`), so it answers before any session exists.
 *
 * It touches both SQLite handles on purpose. A static 200 only ever proves the
 * process is bound to its port — which is the one thing a supervisor can
 * already see — and would report healthy while every real request failed on a
 * volume that never mounted. `SELECT 1` is the cheapest statement that proves
 * the file behind `DB_DIR` is actually open.
 *
 * The body stays deliberately thin: an unauthenticated caller learns whether
 * the service is up, never which half is broken or why. The detail goes to the
 * logs, where it is already scoped to whoever can read the deploy.
 */
export async function GET() {
  const checks: Array<[string, Database | undefined]> = [
    ["app", env.APP_DB],
    ["auth", env.AUTH_DB],
  ];

  for (const [name, db] of checks) {
    if (!db) {
      console.error(`[health] ${name} database is not configured`);
      return Response.json(
        { status: "degraded" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      await db.prepare("SELECT 1").first();
    } catch (error) {
      console.error(`[health] ${name} database unreachable: ${(error as Error).message}`);
      return Response.json(
        { status: "degraded" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
