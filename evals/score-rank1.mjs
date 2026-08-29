#!/usr/bin/env node
// Lay a run dir's rank-1 answers next to each scenario's preRegistered block so
// a reader can adjudicate quickly, and flag the obvious matches mechanically.
//
//   node evals/score-rank1.mjs evals/runs/<dir> [--scenarios <path>] [--terse]
//
// ⚠ THE MECHANICAL VERDICT IS A DRAFT, NOT A SCORE. Scoring this eval is prose
// matching and stays judgment (evals/README.md). Word overlap cannot tell
// "track tension too tight" from "track tension is low" — it sees the same
// content words in both. The point of this file is to stop a human re-typing
// twenty rank-1 strings, not to decide anything.
//
// That is not a hypothetical: over the banked 2026-08-19 intake-codes run (local
// to evals/runs/, which does not ship)
// it marks c3 "likely ✓ (hit 0.80)" for "Right-side track tension is LOW", which
// is the exact inversion of the ground truth and was hand-scored ✗. It agreed
// with the hand score on 5 of those 6. Treat every "likely ✓" on a case whose
// alternatives differ by DIRECTION — more/less, high/low, tight/loose, active/
// stored — as a READ IT.
//
// Pass --pair <dirA> <dirB> to print the DISCORDANT cases between two dirs,
// which is the comparison that actually carries information — see the README's
// "score arms on discordant cases" rule.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const dirs = args.filter((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const terse = args.includes("--terse");

const scenariosPath = arg("scenarios") ?? "evals/scenarios-codes-v4.json";
const { scenarios } = JSON.parse(readFileSync(scenariosPath, "utf8"));
const byId = new Map(scenarios.map((s) => [s.id, s]));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Content words shared between two strings, ignoring filler. */
const STOP = new Set("the a an of or and in on at to for from with by is are was were be been it its this that as into causing cause caused due not no non".split(" "));
function overlap(a, b) {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 3 && !STOP.has(w)));
  const wb = new Set(norm(b).split(" ").filter((w) => w.length > 3 && !STOP.has(w)));
  if (!wa.size || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit += 1;
  return hit / Math.min(wa.size, wb.size);
}

function draftVerdict(scenario, rank1) {
  const p = scenario.preRegistered;
  const targets = [p.correctRank1, ...(p.acceptAlsoAsCorrect ?? [])];
  const wrongs = p.scoredWrongIfRank1 ?? [];
  const best = Math.max(...targets.map((t) => overlap(rank1, t)));
  const worst = Math.max(...wrongs.map((w) => overlap(rank1, w)));
  if (best >= 0.5 && best > worst) return { mark: "likely ✓", best, worst };
  if (worst >= 0.5 && worst > best) return { mark: "likely ✗", best, worst };
  return { mark: "READ IT", best, worst };
}

function loadDir(dir) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => x.startsWith("run-") && x.endsWith(".json"))) {
    const a = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    out.set(a.scenarioId, a.ranked?.[0]?.problem ?? "(no ranked output)");
  }
  return out;
}

if (args.includes("--pair")) {
  const [a, b] = [arg("pair"), args[args.indexOf("--pair") + 2]];
  const A = loadDir(a);
  const B = loadDir(b);
  console.log(`A = ${a}\nB = ${b}\n`);
  let same = 0;
  for (const id of [...A.keys()].sort()) {
    const va = draftVerdict(byId.get(id), A.get(id)).mark;
    const vb = draftVerdict(byId.get(id), B.get(id)).mark;
    if (va === vb) { same += 1; continue; }
    console.log(`DISCORDANT ${id}`);
    console.log(`  A ${va.padEnd(9)} ${A.get(id).slice(0, 90)}`);
    console.log(`  B ${vb.padEnd(9)} ${B.get(id).slice(0, 90)}\n`);
  }
  console.log(`concordant: ${same}/${A.size} — those carry NO information about which arm is better`);
} else {
  for (const dir of dirs) {
    const runs = loadDir(dir);
    console.log(`\n######## ${dir}  (${runs.size} runs)`);
    for (const id of [...runs.keys()].sort()) {
      const s = byId.get(id);
      if (!s) { console.log(`  ${id}: NOT IN ${scenariosPath}`); continue; }
      const rank1 = runs.get(id);
      const v = draftVerdict(s, rank1);
      console.log(`\n  ${id}  [${v.mark}]  (hit ${v.best.toFixed(2)} / wrong ${v.worst.toFixed(2)})`);
      console.log(`    got   : ${rank1.slice(0, 130)}`);
      if (!terse) {
        console.log(`    want  : ${s.preRegistered.correctRank1.slice(0, 130)}`);
        console.log(`    wrong : ${(s.preRegistered.scoredWrongIfRank1 ?? []).join(" | ").slice(0, 130)}`);
      }
    }
  }
}
