-- Application settings. Lives in the APP_DB binding.
--
-- One row per logical setting, value held as JSON text, so adding a setting is
-- never a migration. The typed AppSettings object is assembled in code with
-- read-time coercion against per-key defaults.

CREATE TABLE IF NOT EXISTS app_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
