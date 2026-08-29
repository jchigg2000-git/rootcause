-- Dated maintenance history, one row per service entry. Lives in the app
-- database (APP_DB), alongside machine. Replaces growth of the legacy machine.maintenance
-- blob, which is kept and rendered as "Notes" — never silently migrated.

CREATE TABLE IF NOT EXISTS machine_service (
  id           TEXT PRIMARY KEY,
  machine_id   TEXT NOT NULL REFERENCES machine(id) ON DELETE CASCADE,
  -- YYYY-MM-DD, operator-entered. The day the work was done, not the day the
  -- row was created — created_at keeps that separately.
  performed_on TEXT NOT NULL,
  note         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS machine_service_machine_idx
  ON machine_service(machine_id, performed_on);

-- Index for diagnostic_case.machine_id. It lives here rather than in 0003
-- because on a grown database that column is added by a runtime guard, and
-- 0003's own batch executes before the guard has run — this file's runner
-- awaits the diagnostic-case schema (guard included) first. See inventory.ts
-- ensureMachineServiceSchema.
CREATE INDEX IF NOT EXISTS diagnostic_case_machine_id_idx
  ON diagnostic_case(machine_id);
