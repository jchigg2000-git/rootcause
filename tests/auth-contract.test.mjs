import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sqlStatements } from "../app/lib/sql.ts";
import { generateCode, normalizeCode } from "../app/lib/auth/access-code.ts";
import {
  isAdminPath,
  isAdminWrite,
  isApiPath,
  isPublicPath,
  normalizePath,
} from "../app/lib/auth/paths.ts";
import { accessDeniedMessage, decideAccess } from "../app/lib/access-policy.ts";

/**
 * There are no password tests here any more, and that is the point: passwords
 * were removed from the app entirely on 2026-08-18. The credentials now are the
 * skeleton key on disk and the access codes below.
 */

test("every schema statement survives comment stripping", () => {
  for (const file of ["0001_auth.sql", "0011_access_token.sql", "0012_token_grant.sql"]) {
    const schema = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    const statements = sqlStatements(schema);
    assert.ok(statements.length > 0, `${file} produced no statements`);
    for (const statement of statements) {
      assert.ok(!statement.includes("--"), `${file}: comment leaked into a statement`);
      assert.ok(statement.trim().length > 0, `${file}: empty statement survived the split`);
    }
    // Every statement has to be idempotent: these files re-run on every boot.
    for (const statement of statements) {
      assert.match(
        statement,
        /IF NOT EXISTS/i,
        `${file}: "${statement.slice(0, 40)}…" would fail on the second boot`,
      );
    }
  }
});

test("an issued access code is well-formed and unambiguous", () => {
  const code = generateCode();
  assert.match(code, /^RC-[2-9A-HJKMNP-TV-Z]{5}(-[2-9A-HJKMNP-TV-Z]{5}){3}$/);
  // The alphabet excludes the characters that get misread down a phone line.
  for (const forbidden of ["I", "L", "O", "U", "0", "1"]) {
    assert.ok(!code.slice(3).includes(forbidden), `code should not contain ${forbidden}`);
  }
  // Two codes in a row must not collide.
  assert.notEqual(generateCode(), generateCode());
});

test("a code is accepted however a human retypes it, and only then", () => {
  const code = generateCode();
  const bare = code.replace(/-/g, "");
  // Case, hyphens and stray spaces are all forgiven; the canonical form is what
  // gets hashed, so only one representation is ever stored.
  assert.equal(normalizeCode(code), code);
  assert.equal(normalizeCode(code.toLowerCase()), code);
  assert.equal(normalizeCode(bare), code);
  assert.equal(normalizeCode(`  ${code}  `), code);
  assert.equal(normalizeCode(bare.replace(/^RC/, "rc")), code);

  // Rejections. A near-miss must not normalize into somebody else's code.
  assert.equal(normalizeCode(`${code}X`), null, "too long");
  assert.equal(normalizeCode(code.slice(0, -1)), null, "too short");
  assert.equal(normalizeCode(code.replace("RC-", "XX-")), null, "wrong prefix");
  assert.equal(normalizeCode(code.slice(3, 8)), null, "no prefix");
  assert.equal(normalizeCode(""), null);
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode(12345), null);
  // A character outside the alphabet is not silently folded to a valid one.
  assert.equal(normalizeCode(`RC-IIIII-${bare.slice(7)}`), null, "excluded letters rejected");
});

test("the gate allowlist covers exactly what it should", () => {
  // Public. There is no billing callback any more, and no signup route to add.
  for (const path of ["/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me"]) {
    assert.equal(isPublicPath(path), true, `${path} should be public`);
  }
  // Everything else under /api is not — including the code console, and
  // including every route that can bill the owner's provider key. A billable
  // route that slipped into the allowlist would be an open tap, so all three
  // are named here rather than trusting "everything else".
  for (const path of [
    "/api/diagnose",
    "/api/spec-lookup",
    "/api/parts-lookup",
    "/api/settings",
    "/api/tokens",
    "/api/usage",
  ]) {
    assert.equal(isPublicPath(path), false, `${path} must require a session`);
  }
  // The removed Stripe webhook must not linger in the allowlist.
  assert.equal(isPublicPath("/api/stripe/webhook"), false);

  // Trailing slashes cannot be used to miss the set either way.
  assert.equal(isPublicPath(normalizePath("/api/health/")), true);
  assert.equal(isPublicPath(normalizePath("/api/diagnose/")), false);

  // Non-API paths bypass the gate so the login page can render.
  assert.equal(isApiPath("/login"), false);
  assert.equal(isApiPath("/settings"), false);
  assert.equal(isApiPath("/api/diagnose"), true);
});

test("admin surfaces are gated, including the settings write", () => {
  // Issuing and revoking access codes is the owner's console: a token holder
  // reaching it could mint themselves an unlimited allowance.
  assert.equal(isAdminPath("/api/tokens"), true);
  assert.equal(isAdminPath("/api/tokens/abc-123"), true);
  assert.equal(isPublicPath("/api/tokens"), false);

  // Billable demo affordance and the all-users spend view are admin-only,
  // while a viewer's own /api/usage stays session-gated, not admin-gated.
  assert.equal(isAdminPath("/api/random-scenario"), true);
  assert.equal(isAdminPath("/api/usage/summary"), true);
  assert.equal(isAdminPath("/api/usage"), false);

  // Prefix matching must not catch a sibling route that merely starts the same.
  assert.equal(isAdminPath("/api/tokens-export"), false);
  assert.equal(isAdminPath("/api/settings"), false);

  // Observability exposes the audit log and telemetry — admin only, and never
  // public.
  assert.equal(isAdminPath("/api/observability"), true);
  assert.equal(isAdminPath("/api/observability/anything"), true);
  assert.equal(isPublicPath("/api/observability"), false);

  // Settings are readable by any signed-in viewer and writable only by an admin.
  assert.equal(isAdminWrite("/api/settings", "GET"), false);
  assert.equal(isAdminWrite("/api/settings", "PUT"), true);
  assert.equal(isAdminWrite("/api/settings", "POST"), true);
  assert.equal(isAdminWrite("/api/diagnose", "POST"), false);
});

/**
 * Entitlement: what an access code actually buys.
 *
 * `decideAccess` is the storage-free half of `checkAccess`, split out so this
 * table can be walked without a database. Ratified 2026-08-19: a code buys N
 * generated reports, with a lifetime token cap behind it as a backstop.
 */
test("entitlement: runs are the headline limit, tokens the backstop", () => {
  const grant = (over = {}) => ({
    run_cap: 3,
    runs_used: 0,
    token_cap: 500_000,
    tokens_used: 0,
    ...over,
  });

  // The skeleton key is exempt, with or without a grant row.
  assert.deepEqual(decideAccess("admin", null), { allowed: true, exempt: true });
  assert.deepEqual(decideAccess("admin", grant({ runs_used: 99 })), { allowed: true, exempt: true });

  // Default-deny. Absence of a record is never permission — this is the one
  // that stops an unmetered call against the owner's provider key.
  assert.deepEqual(decideAccess("viewer", null), {
    allowed: false,
    reason: "no-grant",
    used: 0,
    cap: 0,
  });

  // Inside both limits.
  assert.deepEqual(decideAccess("viewer", grant({ runs_used: 2, tokens_used: 499_999 })), {
    allowed: true,
    exempt: false,
  });

  // Runs spent. The boundary is >=, so the third report of a 3-run code is the
  // last one that runs, not the first one refused.
  assert.deepEqual(decideAccess("viewer", grant({ runs_used: 3 })), {
    allowed: false,
    reason: "runs-exhausted",
    used: 3,
    cap: 3,
  });

  // Token backstop trips even with runs left — that is its entire purpose.
  assert.deepEqual(decideAccess("viewer", grant({ runs_used: 1, tokens_used: 500_000 })), {
    allowed: false,
    reason: "tokens-exhausted",
    used: 500_000,
    cap: 500_000,
  });

  // Both spent reports the RUN limit: it is what the holder was sold, so it is
  // the number that should explain the refusal.
  assert.equal(
    decideAccess("viewer", grant({ runs_used: 3, tokens_used: 999_999 })).reason,
    "runs-exhausted",
  );

  // 0 means unlimited, independently on each axis.
  assert.deepEqual(decideAccess("viewer", grant({ run_cap: 0, runs_used: 9999 })), {
    allowed: true,
    exempt: false,
  });
  assert.deepEqual(decideAccess("viewer", grant({ token_cap: 0, tokens_used: 9e9 })), {
    allowed: true,
    exempt: false,
  });
  assert.deepEqual(
    decideAccess("viewer", { run_cap: 0, runs_used: 5, token_cap: 0, tokens_used: 5 }),
    { allowed: true, exempt: false },
  );
});

test("entitlement: the refusal names the limit that was actually hit", () => {
  const denied = (reason, cap) => accessDeniedMessage({ allowed: false, reason, used: cap, cap });

  assert.match(denied("no-grant", 0), /no remaining allowance/);
  assert.match(denied("runs-exhausted", 3), /all 3 reports/);
  // Singular, because "all 1 reports" reads as a bug to the operator it is shown to.
  assert.match(denied("runs-exhausted", 1), /all 1 report\b/);
  assert.match(denied("tokens-exhausted", 500_000), /500,000 token/);
  // Neither message may mention the skeleton key: these reach a code holder.
  for (const reason of ["no-grant", "runs-exhausted", "tokens-exhausted"]) {
    assert.doesNotMatch(denied(reason, 3), /skeleton/i);
  }
});
