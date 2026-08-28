/**
 * One-time access tokens — the only way in for anyone who is not the owner.
 *
 * Decided 2026-08-18: the only ways in are a one-time token and the owner's
 * skeleton key. Replaces both Stripe billing and email/password signup: there
 * is no self-serve account, so a code handed out
 * by the owner is the entire customer on-ramp.
 *
 * Storage posture matches `sessions` exactly — only the SHA-256 of the code is
 * persisted, so a dump of auth.db cannot be redeemed. The plaintext is returned
 * once by `issueAccessToken` and is unrecoverable afterwards; reissuing is the
 * only recovery.
 *
 * The code alphabet and its pure helpers live in `access-code.ts`, which has no
 * `?raw` import and is therefore unit-testable.
 */
import accessTokenSchema from "../../../migrations/0011_access_token.sql?raw";
import type { Database } from "../db.ts";
import { createColumnGuard, createSchemaRunner } from "../sql.ts";
import { sha256Hex } from "./store.ts";
import { generateCode, normalizeCode } from "./access-code.ts";

export { generateCode, normalizeCode } from "./access-code.ts";

const runAccessTokenSchema = createSchemaRunner(accessTokenSchema);
// Grown auth databases predate run_cap in 0011's CREATE.
const tokenRunCapGuard = createColumnGuard("access_token", "run_cap", "INTEGER NOT NULL DEFAULT 0");

export async function ensureAccessTokenSchema(db: Database): Promise<void> {
  await runAccessTokenSchema(db);
  await tokenRunCapGuard(db);
}

export type AccessTokenRow = {
  id: string;
  code_hash: string;
  label: string | null;
  run_cap: number;
  token_cap: number;
  expires_at: string | null;
  created_at: string;
  redeemed_at: string | null;
  user_id: string | null;
  revoked_at: string | null;
};

const now = () => new Date().toISOString();

/** ~98 bits over a 30-character alphabet, grouped for transcription. */
export type IssuedToken = {
  id: string;
  code: string;
  label: string | null;
  runCap: number;
  tokenCap: number;
};

/** Mints a code and returns the plaintext ONCE. Admin-only at the route. */
export async function issueAccessToken(
  db: Database,
  input: {
    label?: string | null;
    runCap: number;
    tokenCap: number;
    expiresAt?: string | null;
  },
): Promise<IssuedToken> {
  await ensureAccessTokenSchema(db);
  const code = generateCode();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO access_token (id, code_hash, label, run_cap, token_cap, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      await sha256Hex(code),
      input.label?.trim() || null,
      Math.max(0, Math.floor(input.runCap)),
      Math.max(0, Math.floor(input.tokenCap)),
      input.expiresAt ?? null,
      now(),
    )
    .run();
  return {
    id,
    code,
    label: input.label?.trim() || null,
    runCap: input.runCap,
    tokenCap: input.tokenCap,
  };
}

export type RedeemFailure = "invalid" | "revoked" | "expired";
export type RedeemResult =
  | { ok: true; token: AccessTokenRow; firstUse: boolean }
  | { ok: false; reason: RedeemFailure };

/**
 * Resolve a presented code to its account, claiming it on first use.
 *
 * "One-time" is about the ALLOWANCE, not the number of sign-ins. A code that
 * stopped working after one session would strand its holder the moment that
 * session expired, with no way back in and no self-serve recovery — there is no
 * email in this app to send a reset to. So the code stays the credential for
 * the life of its grant: first presentation claims it and mints the account,
 * later presentations resolve to that same account. It stops working when the
 * allowance is spent (enforced in app/lib/access.ts), when it expires, or when
 * the owner revokes it.
 *
 * The claim is a single guarded UPDATE — `redeemed_at IS NULL` sits inside the
 * write, never a check-then-write — so two concurrent first uses cannot both
 * mint an account. The loser changes zero rows, re-reads, and resumes the
 * winner's account.
 */
export async function redeemAccessToken(
  db: Database,
  code: string,
  mintUser: () => Promise<string>,
): Promise<RedeemResult> {
  await ensureAccessTokenSchema(db);
  const canonical = normalizeCode(code);
  if (!canonical) return { ok: false, reason: "invalid" };

  const hash = await sha256Hex(canonical);
  const row = await db
    .prepare("SELECT * FROM access_token WHERE code_hash = ?")
    .bind(hash)
    .first<AccessTokenRow>();
  if (!row) return { ok: false, reason: "invalid" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && row.expires_at <= now()) return { ok: false, reason: "expired" };

  if (row.redeemed_at && row.user_id) return { ok: true, token: row, firstUse: false };

  const userId = await mintUser();
  const timestamp = now();
  await db
    .prepare(
      `UPDATE access_token SET redeemed_at = ?, user_id = ?
       WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(timestamp, userId, row.id)
    .run();

  // Re-read rather than trusting a changes count: the adapter's shape varies,
  // and the row itself is the authority on who won the claim.
  const settled = await db
    .prepare("SELECT * FROM access_token WHERE id = ?")
    .bind(row.id)
    .first<AccessTokenRow>();
  if (!settled?.user_id) return { ok: false, reason: "invalid" };
  return { ok: true, token: settled, firstUse: settled.user_id === userId };
}
/** Never returns a hash — the admin list is metadata only. */
export async function listAccessTokens(db: Database): Promise<Omit<AccessTokenRow, "code_hash">[]> {
  await ensureAccessTokenSchema(db);
  const result = await db
    .prepare(
      `SELECT id, label, run_cap, token_cap, expires_at, created_at, redeemed_at, user_id, revoked_at
       FROM access_token ORDER BY created_at DESC LIMIT 200`,
    )
    .all<Omit<AccessTokenRow, "code_hash">>();
  return result.results ?? [];
}

/**
 * Revoking an unredeemed code makes it unredeemable. Revoking a redeemed one
 * marks it, but the holder's session and grant are killed separately by the
 * route — the token row is a record, not the live credential.
 */
export async function revokeAccessToken(db: Database, id: string): Promise<AccessTokenRow | null> {
  await ensureAccessTokenSchema(db);
  const row = await db
    .prepare("SELECT * FROM access_token WHERE id = ?")
    .bind(id)
    .first<AccessTokenRow>();
  if (!row) return null;
  await db
    .prepare("UPDATE access_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now(), id)
    .run();
  return row;
}
