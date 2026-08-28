/**
 * Auth storage over D1.
 *
 * The pattern's default is a dedicated SQLite file at db/auth.db. Workers have
 * no filesystem, so the dedicated store becomes a dedicated D1 binding
 * (AUTH_DB) — separate from the application database (APP_DB) so auth data
 * stays decoupled from app data.
 */
import authSchema from "../../../migrations/0001_auth.sql?raw";
import type { Database } from "../db.ts";
import { createSchemaRunner } from "../sql.ts";

export type Role = "viewer" | "admin";

/** The shape handlers and JSON responses see. Never carries password_hash. */
export type User = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
};

export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SESSION_MS = 12 * 60 * 60 * 1000;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Per source address — the family baseline. */
const LOGIN_MAX_PER_IP = 5;
/**
 * Per targeted account, deliberately looser.
 *
 * Matching the per-IP limit here would hand anyone who knows an email address a
 * five-request account lockout, which is a worse front door than the credential
 * stuffing it prevents. This ceiling is still far below any useful guess rate
 * and clears itself after the window.
 */
const LOGIN_MAX_PER_ACCOUNT = 20;

const now = () => new Date().toISOString();

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  role: row.role === "admin" ? "admin" : "viewer",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Split the schema file into statements and run them.
 *
 * Requiring an operator to run a migration command before the app works at all
 * is friction that gets skipped, so the schema applies itself at first use.
 * The .sql files stay the single source of truth — they are imported here
 * rather than duplicated as inline strings.
 */
export const ensureAuthSchema = createSchemaRunner(authSchema);

// ---------------------------------------------------------------- users

export async function countUsers(db: Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countAdmins(db: Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listUsers(db: Database): Promise<User[]> {
  const result = await db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all<UserRow>();
  return (result.results ?? []).map(toUser);
}

export async function findUserById(db: Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? toUser(row) : null;
}

export async function setUserRole(db: Database, id: string, role: Role): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(role, now(), id)
    .run();
}

/** Changing a password invalidates every session that user holds. */
export async function deleteUser(db: Database, id: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
}

/**
 * Verify credentials with uniform timing.
 *
 * An unknown email still runs a full scrypt verification against a throwaway
 * hash, and the caller returns the identical 401 for both cases, so the
 * endpoint cannot be used to enumerate accounts.
 */
/**
 * The single owner account, backed by the skeleton key rather than a password.
 *
 * Its id is a fixed string, not a UUID: every case, report, machine and ledger
 * row the owner has ever written is keyed to it, so regenerating the key must
 * not orphan that history. Rotating the key file changes the credential; this
 * row — and everything it owns — stays put.
 */
export const OWNER_USER_ID = "owner";
const OWNER_EMAIL = "owner@rootcause.local";

/**
 * `users.password_hash` is NOT NULL and stays that way — dropping a column
 * means rebuilding the table on a live volume. Nothing can ever verify against
 * this sentinel: it is not a valid scrypt `salt:hash` pair, and no code path
 * calls verifyPassword any more regardless.
 */
const NO_PASSWORD = "!";

export async function ensureOwner(db: Database): Promise<User> {
  const existing = await findUserById(db, OWNER_USER_ID);
  if (existing) return existing;

  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(OWNER_USER_ID, OWNER_EMAIL, NO_PASSWORD, timestamp, timestamp)
    .run();
  const created = await findUserById(db, OWNER_USER_ID);
  if (!created) throw new Error("owner account could not be created");
  return created;
}

/**
 * The account a redeemed access token gets. Identity is the token, so the email
 * is a synthetic display label and is never an input to authentication.
 */
export async function createTokenUser(db: Database, label?: string | null): Promise<User> {
  const id = crypto.randomUUID();
  const slug = (label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const email = `token-${slug ? `${slug}-` : ""}${id.slice(0, 8)}@rootcause.local`;
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'viewer', ?, ?)`,
    )
    .bind(id, email, NO_PASSWORD, timestamp, timestamp)
    .run();
  const created = await findUserById(db, id);
  if (!created) throw new Error("token account could not be created");
  return created;
}

// -------------------------------------------------------------- sessions

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: Database,
  userId: string,
  ttlMs: number,
): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now(), new Date(Date.now() + ttlMs).toISOString())
    .run();
  return token;
}

/**
 * How often the expired-session sweep is allowed to run, per process.
 *
 * The sweep used to run on every `resolveSession`, and `resolveSession` is the
 * hottest path in the app: the gate calls it for every API request, every route
 * handler's `currentUser()` calls it again, and every page render calls it via
 * `pageUser()`. That is two to three unconditional `DELETE` write transactions
 * per request, almost all of them matching zero rows, each one taking a write
 * lock and adding WAL pages that shutdown then has to checkpoint. The cost
 * scaled with total traffic rather than with the number of sessions that had
 * actually expired.
 *
 * Throttling it is behaviour-neutral, and that is load-bearing rather than
 * incidental: the SELECT below carries its own `expires_at > ?` predicate, so
 * an expired row is never resolvable whether or not the sweep has run. The
 * DELETE is housekeeping — reclaiming space — not an authorization check. Do
 * not "simplify" by leaning on the sweep and dropping that predicate.
 *
 * This is the same opportunistic prune-on-read shape the telemetry and
 * auth-event stores already use, with a rate limit added.
 */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Epoch ms of the last sweep. Per process; a restart just sweeps once more. */
let lastSessionSweepAt = 0;

/** Resolve a presented token to a user, purging expired rows as it goes. */
export async function resolveSession(db: Database, token: string): Promise<User | null> {
  const timestamp = now();

  const startedAt = Date.now();
  if (startedAt - lastSessionSweepAt >= SESSION_SWEEP_INTERVAL_MS) {
    // Stamped before the await, so concurrent resolves in the same tick do not
    // each queue their own sweep.
    lastSessionSweepAt = startedAt;
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(timestamp).run();
  }

  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), timestamp)
    .first<UserRow>();

  return row ? toUser(row) : null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

// ----------------------------------------------------------- seed admin

/**
 * Seed the first admin, on an empty users table only.
 */
// -------------------------------------------------------- rate limiting

/**
 * Throttle buckets.
 *
 * Per-IP alone only stops one host hammering the box. The realistic attack on a
 * small deployment is credential stuffing spread across many IPs against one
 * known account, which per-IP counting never sees — so attempts are counted
 * against the target account as well, and either bucket filling is enough to
 * refuse. The column holds a prefixed key rather than a bare address.
 */
const ipBucket = (clientIp: string) => `ip:${clientIp}`;
const accountBucket = (email: string) => `account:${email}`;

/**
 * `clientIp()` returns "unknown" when no proxy header identifies the caller.
 *
 * Behind a deployment proxy `X-Forwarded-For` is always set, so this should be
 * rare in production — but when it happens, every caller collapses into one
 * bucket and the per-IP ceiling stops being a per-host control and becomes a
 * global lockout: five bad passwords from anyone would refuse the real admin's
 * correct password for fifteen minutes. Proved empirically 2026-08-04.
 *
 * So the unknown bucket keeps a ceiling — a runaway should still be bounded —
 * but a far higher one, chosen to be unreachable by a household and still
 * finite. Per-account throttling is unaffected and remains the real control
 * against credential stuffing.
 */
const UNKNOWN_IP = "unknown";
const LOGIN_MAX_PER_UNKNOWN_IP = 200;
const ipLimitFor = (clientIp: string) =>
  clientIp === UNKNOWN_IP ? LOGIN_MAX_PER_UNKNOWN_IP : LOGIN_MAX_PER_IP;

export async function isLoginThrottled(
  db: Database,
  clientIp: string,
  email?: string | null,
): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  await db.prepare("DELETE FROM login_attempts WHERE attempted_at <= ?").bind(since).run();

  const limits = new Map<string, number>([[ipBucket(clientIp), ipLimitFor(clientIp)]]);
  if (email) limits.set(accountBucket(email), LOGIN_MAX_PER_ACCOUNT);

  const buckets = [...limits.keys()];
  const placeholders = buckets.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT client_ip AS bucket, COUNT(*) AS count FROM login_attempts
       WHERE client_ip IN (${placeholders}) AND attempted_at > ?
       GROUP BY client_ip`,
    )
    .bind(...buckets, since)
    .all<{ bucket: string; count: number }>();

  return (result.results ?? []).some((row) => row.count >= (limits.get(row.bucket) ?? Infinity));
}

export async function recordLoginAttempt(
  db: Database,
  clientIp: string,
  email?: string | null,
): Promise<void> {
  const timestamp = now();
  const buckets = [ipBucket(clientIp), ...(email ? [accountBucket(email)] : [])];
  await db.batch(
    buckets.map((bucket) =>
      db
        .prepare("INSERT INTO login_attempts (client_ip, attempted_at) VALUES (?, ?)")
        .bind(bucket, timestamp),
    ),
  );
}

export async function clearLoginAttempts(
  db: Database,
  clientIp: string,
  email?: string | null,
): Promise<void> {
  const buckets = [ipBucket(clientIp), ...(email ? [accountBucket(email)] : [])];
  await db.batch(
    buckets.map((bucket) =>
      db.prepare("DELETE FROM login_attempts WHERE client_ip = ?").bind(bucket),
    ),
  );
}

// -------------------------------------------------------------- auditing

/**
 * Best-effort audit write. Observability must never break the request that
 * produced the event, so failures are swallowed after being logged.
 */
export async function recordAuthEvent(
  db: Database,
  event: string,
  actorEmail: string | null,
  clientIp: string | null,
  detail?: string,
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO auth_events (occurred_at, event, actor_email, client_ip, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(now(), event, actorEmail, clientIp, detail ?? null)
      .run();
  } catch (error) {
    console.error(`[auth] audit write failed for ${event}: ${String(error).slice(0, 200)}`);
  }
}

/** Drop every session a principal holds. Used when the owner revokes a token. */
export async function deleteSessionsForUser(db: Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
