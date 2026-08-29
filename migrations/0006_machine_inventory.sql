-- Machine inventory. Lives in the app database (APP_DB), alongside diagnostic_case.
--
-- The operator's own record of the machines they look after. Distinct from
-- diagnostic_case: a case is one diagnosis of one problem at one moment, a
-- machine is a durable thing that outlives every case run against it.

CREATE TABLE IF NOT EXISTS machine (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- Identity, mirroring the intake fieldset so a row can prefill a diagnosis
  -- or a spec lookup. Free text, same as intake — the catalog suggests, it
  -- never validates.
  equipment_year   TEXT,
  equipment_make   TEXT NOT NULL,
  equipment_model  TEXT,
  machine_type     TEXT,
  -- The three substantive fields. serial_pin is spec-lookup's key.
  serial_pin       TEXT,
  -- REAL, not INTEGER: hour meters on this class of machine read to a tenth.
  current_hours    REAL,
  maintenance      TEXT,
  -- Optional operator nickname ("north pit loader"), shown after
  -- year/make/model in the card header. Fresh databases get the column here;
  -- grown ones get it from the createColumnGuard in inventory.ts — this file
  -- re-runs on every boot and SQLite has no ADD COLUMN IF NOT EXISTS, so a
  -- bare ALTER here would fail every boot after its first.
  label            TEXT
);

CREATE INDEX IF NOT EXISTS machine_updated_at_idx ON machine(updated_at);

-- Dropped with the accounts this app used to have. It has to go before the
-- column can: SQLite refuses DROP COLUMN while an index still covers it, and
-- that drop is the guard in inventory.ts, which runs after this file.
DROP INDEX IF EXISTS machine_user_id_idx;
