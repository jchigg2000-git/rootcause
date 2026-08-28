-- Diagnostic case corpus. Lives in the APP_DB binding, alongside app_setting.
--
-- Captures each intake + interview so prompts.ts can be improved against real
-- cases — where operators get stuck, what turns things ready, what never
-- resolves. `case_message` is one row per turn, never a JSON blob, because the
-- whole point is querying across cases (e.g. the last operator message before
-- a case is abandoned).

CREATE TABLE IF NOT EXISTS diagnostic_case (
  id                 TEXT PRIMARY KEY,
  -- Who ran it. Attribution only — nullable so a storage/auth hiccup never
  -- blocks the write the diagnosis itself depends on.
  user_id            TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  equipment_year     TEXT NOT NULL,
  equipment_make     TEXT NOT NULL,
  equipment_model    TEXT NOT NULL,
  equipment_serial   TEXT,
  problem            TEXT NOT NULL,
  -- The activeModel actually used for this case. Settings can change between
  -- cases, so this is captured per-case rather than looked up later.
  model_id           TEXT,
  photo_count        INTEGER NOT NULL DEFAULT 0,
  -- Tokens spent on THIS case, across every turn. Drives the per-case ceiling
  -- that ends an interview which never converges. Grown databases get the
  -- column from a guard in cases.ts.
  tokens_spent       INTEGER NOT NULL DEFAULT 0,
  turn_count         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'interviewing',
  -- The inventory machine this case ran against, set by intake auto-save.
  -- Attribution only, like user_id: nullable, and a deleted machine leaves it
  -- dangling harmlessly (joins simply return nothing). Fresh databases get the
  -- column here; grown ones get it from the createColumnGuard in cases.ts —
  -- this file re-runs on every boot and SQLite has no ADD COLUMN IF NOT EXISTS,
  -- so a bare ALTER here would fail every boot after its first.
  -- Its index lives in 0007_machine_service.sql, which runs after the guard.
  machine_id         TEXT
);

CREATE INDEX IF NOT EXISTS diagnostic_case_created_at_idx ON diagnostic_case(created_at);
CREATE INDEX IF NOT EXISTS diagnostic_case_status_idx ON diagnostic_case(status);

CREATE TABLE IF NOT EXISTS case_message (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES diagnostic_case(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS case_message_case_id_idx ON case_message(case_id);
