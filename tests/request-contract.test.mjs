import assert from "node:assert/strict";
import test from "node:test";

import { UNREACHABLE_MESSAGE, requestJson } from "../app/lib/request.ts";

/** Swap in a fetch, run one call, always put the real one back. */
async function withFetch(stub, run) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const asJson = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const asHtml = (status) =>
  new Response("<html><body>502 Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });

test("a fetch that throws becomes a message, never a rejection", async () => {
  // The whole point: offline / DNS / connection reset used to escape the call
  // site as an unhandled rejection, so nothing on the page ever said anything.
  const result = await withFetch(
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => requestJson("/api/settings", { method: "PUT" }, "That change was rejected."),
  );
  assert.deepEqual(result, { ok: false, message: UNREACHABLE_MESSAGE });
});

test("a refusal carrying { error } surfaces the server's own sentence", async () => {
  const result = await withFetch(
    () => Promise.resolve(asJson({ error: "Reports must be a whole number (0 for unlimited)." }, 400)),
    () => requestJson("/api/settings", { method: "PUT" }, "That change was rejected."),
  );
  assert.deepEqual(result, {
    ok: false,
    message: "Reports must be a whole number (0 for unlimited).",
  });
});

test("a refusal that names no reason falls back to the caller's wording", async () => {
  const empty = await withFetch(
    () => Promise.resolve(asJson({}, 500)),
    () => requestJson("/api/settings", undefined, "Could not load settings."),
  );
  assert.deepEqual(empty, { ok: false, message: "Could not load settings." });
});

test("a body that is not JSON still yields a usable message, at any status", async () => {
  const gateway = await withFetch(
    () => Promise.resolve(asHtml(502)),
    () => requestJson("/api/usage", undefined, "This month's spend could not be loaded."),
  );
  assert.deepEqual(gateway, { ok: false, message: "This month's spend could not be loaded." });

  // A 200 whose body will not parse is a failure too — there is no payload to
  // hand back, and handing back `undefined` is how a card loads forever.
  const unparseable = await withFetch(
    () => Promise.resolve(asHtml(200)),
    () => requestJson("/api/usage", undefined, "This month's spend could not be loaded."),
  );
  assert.deepEqual(unparseable, { ok: false, message: "This month's spend could not be loaded." });
});

test("a 200 hands back the parsed payload, and the request goes out untouched", async () => {
  let seen;
  const result = await withFetch(
    (input, init) => {
      seen = { input, init };
      return Promise.resolve(asJson({ settings: { maxPhotos: 3 } }, 200));
    },
    () =>
      requestJson("/api/settings", { method: "PUT", body: '{"maxPhotos":3}' }, "unused"),
  );
  assert.deepEqual(result, { ok: true, data: { settings: { maxPhotos: 3 } } });
  // This module changes how failures are reported, never what goes on the wire.
  assert.deepEqual(seen, {
    input: "/api/settings",
    init: { method: "PUT", body: '{"maxPhotos":3}' },
  });
});
