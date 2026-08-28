import { env } from "../../lib/server-env.ts";
import {
  countAuthEvents24h,
  pruneAuthEvents,
  pruneTelemetry,
  readRecentAuthEvents,
  readTelemetryWindow,
} from "../../lib/observability.ts";
import { emptyPayload, rollupByOperation, summarizeTelemetry } from "./stats";

/** Both tables are read newest-first; this caps what the panel renders. */
const RECENT_LIMIT = 40;

/**
 * The one observability read: summary KPIs + per-operation rollup + recent
 * calls + recent audit events, in a single payload.
 *
 * Admin-only via the global gate — this path is in `ADMIN_API_PREFIXES`
 * (`app/lib/auth/paths.ts`), so `middleware.ts` has already answered 401/403
 * before this handler runs; there is nothing to re-check here.
 *
 * The two halves degrade independently and neither may ever 500 the panel:
 * a broken telemetry store still shows the audit log, a broken auth store
 * still shows telemetry, and both broken returns the zeroed payload with a
 * 200. The panel must never go down on its own telemetry.
 */
export async function GET() {
  const payload = emptyPayload();

  if (env.OBS_DB) {
    try {
      // Retention is prune-on-read: bounded by age and row count on every
      // panel load, so no cron is needed.
      await pruneTelemetry(env.OBS_DB);
      const window = await readTelemetryWindow(env.OBS_DB);
      Object.assign(payload.summary, summarizeTelemetry(window, Date.now()));
      payload.operations = rollupByOperation(window);
      payload.recentCalls = window.slice(0, RECENT_LIMIT);
    } catch (error) {
      console.error(`[observability] telemetry read failed: ${String(error).slice(0, 200)}`);
    }
  }

  if (env.AUTH_DB) {
    try {
      await pruneAuthEvents(env.AUTH_DB);
      const { logins, failures } = await countAuthEvents24h(env.AUTH_DB);
      payload.summary.logins24h = logins;
      payload.summary.failedLogins24h = failures;
      payload.recentEvents = await readRecentAuthEvents(env.AUTH_DB, RECENT_LIMIT);
    } catch (error) {
      console.error(`[observability] audit read failed: ${String(error).slice(0, 200)}`);
    }
  }

  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
