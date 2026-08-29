-- Auth schema. Lives in db/auth.db, decoupled from application data.
-- Executed by ensureAuthSchema() at first use, from instrumentation.ts at
-- process start. There is no separate migration command and no remote
-- database. Every statement must stay idempotent.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  -- Only the SHA-256 of the opaque token is stored, so a database leak cannot
  -- be replayed as a session.
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- Login throttling. Attempts are persisted rather than held in a
-- process-local map, so a restart cannot clear an attacker's budget.
CREATE TABLE IF NOT EXISTS login_attempts (
  client_ip   TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts(client_ip, attempted_at);

-- Audit trail for login success/failure, logout, and account changes.
CREATE TABLE IF NOT EXISTS auth_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  event      TEXT NOT NULL,
  -- Actor email is denormalized at write time: an audit row must survive the
  -- deletion of the account it describes.
  actor_email TEXT,
  client_ip  TEXT,
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS auth_events_occurred_at_idx ON auth_events(occurred_at);
