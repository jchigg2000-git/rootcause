/**
 * Report library — a read surface over the corpus that is already at rest.
 *
 * A library over the user's past generated reports. Nothing new is persisted
 * here: `diagnostic_case`, `case_message` and `report` rows have been written
 * on every diagnosis from the start, with per-user attribution. This module is
 * the query nobody had written.
 *
 * Reports store JSON, never HTML — the document is a pure function of it via
 * `renderReport` — so a saved report is re-rendered at the *current* template.
 * Template and manufacturer-livery changes therefore apply retroactively to
 * everything already stored.
 *
 * **Ownership is a `WHERE` clause, not a UI concern.** Every statement filters
 * on `diagnostic_case.user_id`, and the column is nullable, so cases written
 * without attribution match no caller and are unreachable rather than public.
 * Route handlers do not re-check role — the app has one global gate ahead of
 * the router, decided 2026-08-04 — which makes this the only place ownership
 * can be enforced.
 */
import caseOutcomeSchema from "../../migrations/0008_case_outcome.sql?raw";
import type { Database } from "./db.ts";
import { ensureDiagnosticCaseSchema, ensureReportSchema } from "./cases.ts";
import { createSchemaRunner } from "./sql.ts";

const runCaseOutcomeSchema = createSchemaRunner(caseOutcomeSchema);

export async function ensureCaseOutcomeSchema(db: Database): Promise<void> {
  await ensureDiagnosticCaseSchema(db);
  await runCaseOutcomeSchema(db);
}

/** Bounds the list; a household user is nowhere near this. */
export const MAX_CASES_RETURNED = 200;
/** Bounds one machine's case list inside its inventory card. */
export const MAX_CASES_PER_MACHINE = 50;

export type LibraryEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  year: string;
  make: string;
  model: string;
  serialPin: string;
  problem: string;
  status: string;
  turnCount: number;
  /** False for a case abandoned mid-interview — there is nothing to open. */
  hasReport: boolean;
  reportedAt: string | null;
  /** The fix the operator confirmed resolved this case, when marked. */
  outcome: { rank: number; problem: string } | null;
};

type CaseRow = {
  id: string;
  created_at: string;
  updated_at: string;
  equipment_year: string;
  equipment_make: string;
  equipment_model: string;
  equipment_serial: string | null;
  problem: string;
  status: string;
  turn_count: number;
  last_report_at: string | null;
  outcome_rank: number | null;
  outcome_problem: string | null;
};

/**
 * The caller's own cases, newest activity first.
 *
 * `report_json` is deliberately not selected — a report is tens of kilobytes
 * and the list needs only to know whether one exists.
 */
export async function listCasesForUser(db: Database, userId: string): Promise<LibraryEntry[]> {
  await ensureDiagnosticCaseSchema(db);
  await ensureReportSchema(db);
  await ensureCaseOutcomeSchema(db);
  const { results } = await db
    .prepare(
      `SELECT c.id, c.created_at, c.updated_at, c.equipment_year, c.equipment_make,
              c.equipment_model, c.equipment_serial, c.problem, c.status, c.turn_count,
              (SELECT MAX(r.created_at) FROM report r WHERE r.case_id = c.id) AS last_report_at,
              o.rank AS outcome_rank, o.problem AS outcome_problem
       FROM diagnostic_case c
       LEFT JOIN case_outcome o ON o.case_id = c.id
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC
       LIMIT ?`,
    )
    .bind(userId, MAX_CASES_RETURNED)
    .all<CaseRow>();

  return results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    year: row.equipment_year,
    make: row.equipment_make,
    model: row.equipment_model,
    serialPin: row.equipment_serial ?? "",
    problem: row.problem,
    status: row.status,
    turnCount: row.turn_count,
    hasReport: Boolean(row.last_report_at),
    reportedAt: row.last_report_at,
    outcome:
      row.outcome_rank !== null && row.outcome_problem !== null
        ? { rank: row.outcome_rank, problem: row.outcome_problem }
        : null,
  }));
}

export type StoredReport = {
  caseId: string;
  reportJson: string;
  createdAt: string;
  modelId: string | null;
  year: string;
  make: string;
  model: string;
};

/**
 * The caller's latest report for one case, or null.
 *
 * A case can hold more than one report row — regenerating writes another
 * rather than overwriting — so the newest wins. The `c.user_id = ?` join
 * condition is the ownership check; a case belonging to someone else is
 * indistinguishable from one that does not exist.
 */
export async function readLatestReport(
  db: Database,
  userId: string,
  caseId: string,
): Promise<StoredReport | null> {
  await ensureDiagnosticCaseSchema(db);
  await ensureReportSchema(db);
  const row = await db
    .prepare(
      `SELECT r.case_id, r.report_json, r.created_at, r.model_id,
              c.equipment_year, c.equipment_make, c.equipment_model
       FROM report r
       JOIN diagnostic_case c ON c.id = r.case_id
       WHERE r.case_id = ? AND c.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 1`,
    )
    .bind(caseId, userId)
    .first<{
      case_id: string;
      report_json: string;
      created_at: string;
      model_id: string | null;
      equipment_year: string;
      equipment_make: string;
      equipment_model: string;
    }>();
  if (!row) return null;

  return {
    caseId: row.case_id,
    reportJson: row.report_json,
    createdAt: row.created_at,
    modelId: row.model_id,
    year: row.equipment_year,
    make: row.equipment_make,
    model: row.equipment_model,
  };
}

export type CaseOutcome = {
  rank: number;
  problem: string;
  action: string;
  notedAt: string;
};

/**
 * Record which ranked fix resolved a case. Upsert-from-SELECT: the SELECT's
 * `c.user_id = ?` proves ownership inside the write itself, and the upsert
 * makes re-marking replace the previous mark. `problem`/`action` are the
 * server's captured report text, never client prose — see 0008's header.
 */
export async function saveCaseOutcome(
  db: Database,
  userId: string,
  caseId: string,
  pick: { rank: number; problem: string; action: string },
): Promise<boolean> {
  await ensureCaseOutcomeSchema(db);
  const result = await db
    .prepare(
      `INSERT INTO case_outcome (case_id, user_id, rank, problem, action, noted_at)
       SELECT c.id, c.user_id, ?, ?, ?, ? FROM diagnostic_case c
       WHERE c.id = ? AND c.user_id = ?
       ON CONFLICT(case_id) DO UPDATE SET
         rank = excluded.rank, problem = excluded.problem,
         action = excluded.action, noted_at = excluded.noted_at`,
    )
    .bind(pick.rank, pick.problem, pick.action, new Date().toISOString(), caseId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function readCaseOutcome(
  db: Database,
  userId: string,
  caseId: string,
): Promise<CaseOutcome | null> {
  await ensureCaseOutcomeSchema(db);
  const row = await db
    .prepare(
      `SELECT o.rank, o.problem, o.action, o.noted_at
       FROM case_outcome o
       JOIN diagnostic_case c ON c.id = o.case_id
       WHERE o.case_id = ? AND c.user_id = ?`,
    )
    .bind(caseId, userId)
    .first<{ rank: number; problem: string; action: string; noted_at: string }>();
  if (!row) return null;
  return { rank: row.rank, problem: row.problem, action: row.action, notedAt: row.noted_at };
}

export async function clearCaseOutcome(
  db: Database,
  userId: string,
  caseId: string,
): Promise<boolean> {
  await ensureCaseOutcomeSchema(db);
  const result = await db
    .prepare("DELETE FROM case_outcome WHERE case_id = ? AND user_id = ?")
    .bind(caseId, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export type MachineCase = {
  id: string;
  createdAt: string;
  problem: string;
  status: string;
  hasReport: boolean;
  outcome: { rank: number; problem: string } | null;
};

/** One machine's diagnostics, newest first, for its inventory card. */
export async function listCasesForMachine(
  db: Database,
  userId: string,
  machineId: string,
): Promise<MachineCase[]> {
  await ensureDiagnosticCaseSchema(db);
  await ensureReportSchema(db);
  await ensureCaseOutcomeSchema(db);
  const { results } = await db
    .prepare(
      `SELECT c.id, c.created_at, c.problem, c.status,
              (SELECT MAX(r.created_at) FROM report r WHERE r.case_id = c.id) AS last_report_at,
              o.rank AS outcome_rank, o.problem AS outcome_problem
       FROM diagnostic_case c
       LEFT JOIN case_outcome o ON o.case_id = c.id
       WHERE c.user_id = ? AND c.machine_id = ?
       ORDER BY c.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, machineId, MAX_CASES_PER_MACHINE)
    .all<{
      id: string;
      created_at: string;
      problem: string;
      status: string;
      last_report_at: string | null;
      outcome_rank: number | null;
      outcome_problem: string | null;
    }>();

  return results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    problem: row.problem,
    status: row.status,
    hasReport: Boolean(row.last_report_at),
    outcome:
      row.outcome_rank !== null && row.outcome_problem !== null
        ? { rank: row.outcome_rank, problem: row.outcome_problem }
        : null,
  }));
}
