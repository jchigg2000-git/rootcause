import assert from "node:assert/strict";
import test from "node:test";

import {
  RELOAD_COOLDOWN_MS,
  isStaleBuildAsset,
  isStaleBuildError,
  shouldReload,
} from "../app/lib/build-recovery.ts";

/**
 * Pins the stale-build matcher. The reload it triggers is destructive — it
 * discards unsent interview answers — so both directions matter: every
 * engine's real wording must match, and an ordinary application error must
 * not.
 */

test("recognises a dead chunk in every engine's wording", () => {
  const real = [
    // Chromium
    "Failed to fetch dynamically imported module: https://rootcause.example/assets/library-view-C_RtQ9cU.js",
    // Firefox
    "error loading dynamically imported module",
    // Safari / WebKit
    "Importing a module script failed.",
    // Vite's CSS preload helper
    "Unable to preload CSS for /assets/index-C_EMfXIj.css",
    // Loader-thrown names still seen in the wild
    "ChunkLoadError: Loading chunk 42 failed.",
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html'.",
  ];
  for (const message of real) {
    assert.equal(isStaleBuildError(message), true, message);
    assert.equal(isStaleBuildError(new Error(message)), true, `Error(${message})`);
  }
});

test("does not reload the page for an ordinary application error", () => {
  const benign = [
    "Cannot read properties of undefined (reading 'cursor')",
    "The diagnostic request failed.",
    "NetworkError when attempting to fetch resource.",
    "Unexpected token < in JSON at position 0",
    "",
    null,
    undefined,
    {},
  ];
  for (const reason of benign) {
    assert.equal(isStaleBuildError(reason), false, String(reason));
  }
});

test("matches a failed build asset only for our own script and link tags", () => {
  assert.equal(isStaleBuildAsset("SCRIPT", "/assets/diagnostic-app-B2ErXVZV.js"), true);
  assert.equal(isStaleBuildAsset("link", "https://rootcause.example/assets/index-C_EMfXIj.css"), true);
  // Not a build artifact: an <img> that 404s must never reload the page.
  assert.equal(isStaleBuildAsset("IMG", "/assets/photo.png"), false);
  // Not our assets: a third-party script failing is not our deploy.
  assert.equal(isStaleBuildAsset("SCRIPT", "https://cdn.example.com/tag.js"), false);
  assert.equal(isStaleBuildAsset("SCRIPT", "/icons/logo.png"), false);
  assert.equal(isStaleBuildAsset(null, "/assets/x.js"), false);
  assert.equal(isStaleBuildAsset("SCRIPT", null), false);
});

test("the cooldown is what stops a reload loop on a genuinely broken build", () => {
  // Never reloaded: recover.
  assert.equal(shouldReload(null, 1_000_000), true);
  // Just reloaded and it failed again — the new build is broken too. Stop.
  assert.equal(shouldReload(1_000_000, 1_000_000 + RELOAD_COOLDOWN_MS - 1), false);
  // Past the window: a tab open across a second deploy recovers again.
  assert.equal(shouldReload(1_000_000, 1_000_000 + RELOAD_COOLDOWN_MS), true);
  // sessionStorage round-trips through a string, so garbage must not wedge it.
  assert.equal(shouldReload(Number("not-a-number"), 1_000_000), true);
});
