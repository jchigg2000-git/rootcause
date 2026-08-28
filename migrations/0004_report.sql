-- Generated reports. Lives in the APP_DB binding, alongside diagnostic_case.
--
-- Stores the report JSON, not the rendered HTML — the HTML is a pure function
-- of the JSON via renderReport() in report-template.ts, so this stays small
-- and survives template changes.

CREATE TABLE IF NOT EXISTS report (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES diagnostic_case(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  model_id   TEXT,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS report_case_id_idx ON report(case_id);
