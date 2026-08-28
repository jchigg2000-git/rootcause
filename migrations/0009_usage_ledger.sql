-- Per-user token spend, written by the API routes after each model call
-- outcome. Lives in the APP_DB binding, deliberately NOT observability.db:
-- the observability store is prunable exhaust with a one-way data flow and
-- must never be read for enforcement — its 14-day retention would silently
-- erase the very numbers a monthly budget adds up. This ledger is
-- load-bearing app data with its own (13-month) retention, pruned on write
-- by app/lib/budget.ts.
--
-- No FK to users: they live in auth.db, a different file. Tokens are
-- input + output summed; a provider that reports no usage records nothing.

CREATE TABLE IF NOT EXISTS usage_ledger (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  ts        TEXT NOT NULL,
  operation TEXT NOT NULL,
  tokens    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_ledger_user_ts_idx ON usage_ledger(user_id, ts);
