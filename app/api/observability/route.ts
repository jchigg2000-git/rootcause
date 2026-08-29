import { env } from "../../lib/server-env.ts";
import { pruneTelemetry, readTelemetryWindow } from "../../lib/observability.ts";
import { emptyPayload, rollupByOperation, summarizeTelemetry } from "./stats";

/** Telemetry is read newest-first; this caps what the panel renders. */
const RECENT_LIMIT = 40;

/**
 * The one observability read: summary KPIs, per-operation rollup, and recent
 * calls, in a single payload.
 *
 * A broken or absent telemetry store returns the zeroed payload with a 200,
 * never a 500. The panel must never go down on its own telemetry — the store
 * is disposable by design, and a page that 500s over deleted exhaust would be
 * reporting a fault the app does not have.
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

  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}
