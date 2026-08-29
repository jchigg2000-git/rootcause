-- LLM call telemetry. Lives in its own file (db/observability.db, opened by
-- instrumentation.ts) — metrics are prunable exhaust with a 14-day retention,
-- kept apart from the application corpus so the prune-on-read deletes can only
-- ever touch metrics.
--
-- One row per model call, emitted by `runChat` (app/api/diagnose/providers.ts)
-- through `recordLlmTelemetry` (app/lib/observability.ts). Numbers only:
-- no prompt or transcript content is ever written here.
CREATE TABLE IF NOT EXISTS llm_telemetry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ISO-8601 UTC, the same convention every timestamp in this app uses.
  ts            TEXT NOT NULL,
  -- The ChatRequest.operation tag: interview, report, spec-research,
  -- spec-format, parts-research, parts-format, random-scenario.
  operation     TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL,
  -- NULL when the provider response carried no usage block (or the call failed).
  input_tokens  INTEGER,
  output_tokens INTEGER,
  ok            INTEGER NOT NULL,
  -- HTTP-shaped status on failure; NULL on success.
  status        INTEGER,
  truncated     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS llm_telemetry_ts_idx ON llm_telemetry(ts);
CREATE INDEX IF NOT EXISTS llm_telemetry_operation_idx ON llm_telemetry(operation, ts);
