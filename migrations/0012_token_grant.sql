-- The redeemed allowance, in APP_DB beside the usage ledger it governs.
--
-- No FK to users: they live in auth.db, a different file — the same posture as
-- usage_ledger, and as the `billing` table this replaced when Stripe was
-- removed on 2026-08-18.
--
-- `tokens_used` is a COUNTER and deliberately NOT a SUM over usage_ledger.
-- The ledger prunes rows past a 13-month horizon (see app/lib/budget.ts), which
-- would silently hand a long-lived token its whole allowance back. A cap that
-- is a LIFETIME figure needs accounting that outlives the ledger's retention.
--
-- A user with no row here has no allowance and cannot spend at all. That is the
-- default-deny posture: access comes from redeeming a token or from the
-- skeleton key, never from the absence of a record.

CREATE TABLE IF NOT EXISTS token_grant (
  user_id         TEXT PRIMARY KEY,
  -- What the code actually buys: N generated reports. 0 means unlimited.
  -- Incremented only when a report is delivered to the operator, so a failed
  -- generation or an abandoned interview never costs a run.
  run_cap         INTEGER NOT NULL DEFAULT 0,
  runs_used       INTEGER NOT NULL DEFAULT 0,
  -- Lifetime token ceiling, kept as a silent backstop behind the run count.
  -- It is no longer the headline limit; it exists so that a pathological run
  -- cannot spend without bound against the owner's provider key. 0 = unlimited.
  token_cap       INTEGER NOT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  -- The access_token row this came from, for support lookups. Not a FK: that
  -- row lives in auth.db.
  source_token_id TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
