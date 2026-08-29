/**
 * Pins the two things `middleware.ts` does to every request, and the schema
 * files it runs against.
 *
 * This replaced `auth-contract.test.mjs`, which pinned a route allowlist, an
 * access-code alphabet and an entitlement decision table. None of those exist
 * any more: RootCause has no accounts and no sign-in. What survived the removal
 * is the part that was never about identity — the security headers, and the
 * origin check that keeps a page the operator happens to be visiting from
 * spending their provider key in the background.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { sqlStatements } from "../app/lib/sql.ts";
import {
  isApiPath,
  isCrossOriginWrite,
  normalizePath,
  withSecurityHeaders,
} from "../app/lib/request-guard.ts";

const ORIGIN = "http://localhost:5211";

test("every schema statement survives comment stripping and re-runs cleanly", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  assert.ok(files.length > 0, "no migrations found");

  for (const file of files) {
    const statements = sqlStatements(readFileSync(new URL(file, dir), "utf8"));
    assert.ok(statements.length > 0, `${file} produced no statements`);
    for (const statement of statements) {
      assert.ok(!statement.includes("--"), `${file}: comment leaked into a statement`);
      assert.ok(statement.trim().length > 0, `${file}: empty statement survived the split`);
      // These files re-run in full on every boot, so every statement has to be
      // idempotent — `CREATE … IF NOT EXISTS`, or `DROP … IF EXISTS`.
      assert.match(
        statement,
        /IF (NOT )?EXISTS/i,
        `${file}: "${statement.slice(0, 48)}…" would fail on the second boot`,
      );
    }
  }
});

test("a column an index still covers cannot be dropped, so the drop comes second", () => {
  // SQLite refuses `ALTER TABLE … DROP COLUMN` while an index references the
  // column. The two ownership indexes are dropped in the .sql files, which the
  // schema runner executes before the column-dropper guards in inventory.ts and
  // budget.ts. Getting that order wrong fails only on a database that predates
  // the removal of accounts — which is nobody's test database, so pin it here.
  const dir = new URL("../migrations/", import.meta.url);
  const drops = {
    "0006_machine_inventory.sql": "machine_user_id_idx",
    "0009_usage_ledger.sql": "usage_ledger_user_ts_idx",
  };
  for (const [file, index] of Object.entries(drops)) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.match(source, new RegExp(`DROP INDEX IF EXISTS ${index}`, "i"), file);
  }
});

test("no migration still declares an owner column", () => {
  // The app has one operator. A `user_id` reappearing in a CREATE would be
  // half-restored multi-tenancy that nothing enforces.
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    const declares = sqlStatements(source).some(
      (statement) => /^CREATE TABLE/i.test(statement) && /\buser_id\b/.test(statement),
    );
    assert.equal(declares, false, `${file} still declares user_id`);
  }
});

test("paths classify the same with or without a trailing slash", () => {
  assert.equal(isApiPath("/api/diagnose"), true);
  assert.equal(isApiPath(normalizePath("/api/diagnose/")), true);
  assert.equal(isApiPath("/settings"), false);
  assert.equal(isApiPath("/"), false);
  assert.equal(normalizePath("/api/health///"), "/api/health");
  // A path of only slashes must not normalize to the empty string, which
  // `startsWith` would then classify as a non-API path by accident.
  assert.equal(normalizePath("///"), "/");
});

test("reads are never refused, whatever origin they claim", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isCrossOriginWrite(method, "https://evil.test", "cross-site", ORIGIN), false);
  }
});

test("a state-changing call from another origin is refused", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isCrossOriginWrite(method, "https://evil.test", null, ORIGIN), true, method);
  }
  // Origin absent but Sec-Fetch-Site present: browsers always send the second,
  // and page script cannot forge it, so it decides on its own.
  assert.equal(isCrossOriginWrite("POST", null, "cross-site", ORIGIN), true);
  assert.equal(isCrossOriginWrite("POST", null, "same-site", ORIGIN), true);
});

test("the app's own requests, and requests from no browser at all, pass", () => {
  assert.equal(isCrossOriginWrite("POST", ORIGIN, "same-origin", ORIGIN), false);
  // A direct navigation or a same-origin form posts `none`.
  assert.equal(isCrossOriginWrite("POST", ORIGIN, "none", ORIGIN), false);
  // Neither header: curl, a script, the operator's own terminal. Not a browser,
  // so there is no third-party page driving it — refusing here would break
  // every scripted call for no gain.
  assert.equal(isCrossOriginWrite("POST", null, null, ORIGIN), false);
});

test("security headers ride on every response, HSTS only in production", () => {
  const headers = (isProduction) =>
    withSecurityHeaders(new Response("body", { status: 418 }), isProduction).headers;

  const dev = headers(false);
  assert.equal(dev.get("X-Content-Type-Options"), "nosniff");
  assert.equal(dev.get("X-Frame-Options"), "DENY");
  assert.equal(dev.get("Referrer-Policy"), "no-referrer");
  // HSTS on a plain-HTTP dev server would pin localhost to HTTPS in the
  // browser for a year, breaking every other project on the machine.
  assert.equal(dev.get("Strict-Transport-Security"), null);

  assert.match(headers(true).get("Strict-Transport-Security"), /max-age=31536000/);
});

test("wrapping preserves the status and the body it was given", async () => {
  const wrapped = withSecurityHeaders(
    new Response(JSON.stringify({ error: "Cross-origin request rejected." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
    false,
  );
  assert.equal(wrapped.status, 403);
  assert.equal(wrapped.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await wrapped.json(), { error: "Cross-origin request rejected." });
});
