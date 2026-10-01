/**
 * `/api/diagnose` driven through its real handler, against a real (in-memory)
 * SQLite database and a stubbed provider.
 *
 * The contract tests cover the pure halves — validation, parsing, rendering.
 * What they cannot see is the handler's use of a `caseId`, because that lives
 * between the request and the database: a stale id wrote nothing and was echoed
 * straight back, so the client kept using it and the whole session never reached
 * the corpus. The loader (`tests/support/app-loader.mjs`) is what lets plain
 * Node import `route.ts` and `cases.ts` at all.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { registerAppLoader } from "./support/app-loader.mjs";

registerAppLoader();

const { openDatabase } = await import("../app/lib/db.ts");
const { env } = await import("../app/lib/server-env.ts");
const { applySettingsPatch } = await import("../app/lib/settings.ts");
const { ensureDiagnosticCaseSchema, ensureReportSchema } = await import("../app/lib/cases.ts");
const { POST } = await import("../app/api/diagnose/route.ts");

const INTERVIEW_REPLY = {
  status: "needs_more_information",
  message: "Tell me more about when it stalls.",
  questions: [{ text: "Does it stall under load or at idle?", options: ["Under load", "At idle"] }],
};

/**
 * One database for the file, emptied between tests. The schema runners memoize
 * "already ran" per process rather than per handle, so a second `:memory:`
 * database would never get its tables.
 *
 * A Hugging Face model, because its wire format is one plain `fetch` — the
 * Anthropic path streams through the SDK and would need a server-sent-events
 * stub for no extra coverage of anything here.
 */
const db = openDatabase(":memory:");
await applySettingsPatch(db, { activeModel: "Qwen/Qwen2.5-7B-Instruct" });
await ensureDiagnosticCaseSchema(db);
await ensureReportSchema(db);
env.APP_DB = db;

async function freshInstall() {
  // Foreign keys are on, so the messages and reports go with their case.
  await db.prepare("DELETE FROM diagnostic_case").run();
  return db;
}

function stubProvider(content) {
  const real = globalThis.fetch;
  process.env.HF_TOKEN = "test-token";
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  return () => {
    globalThis.fetch = real;
    delete process.env.HF_TOKEN;
  };
}

const equipment = { year: "2014", make: "John Deere", model: "344K" };

function request(body) {
  return new Request("http://localhost:5211/api/diagnose", {
    method: "POST",
    body: JSON.stringify({ equipment, problem: "Stalls under load", ...body }),
  });
}

const rows = (db, sql, ...args) => db.prepare(sql).bind(...args).all().then((r) => r.results);

/** The by-product writes (`recordUsage`, `addCaseTokens`) are not awaited by the route. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const EARLIER_TURNS = [
  { role: "assistant", content: "What does the machine do when it stalls?" },
  { role: "user", content: "It dies under load, restarts fine." },
];

test("an interview turn carrying a stale caseId starts a fresh case and returns its id", async () => {
  const db = await freshInstall();
  const restore = stubProvider(INTERVIEW_REPLY);
  try {
    const response = await POST(
      request({
        action: "interview",
        caseId: "left-over-from-a-replaced-database",
        transcript: EARLIER_TURNS,
        attachmentNames: ["pump.jpg"],
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();

    // The id the client will send next must be one that exists, not the stale one echoed back.
    assert.ok(body.caseId, "no caseId in the reply");
    assert.notEqual(body.caseId, "left-over-from-a-replaced-database");

    const cases = await rows(db, "SELECT id, turn_count, status, photo_count FROM diagnostic_case");
    assert.equal(cases.length, 1);
    assert.equal(cases[0].id, body.caseId);
    assert.equal(cases[0].status, "interviewing");
    assert.equal(cases[0].photo_count, 1);

    // The session so far is backfilled from the transcript, then the new reply is appended.
    const messages = await rows(
      db,
      "SELECT turn_index, role FROM case_message WHERE case_id = ? ORDER BY turn_index",
      body.caseId,
    );
    assert.deepEqual(
      messages.map((m) => m.role),
      ["assistant", "user", "assistant"],
    );
    assert.equal(cases[0].turn_count, 3);
  } finally {
    restore();
  }
});

test("a live caseId is kept: a second turn adds messages, never a second case", async () => {
  const db = await freshInstall();
  const restore = stubProvider(INTERVIEW_REPLY);
  try {
    const first = await (await POST(request({ action: "interview" }))).json();
    assert.ok(first.caseId);
    await settle();

    const second = await (
      await POST(
        request({
          action: "interview",
          caseId: first.caseId,
          transcript: [
            { role: "assistant", content: "What does the machine do when it stalls?" },
            { role: "user", content: "It dies under load." },
          ],
        }),
      )
    ).json();
    assert.equal(second.caseId, first.caseId);

    assert.equal((await rows(db, "SELECT id FROM diagnostic_case")).length, 1);
    assert.equal((await rows(db, "SELECT id FROM case_message")).length, 3);
  } finally {
    restore();
  }
});

test("a report on a stale caseId is stored rather than dropped", async () => {
  const db = await freshInstall();
  const restore = stubProvider({});
  try {
    const response = await POST(
      request({ action: "report", caseId: "gone", transcript: EARLIER_TURNS }),
    );
    assert.equal(response.status, 200);
    assert.match((await response.json()).html, /<html/i);

    const cases = await rows(db, "SELECT id, status FROM diagnostic_case");
    assert.equal(cases.length, 1);
    assert.equal(cases[0].status, "reported");
    const reports = await rows(db, "SELECT case_id FROM report");
    assert.deepEqual(reports.map((r) => r.case_id), [cases[0].id]);
  } finally {
    restore();
  }
});

test("a report with no caseId at all still opens no case", async () => {
  // Only a stale id is healed. A report call that never had one is a direct
  // caller, and inventing a case for it would be a different behaviour change.
  const db = await freshInstall();
  const restore = stubProvider({});
  try {
    const response = await POST(request({ action: "report", transcript: EARLIER_TURNS }));
    assert.equal(response.status, 200);
    assert.equal((await rows(db, "SELECT id FROM diagnostic_case")).length, 0);
  } finally {
    restore();
  }
});

test("a refused response_format earns one unconstrained retry; a server error does not", async () => {
  // Servers disagree on how they refuse a parameter they do not know — 422 is the
  // validation-layer answer — and only 400 used to trigger the retry, so those
  // servers failed every diagnosis outright. A 5xx is the server failing, not
  // the parameter being refused, and must not be retried unconstrained.
  await freshInstall();
  const real = globalThis.fetch;
  process.env.HF_TOKEN = "test-token";
  const sent = [];
  let firstStatus = 422;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if ("response_format" in body) {
      return Response.json({ error: { message: "unknown field" } }, { status: firstStatus });
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(INTERVIEW_REPLY) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  };
  try {
    const refused = await POST(request({ action: "interview" }));
    assert.equal(refused.status, 200);
    assert.deepEqual(
      sent.map((body) => "response_format" in body),
      [true, false],
    );

    sent.length = 0;
    firstStatus = 503;
    const failing = await POST(request({ action: "interview" }));
    assert.equal(failing.status, 503);
    assert.equal(sent.length, 1, "a server error was retried");
  } finally {
    globalThis.fetch = real;
    delete process.env.HF_TOKEN;
  }
});
