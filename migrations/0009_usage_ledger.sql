-- Token spend, written by the API routes after each model call outcome. Lives
-- in the app database (APP_DB), deliberately NOT observability.db: the
-- observability store is prunable exhaust with a one-way data flow, and its
-- 14-day retention would silently erase the numbers this is kept for. This
-- ledger is the durable record of what the app has cost to run, with its own
-- 13-month retention, pruned on write by app/lib/budget.ts.
--
-- Tokens are input + output summed; a provider that reports no usage records
-- nothing.

CREATE TABLE IF NOT EXISTS usage_ledger (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  operation TEXT NOT NULL,
  tokens    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_ledger_ts_idx ON usage_ledger(ts);

-- Dropped with the accounts this app used to have. It has to go before the
-- column can: SQLite refuses DROP COLUMN while an index still covers it, and
-- that drop is the guard in budget.ts, which runs after this file.
DROP INDEX IF EXISTS usage_ledger_user_ts_idx;
