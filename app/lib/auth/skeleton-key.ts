/**
 * The skeleton key — the owner's way in, and the only credential that is not a
 * one-time access token.
 *
 * Decided 2026-08-18: a single key on local disk, with no user ids and no
 * passwords. This replaced email/password sign-in outright. There is no
 * password anywhere in the app now, so there is nothing to phish, reset, throttle
 * by account, or leak through an enumeration oracle.
 *
 * The key lives on disk beside the SQLite files, at `$DB_DIR/skeleton.key`, so
 * when deployed it lands on the mounted volume and survives a redeploy exactly
 * as auth.db does. Locally that is `./db/skeleton.key`, which is gitignored
 * with the rest of `db/`.
 *
 * Three properties are load-bearing:
 *
 * - **Generated once, never regenerated silently.** If the file exists it is
 *   used as-is. A boot that quietly minted a new key would lock the owner out
 *   of their own deployment with no error.
 * - **Written 0600, and the process refuses a world-readable file** — a key
 *   readable by every account on the host is not a key.
 * - **Compared in constant time.** It is a bearer secret presented over the
 *   network; a byte-by-byte early exit is a timing oracle.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../server-env.ts";

export const SKELETON_KEY_FILENAME = "skeleton.key";

/** Same resolution instrumentation.ts uses for the SQLite files. */
export function skeletonKeyPath(): string {
  const dbDir = env.DB_DIR?.trim() || path.join(process.cwd(), "db");
  return path.join(dbDir, SKELETON_KEY_FILENAME);
}

/** 32 bytes, base64url, prefixed so it is recognisable in a paste. */
export function generateSkeletonKey(): string {
  return `rc_sk_${crypto.randomBytes(32).toString("base64url")}`;
}

/**
 * Returns the key, creating it on first boot. `created` tells the caller
 * whether to shout about it in the log — printing an existing key on every
 * restart would smear it across the deploy history for no reason.
 */
export function ensureSkeletonKey(): { key: string; created: boolean; keyPath: string } {
  const keyPath = skeletonKeyPath();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  if (fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(keyPath, "utf8").trim();
    if (existing) {
      const mode = fs.statSync(keyPath).mode & 0o077;
      if (mode !== 0) {
        console.error(
          `[auth] ${keyPath} is group/world readable — tightening to 0600. ` +
            "Rotate the key if the host is shared.",
        );
        fs.chmodSync(keyPath, 0o600);
      }
      return { key: existing, created: false, keyPath };
    }
    // An empty file is a half-finished write, not a key. Fall through and mint.
  }

  const key = generateSkeletonKey();
  fs.writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  return { key, created: true, keyPath };
}

/** Reads without creating. Null when there is no key yet. */
export function readSkeletonKey(): string | null {
  try {
    const value = fs.readFileSync(skeletonKeyPath(), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Constant-time equality. `timingSafeEqual` throws on a length mismatch, which
 * would itself be a length oracle, so both sides are hashed to a fixed width
 * first and the digests are compared.
 */
export function verifySkeletonKey(presented: unknown): boolean {
  if (typeof presented !== "string" || !presented) return false;
  const actual = readSkeletonKey();
  if (!actual) return false;
  const a = crypto.createHash("sha256").update(presented.trim()).digest();
  const b = crypto.createHash("sha256").update(actual).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Cheap shape test so the login route can tell a key from a token code. */
export function looksLikeSkeletonKey(value: string): boolean {
  return value.trim().startsWith("rc_sk_");
}
