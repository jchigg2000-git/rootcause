import { env } from "../../lib/server-env.ts";

/**
 * Liveness *and* readiness.
 *
 * It touches the SQLite handle on purpose. A static 200 only ever proves the
 * process is bound to its port — which is the one thing a supervisor can
 * already see — and would report healthy while every real request failed on a
 * volume that never mounted. `SELECT 1` is the cheapest statement that proves
 * the file behind `DB_DIR` is actually open.
 *
 * `observability.db` is deliberately NOT probed. It rides the same directory,
 * so it proves nothing app.db has not already proved, and it is disposable
 * exhaust — failing a healthcheck over it would take the service down for a
 * store whose whole design says it can be deleted at any time.
 *
 * The body stays deliberately thin: a caller learns whether the service is up,
 * never why it is not. The detail goes to the logs.
 */
export async function GET() {
  const db = env.APP_DB;
  const degraded = () =>
    Response.json({ status: "degraded" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  if (!db) {
    console.error("[health] app database is not configured");
    return degraded();
  }
  try {
    await db.prepare("SELECT 1").first();
  } catch (error) {
    console.error(`[health] app database unreachable: ${(error as Error).message}`);
    return degraded();
  }

  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
