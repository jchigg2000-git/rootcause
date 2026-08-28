-- Machine inventory. Lives in the APP_DB binding, alongside diagnostic_case.
--
-- A user's own record of the machines they look after. Distinct from
-- diagnostic_case: a case is one diagnosis of one problem at one moment, a
-- machine is a durable thing that outlives every case run against it.
--
-- user_id is NOT NULL here, unlike diagnostic_case's attribution-only column:
-- an inventory row with no owner is unreachable by design, since every read
-- filters on the caller. A machine nobody can list is a leak, not a record.

CREATE TABLE IF NOT EXISTS machine (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS machine_user_id_idx ON machine(user_id);
CREATE INDEX IF NOT EXISTS machine_updated_at_idx ON machine(updated_at);
