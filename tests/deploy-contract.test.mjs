import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/**
 * Pins the one deploy invariant whose regression is silent and destructive.
 *
 * `npm start` runs through `sh -c`. The container's shell is dash (Debian
 * bookworm), which does NOT exec the final command — so without a leading
 * `exec` the tree is `npm(1) → sh(32) → node(33)`, the host's SIGTERM reaches
 * `sh`, and `sh` does not forward it. node then dies by SIGKILL and
 * `instrumentation.ts`'s shutdown hook never runs: the WAL is never folded back
 * into `app.db`, which is left a 4096-byte header that restores empty.
 *
 * Nothing else catches this. It builds, it lints, it typechecks, and it deploys
 * to a passing `/api/health`, because startup is entirely unaffected — only
 * teardown breaks. It also passes local testing, because macOS `/bin/sh` DOES
 * exec and collapses the wrapper on its own. An automated config-hardening
 * pass has already read this exact line and blessed the un-`exec`'d form as
 * correct, so a rewrite dropping it is a demonstrated failure mode, not a
 * hypothetical one.
 *
 * Both directions measured on the target image and on macOS, 2026-08-08.
 */

test("npm start execs, so node is npm's direct child and can be signalled", () => {
  assert.match(
    pkg.scripts.start,
    /^exec\s/,
    "`start` must begin with `exec` — without it SIGTERM reaches sh, not node, " +
      "and the WAL checkpoint in instrumentation.ts never runs",
  );
});

test("npm start still honours an injected PORT and falls back to 5211", () => {
  // A container host injects PORT; a local production run has to keep the pinned
  // port. Both halves live in the same string the `exec` guard above protects.
  assert.match(pkg.scripts.start, /\$\{PORT:-5211\}/);
});

test("the dev script stays on the pinned port", () => {
  assert.match(pkg.scripts.dev, /--port 5211\b/);
});
