/**
 * `/api/random-scenario` refusals, through the real handler.
 *
 * The route reaches a billable provider, so anything malformed has to be
 * refused before a model is called — and refused as a 400/413, not a 500.
 * `null` is valid JSON and used to throw on the first field read.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { registerAppLoader } from "./support/app-loader.mjs";

registerAppLoader();

const { POST } = await import("../app/api/random-scenario/route.ts");

const post = (body) =>
  POST(new Request("http://localhost:5211/api/random-scenario", { method: "POST", body }));

test("a malformed or oversized body is refused before any model call", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => assert.fail("the provider was called");
  try {
    for (const body of ["null", "[]", "42", "not json"]) {
      assert.equal((await post(body)).status, 400, `body ${body}`);
    }
    const huge = JSON.stringify({ make: "Deere", model: "350G", pad: "x".repeat(8 * 1024) });
    assert.equal((await post(huge)).status, 413);
  } finally {
    globalThis.fetch = real;
  }
});
