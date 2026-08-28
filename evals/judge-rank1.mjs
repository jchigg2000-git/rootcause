#!/usr/bin/env node
// Score a run dir's rank-1 answers against each scenario's preRegistered block,
// using a cheap model as the judge.
//
//   node evals/judge-rank1.mjs <run-dir>... [--scenarios <path>] [--json]
//   node evals/judge-rank1.mjs --validate            # agreement vs banked hand scores
//
// WHY THIS EXISTS. Scoring this eval is prose matching and has always been
// judgment done by reading (evals/README.md). That is affordable at 10 runs and
// impossible at 576, which is what a run large enough to settle a small effect
// costs. Word-overlap matching is not a substitute: evals/score-rank1.mjs marks
// "right-side track tension is LOW" as correct against a ground truth of "too
// TIGHT", because it sees the same content words. Direction is exactly what
// these scenarios turn on.
//
// So: a model judges, and the judge is VALIDATED against every case already
// hand-scored in a committed scorecard before its output is trusted. Run
// --validate after any edit to the rubric below. If agreement drops under about
// 95%, the judge is not usable and the rubric needs work — do not quietly
// accept a worse judge because the big run is already paid for.
//
// The judge sees ONLY the rank-1 string and the pre-registered block. It never
// sees which arm produced it, so it cannot favour one.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? null : args[i + 1];
};

for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 3 });
const JUDGE_MODEL = arg("judge-model") ?? "claude-haiku-4-5-20251001";

const JUDGE_SYSTEM = `
You score one answer from a heavy-equipment diagnostic eval. You are given the pre-registered ground truth for a scenario and the single top-ranked cause a report produced. Decide whether that top-ranked cause is CORRECT.

Rules, in order:

1. It is CORRECT if it names the pre-registered correct cause, or any of the "also accepted" phrasings, in substance. Wording will differ; judge the claim, not the words.
2. It is CORRECT if it names a directly adjacent member of the same component group performing the same function as the true cause — a holding valve for a relief valve in the same circuit. Adjacent means same circuit and same job, not merely the same system.
3. It is INCORRECT if it names anything on the "scored wrong" list, even partially, even hedged among other causes.
4. DIRECTION IS DECISIVE AND IS THE MOST COMMON TRAP. If the true cause is a track being too TIGHT, then "tension is low", "track sag" or "loose track" is INCORRECT, not a near miss — it points a technician at the opposite repair. The same applies to high vs low, active vs stored, too much vs too little, and left vs right.
5. A hedge that leads with a wrong mechanism is INCORRECT even if it also mentions the right one. "Fuel contamination (water and/or debris)" against a DEF-contamination truth is INCORRECT, because water is on the scored-wrong list and leads the answer.
6. A general statement that is true but names no cause is INCORRECT. "Fuel system problem" does not identify a plugged filter.
7. When the answer is genuinely ambiguous between correct and incorrect, answer INCORRECT. A conservative judge that under-credits both arms equally is usable; a generous one is not.

Answer with exactly one word on the first line: CORRECT or INCORRECT. Then one short sentence of reason on the second line.
`.trim();

function loadScenarios(p) {
  const { scenarios } = JSON.parse(readFileSync(p, "utf8"));
  return new Map(scenarios.map((s) => [s.id, s]));
}

async function judge(scenario, rank1) {
  const p = scenario.preRegistered;
  const user = [
    `SCENARIO: ${scenario.id}`,
    `Reported problem: ${scenario.surfaceProblem}`,
    "",
    `PRE-REGISTERED CORRECT CAUSE: ${p.correctRank1}`,
    `ALSO ACCEPTED: ${(p.acceptAlsoAsCorrect ?? []).join(" | ") || "(none)"}`,
    `SCORED WRONG IF RANKED FIRST: ${(p.scoredWrongIfRank1 ?? []).join(" | ") || "(none)"}`,
    "",
    `THE ANSWER TO SCORE (top-ranked cause): ${rank1}`,
  ].join("\n");

  const message = await client.messages.create(
    { model: JUDGE_MODEL, max_tokens: 200, system: JUDGE_SYSTEM, messages: [{ role: "user", content: user }] },
    { timeout: 60_000 },
  );
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const first = text.split("\n")[0].toUpperCase();
  return {
    correct: first.includes("CORRECT") && !first.includes("INCORRECT"),
    reason: text.split("\n").slice(1).join(" ").trim(),
    usage: message.usage,
  };
}

function loadRuns(dir) {
  return readdirSync(dir)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .map((f) => {
      const a = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      return { file: f, id: a.scenarioId, rank1: a.ranked?.[0]?.problem ?? "" };
    });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// --- banked hand scores, transcribed from the committed scorecards ----------
// Every one of these was adjudicated by reading, before this judge existed.
const HAND = {
  "2026-08-19-intake-control": { c1: 1, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1 },
  "2026-08-19-intake-control-rep": { c1: 0, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1 },
  "2026-08-19-intake-codes": { c1: 1, c2: 1, c3: 0, c4: 1, c5: 1, c6: 1 },
  "2026-08-19-intake-codes-rep": { c1: 1, c2: 1, c3: 1, c4: 1, c5: 0, c6: 1 },
  "2026-08-19-codes-weighted": { c1: 1, c2: 1, c3: 0, c4: 1, c5: 0, c6: 1 },
  "2026-08-19-codes-weighted-rep": { c1: 1, c2: 1, c3: 0, c4: 1, c5: 0, c6: 1 },
  "2026-08-19-codes-triage": { c1: 1, c2: 1, c3: 0, c4: 1, c5: 1, c6: 1 },
  "2026-08-19-codes-triage-rep": { c1: 1, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1 },
};

async function validate() {
  // PINNED to v3 on purpose. Every dir in HAND was hand-scored against the ground
  // truth of its own era; judging them against a later revision would measure the
  // revision, not the judge. c1..c6 are byte-identical across v2/v3/v4 anyway, so
  // this is belt-and-braces — but the next repair may not be so contained.
  const byId = loadScenarios(path.join(ROOT, "evals/scenarios-codes-v3.json"));
  const jobs = [];
  for (const [dir, marks] of Object.entries(HAND)) {
    for (const r of loadRuns(path.join(ROOT, "evals/runs", dir))) {
      const short = r.id.split("-")[0];
      if (!(short in marks)) continue;
      jobs.push({ dir, short, expected: marks[short], scenario: byId.get(r.id), rank1: r.rank1 });
    }
  }
  const results = await mapLimit(jobs, 8, async (j) => ({ ...j, got: await judge(j.scenario, j.rank1) }));
  let agree = 0;
  const misses = [];
  for (const r of results) {
    const got = r.got.correct ? 1 : 0;
    if (got === r.expected) agree += 1;
    else misses.push(r);
  }
  console.log(`\nJUDGE VALIDATION — ${JUDGE_MODEL} against ${results.length} hand-scored cases`);
  console.log(`agreement: ${agree}/${results.length} = ${((agree / results.length) * 100).toFixed(1)}%\n`);
  for (const m of misses) {
    console.log(`DISAGREE ${m.dir} ${m.short}: hand=${m.expected ? "✓" : "✗"} judge=${m.got.correct ? "✓" : "✗"}`);
    console.log(`  answer: ${m.rank1.slice(0, 110)}`);
    console.log(`  judge : ${m.got.reason.slice(0, 150)}\n`);
  }
  if (agree / results.length < 0.95) {
    console.log("⚠ BELOW 95% — this judge is not usable. Fix the rubric; do not spend on a big run.");
    process.exitCode = 1;
  } else {
    console.log("✓ at or above 95% — usable.");
  }
}

async function scoreDirs() {
  const byId = loadScenarios(arg("scenarios") ?? path.join(ROOT, "evals/scenarios-codes-v4.json"));
  const dirs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const all = {};
  for (const dir of dirs) {
    const runs = loadRuns(dir);
    const scored = await mapLimit(runs, 8, async (r) => ({ ...r, ...(await judge(byId.get(r.id), r.rank1)) }));
    const byCase = {};
    for (const s of scored) {
      const short = s.id.split("-")[0];
      (byCase[short] ??= []).push(s.correct ? 1 : 0);
    }
    all[dir] = byCase;
    if (!flag("json")) {
      const tot = scored.filter((s) => s.correct).length;
      console.log(`\n${dir}: ${tot}/${scored.length}`);
      for (const [c, v] of Object.entries(byCase).sort()) {
        console.log(`  ${c.padEnd(4)} ${v.reduce((a, b) => a + b, 0)}/${v.length}`);
      }
    }
  }
  if (flag("json")) console.log(JSON.stringify(all, null, 2));
}

if (flag("validate")) await validate();
else await scoreDirs();
