-- Which ranked fix actually resolved a case. Lives in the APP_DB binding.
--
-- One row per case, upserted — marking a different fix replaces the mark.
-- problem/action are captured from the stored report at mark time (the server
-- re-derives them from report_json; the client sends only the rank), so a
-- later regenerate — which can reorder ranks — never corrupts what was
-- recorded. This is the someday-aggregation corpus: confirmed fixes across
-- cases, keyed to real report text, never client-supplied prose.

CREATE TABLE IF NOT EXISTS case_outcome (
  case_id  TEXT PRIMARY KEY REFERENCES diagnostic_case(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL,
  rank     INTEGER NOT NULL,
  problem  TEXT NOT NULL,
  action   TEXT NOT NULL,
  noted_at TEXT NOT NULL
);
