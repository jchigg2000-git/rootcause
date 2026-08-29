import { env } from "../../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";
import { readCaseOutcome, readLatestReport } from "../../../lib/library.ts";
import { parseReportJson } from "../../diagnose/report-schema.ts";
import { renderReport } from "../../diagnose/report-template.ts";

type Context = { params: Promise<{ id: string }> };

/**
 * Re-render one stored report as the standalone HTML document.
 *
 * The store holds JSON, not HTML, and `renderReport` is a pure function of it,
 * so this rebuilds the document at the *current* template — a report saved
 * before the livery work landed comes back in its manufacturer's colours.
 * `parseReportJson` is run again rather than trusting the stored blob: it is
 * the same defensive coercion the model output goes through, it is idempotent
 * over its own output, and it means a row written by an older schema cannot
 * reach the template with a shape the template does not expect.
 *
 * The make comes from the case row (server-side intake), never from the report
 * JSON — report colour is document chrome, like section numbering, and is
 * never model-supplied.
 */
export async function GET(request: Request, context: Context) {
  const db = env.APP_DB;
  if (!db) return jsonError("Report storage is not configured on the server.", 500);

  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to open a report.", 401);

  const { id } = await context.params;
  const stored = await readLatestReport(db, user.id, id);
  if (!stored) return jsonError("That report is not in your library.", 404);

  const data = parseReportJson(stored.reportJson, stored.createdAt);
  if (!data) {
    return jsonError("That report was stored in a form this version cannot render.", 422);
  }

  return jsonResponse({
    html: renderReport(data, stored.make),
    machineLabel: [stored.year, stored.make, stored.model].filter(Boolean).join(" "),
    generatedAt: stored.createdAt,
    modelId: stored.modelId,
    // The fix-that-worked selector: the ranked candidates (rank/problem/action
    // only — the full report already travels as html) and any recorded mark.
    ranked: data.ranked.map((problem) => ({
      rank: problem.rank,
      problem: problem.problem,
      action: problem.action,
    })),
    outcome: await readCaseOutcome(db, user.id, id),
  });
}
