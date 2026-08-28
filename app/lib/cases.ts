/**
 * Diagnostic case corpus.
 *
 * Persists interview transcripts and generated reports so `prompts.ts` can be
 * improved against real cases later — where operators get stuck, what turns
 * a case ready, what never resolves. Lives in the APP_DB binding, alongside
 * `app_setting`.
 *
 * Every write here is a by-product of a diagnosis, never a precondition for
 * one. Callers (see `app/api/diagnose/route.ts`) wrap every call from this
 * module in a try/catch that logs and continues — a storage failure must
 * never turn a working diagnosis or report into a 500.
 */
import diagnosticCaseSchema from "../../migrations/0003_diagnostic_case.sql?raw";
import reportSchema from "../../migrations/0004_report.sql?raw";
import type { Database } from "./db.ts";
import { createColumnGuard, createSchemaRunner } from "./sql.ts";

const runDiagnosticCaseSchema = createSchemaRunner(diagnosticCaseSchema);
// Grown databases predate machine_id in 0003's CREATE; see that file's comment.
const machineIdGuard = createColumnGuard("diagnostic_case", "machine_id", "TEXT");
// Grown databases predate tokens_spent in 0003's CREATE, same as machine_id.
const tokensSpentGuard = createColumnGuard(
  "diagnostic_case",
  "tokens_spent",
  "INTEGER NOT NULL DEFAULT 0",
);

export async function ensureDiagnosticCaseSchema(db: Database): Promise<void> {
  await runDiagnosticCaseSchema(db);
  await machineIdGuard(db);
  await tokensSpentGuard(db);
}

/**
 * Tokens spent on one case, across every turn.
 *
 * The per-case ceiling reads this before each billable call, which is what ends
 * an interview that never converges. A run is only counted when a report is
 * delivered, so without this ceiling an operator could interview forever at the
 * owner's expense and never be charged a run for it.
 *
 * Returns 0 for an unknown case: a missing row must not block a diagnosis.
 */
export async function caseTokensSpent(db: Database, caseId: string): Promise<number> {
  await ensureDiagnosticCaseSchema(db);
  const row = await db
    .prepare("SELECT tokens_spent FROM diagnostic_case WHERE id = ?")
    .bind(caseId)
    .first<{ tokens_spent: number }>();
  return row?.tokens_spent ?? 0;
}

/** Fire-and-forget, like every other by-product write on the diagnosis path. */
export async function addCaseTokens(db: Database, caseId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  try {
    await ensureDiagnosticCaseSchema(db);
    await db
      .prepare("UPDATE diagnostic_case SET tokens_spent = tokens_spent + ? WHERE id = ?")
      .bind(tokens, caseId)
      .run();
  } catch (spendError) {
    console.error(`[cases] case spend update failed: ${(spendError as Error).message}`);
  }
}

export const ensureReportSchema = createSchemaRunner(reportSchema);

export type CaseStatus = "interviewing" | "ready" | "reported";

export type NewCaseInput = {
  userId: string | null;
  /** The inventory machine intake auto-save matched or created. Attribution
   *  only, like userId — null when auto-save failed or the caller is unknown. */
  machineId: string | null;
  equipment: {
    year: string;
    make: string;
    model: string;
    serialPin?: string;
  };
  problem: string;
  modelId: string | null;
  photoCount: number;
};

export type CaseMessageInput = { role: "user" | "assistant"; content: string };

/** Creates the case row and returns its id. One row per diagnosis. */
export async function createCase(db: Database, input: NewCaseInput): Promise<string> {
  await ensureDiagnosticCaseSchema(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO diagnostic_case
         (id, user_id, machine_id, created_at, updated_at, equipment_year, equipment_make,
          equipment_model, equipment_serial, problem, model_id, photo_count, turn_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'interviewing')`,
    )
    .bind(
      id,
      input.userId,
      input.machineId,
      now,
      now,
      input.equipment.year,
      input.equipment.make,
      input.equipment.model,
      input.equipment.serialPin ?? null,
      input.problem,
      input.modelId,
      input.photoCount,
    )
    .run();
  return id;
}

/**
 * Append only the transcript messages not already stored, then roll the
 * case's `turn_count`/`updated_at`/`status` forward in the same transaction.
 *
 * Diffing against the case's current `turn_count` (rather than trusting the
 * caller to say what is new) means this is safe to call on every turn with
 * the full transcript the client already holds — first-turn callers, later
 * turns, and the report handoff can all call it the same way.
 *
 * A no-op — not a throw — when the case id does not resolve to a row, so a
 * client-supplied `caseId` that raced a restart never surfaces as an error to
 * the operator. A case that is not the caller's takes that same silent path:
 * not-yours reads exactly like not-exists, so ids cannot be probed.
 *
 * `ownerId` is the caller's own id, and it is load-bearing. `caseId` arrives on
 * the request body and is validated for shape only, so without it a signed-in
 * user could append their messages to a stranger's case and roll its status
 * forward. The sibling `machineId` on that same body has always been proven
 * this way (`refreshMachineFromIntake`); this is the same posture.
 *
 * The comparison is `IS`, not `=`, because `user_id` is nullable: SQLite's
 * null-safe equality keeps an unattributed case reachable by an unattributed
 * caller, while `= ?` would silently no-op and quietly stop persisting.
 */
export async function syncCaseTranscript(
  db: Database,
  caseId: string,
  ownerId: string | null,
  fullTranscript: CaseMessageInput[],
  status: CaseStatus,
): Promise<void> {
  await ensureDiagnosticCaseSchema(db);
  const existing = await db
    .prepare("SELECT turn_count FROM diagnostic_case WHERE id = ? AND user_id IS ?")
    .bind(caseId, ownerId)
    .first<{ turn_count: number }>();
  if (!existing) return;

  const already = existing.turn_count;
  const newMessages = fullTranscript.slice(already);
  const now = new Date().toISOString();

  const inserts = newMessages.map((message, offset) =>
    db
      .prepare(
        `INSERT INTO case_message (id, case_id, turn_index, role, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), caseId, already + offset, message.role, message.content, now),
  );

  const update = db
    .prepare(
      `UPDATE diagnostic_case SET turn_count = ?, updated_at = ?, status = ?
       WHERE id = ? AND user_id IS ?`,
    )
    .bind(already + newMessages.length, now, status, caseId, ownerId);

  await db.batch([...inserts, update]);
}

/**
 * Stores the report JSON (never the rendered HTML — that is a pure function
 * of the JSON via `renderReport`) and marks the case reported.
 *
 * `ownerId` scopes both statements for the same reason it scopes
 * `syncCaseTranscript` above. The insert is an `INSERT ... SELECT` rather than
 * a check-then-write so ownership is proven inside the write itself and cannot
 * race — the same shape `library.ts` uses for `case_outcome`. A foreign case
 * inserts zero rows and updates zero rows, silently.
 */
export async function saveReport(
  db: Database,
  caseId: string,
  ownerId: string | null,
  modelId: string | null,
  reportJson: string,
): Promise<void> {
  await ensureReportSchema(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO report (id, case_id, created_at, model_id, report_json)
         SELECT ?, c.id, ?, ?, ? FROM diagnostic_case c
         WHERE c.id = ? AND c.user_id IS ?`,
      )
      .bind(id, now, modelId, reportJson, caseId, ownerId),
    db
      .prepare(
        `UPDATE diagnostic_case SET status = 'reported', updated_at = ?
         WHERE id = ? AND user_id IS ?`,
      )
      .bind(now, caseId, ownerId),
  ]);
}
