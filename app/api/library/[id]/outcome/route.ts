import { env } from "../../../../lib/server-env.ts";
import { jsonError, jsonResponse } from "../../../../lib/http.ts";
import {
  clearCaseOutcome,
  readCaseOutcome,
  readLatestReport,
  saveCaseOutcome,
} from "../../../../lib/library.ts";
import { parseReportJson } from "../../../diagnose/report-schema.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Mark (or clear) which ranked fix resolved a case.
 *
 * The client sends only `{rank}` — the recorded `problem`/`action` text is
 * re-derived here from the stored report JSON, because this table is the
 * someday-aggregation corpus and client-supplied prose would poison it. A rank
 * that is not in the stored report is a 400, not a write.
 */
export async function POST(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Report storage is not configured on the server.", 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("The request could not be read.", 400);
  }
  const rank = (body as { rank?: unknown })?.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 20) {
    return jsonError("Pick a fix from the report's ranked list.", 400);
  }

  const { id } = await context.params;
  const stored = await readLatestReport(db, id);
  if (!stored) return jsonError("That report is not in your library.", 404);

  const data = parseReportJson(stored.reportJson, stored.createdAt);
  const picked = data?.ranked.find((problem) => problem.rank === rank);
  if (!picked) return jsonError("That fix is not in this report's ranked list.", 400);

  const saved = await saveCaseOutcome(db, id, {
    rank: picked.rank,
    problem: picked.problem,
    action: picked.action,
  });
  if (!saved) return jsonError("That report is not in your library.", 404);

  return jsonResponse({ outcome: await readCaseOutcome(db, id) });
}

export async function DELETE(_request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Report storage is not configured on the server.", 500);

  const { id } = await context.params;
  if (!(await clearCaseOutcome(db, id))) {
    return jsonError("That report is not in your library.", 404);
  }
  return jsonResponse({ ok: true });
}
