-- One-time access tokens. Lives in db/auth.db beside users and sessions,
-- because a redeemable code is a credential, not application data.
--
-- Only the SHA-256 of the issued code is stored, exactly as `sessions` stores
-- only the hash of its bearer token: a database leak cannot be redeemed. The
-- plaintext code is returned once, at issue, and is unrecoverable afterwards.
--
-- Redemption is single-use and one-way. `redeemed_at` and `user_id` are set in
-- the same UPDATE that claims the row, guarded by `redeemed_at IS NULL`, so two
-- concurrent redemptions of one code cannot both win — the second changes zero
-- rows and is refused.
--
-- Every statement must stay idempotent: this file re-runs in full on every boot.

CREATE TABLE IF NOT EXISTS access_token (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  -- Free text naming who it went to. Never used for auth.
  label       TEXT,
  -- How many reports this code buys, copied onto the grant at redemption.
  -- 0 means unlimited. This is the number quoted to the holder.
  run_cap     INTEGER NOT NULL DEFAULT 0,
  -- Lifetime token backstop, also copied at redemption. 0 means unlimited.
  token_cap   INTEGER NOT NULL,
  -- Deadline for REDEEMING the code. Once redeemed the session's own expiry
  -- governs access, not this column.
  expires_at  TEXT,
  created_at  TEXT NOT NULL,
  redeemed_at TEXT,
  user_id     TEXT,
  revoked_at  TEXT
);

CREATE INDEX IF NOT EXISTS access_token_user_idx ON access_token(user_id);
CREATE INDEX IF NOT EXISTS access_token_created_idx ON access_token(created_at);
