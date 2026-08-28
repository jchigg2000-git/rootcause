#!/usr/bin/env node
// Mechanical metrics over an eval run directory.
//
// Scoring this eval is judgment ("prose matching, done by reading" —
// evals/README.md), and it stays that way for anything about whether a question
// was decisive or a diagnosis was right. But several of the §20 UXT criteria are
// not judgment calls at all — questions per turn, rounds, forcedReport, whether
// a fact was asked twice — and counting those by reading ten transcripts is how
// a scorecard ends up with a number nobody can reproduce.
//
// So: this file computes what is countable and FLAGS what is not, leaving the
// judges a shortlist to rule on rather than a pile of transcripts to sift.
//
// ⚠ THE `shortlist-*` NUMBERS ARE NOT FINDINGS AND MUST NEVER BE QUOTED AS
// RATES. Measured 2026-08-15 against ten opus judges ruling case by case:
// `compound` fires 60-68 times per arm and resolves to 8-15 real; `mixedAxis`
// fires 25-35 and resolves to 4-6; `repeatAsk` UNDER-fires (it caught 1 of 3-4
// real re-asks in one arm). Both vocabulary heuristics also miss real
// violations, so the error runs in both directions. They are a reading queue.
//
// `offChipAnswers` is the exception and the one worth trusting: it fires on the
// operator answering off-chip with a comma, which happens precisely because the
// question asked two facts. On the control arm it fired 3 times and all 3 were
// violations the judges had independently confirmed.
//
//   node evals/interview-metrics.mjs evals/runs/2026-08-07-03-50
//   node evals/interview-metrics.mjs <dir> --json

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The SAME predicate the production parser enforces, imported
// rather than restated so this file can never drift from what ships.
import { asksForCodeStatus, raisesCodes, seeksExactValue } from "../app/api/diagnose/contract.ts";

const dir = process.argv[2];
const asJson = process.argv.includes("--json");
if (!dir) {
  console.error("usage: node evals/interview-metrics.mjs <run-dir> [--json]");
  process.exit(1);
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "you", "your", "it", "its",
  "and", "or", "of", "to", "in", "on", "at", "any", "have", "has", "had", "when", "what", "how",
  "if", "there", "that", "this", "with", "for", "be", "been", "from", "by", "as", "not", "no",
]);

const keyTerms = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );

/** Jaccard over content words. Two asks of the same fact reuse its vocabulary. */
function overlap(a, b) {
  const x = keyTerms(a);
  const y = keyTerms(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const term of x) if (y.has(term)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/**
 * UXT-3's target. Deliberately noisy: it catches "X, or Y?" and "X and Y?" and
 * any question with two clause-final question marks. A judge decides which are
 * real — a question can carry "or" innocently ("milky or foamy?" is one fact).
 */
function suspectCompound(text) {
  const t = String(text).toLowerCase();
  const reasons = [];
  if (/\bor\b/.test(t) && /[,;]/.test(t)) reasons.push("comma + or");
  else if (/\bor\b/.test(t)) reasons.push("or");
  if (/\band\b.*\?/.test(t) && /[,;]/.test(t)) reasons.push("comma + and");
  if ((t.match(/\?/g) ?? []).length > 1) reasons.push("two question marks");
  return reasons;
}

/**
 * UXT-3's second half: chips that answer different facts. A mixed-axis list is
 * hard to detect mechanically, so this flags the shape that produced the known
 * failure — options that share no vocabulary with each other at all.
 */
function suspectMixedAxis(options) {
  if (!Array.isArray(options) || options.length < 3) return false;
  const yesNoish = options.every((o) => /^(yes|no|not sure|unknown|n\/a|never|always|sometimes)/i.test(String(o).trim()));
  if (yesNoish) return false;
  let anyShared = false;
  for (let i = 0; i < options.length && !anyShared; i += 1) {
    for (let j = i + 1; j < options.length; j += 1) {
      if (overlap(options[i], options[j]) > 0) {
        anyShared = true;
        break;
      }
    }
  }
  return !anyShared;
}

/**
 * The best mixed-axis detector in the harness, and it was free: when a question
 * offers a single-select option list and the operator answers with a COMMA
 * ("Not recently, restriction warning light on" / "New (<1yr), Tested good"),
 * the chips could not hold the truth — because the question asked two facts.
 * Found by a judge reading transcripts, 2026-08-15; it catches cases the
 * vocabulary heuristics miss entirely.
 */
function suspectOffChipAnswer(question, answer) {
  if (!Array.isArray(question.options) || question.options.length === 0) return false;
  const text = String(answer ?? "").trim();
  if (!text.includes(",")) return false;
  // An answer that IS one of the chips is fine even if the chip has a comma.
  return !question.options.some((o) => String(o).trim().toLowerCase() === text.toLowerCase());
}

function analyse(artifact) {
  const rounds = artifact.interviewRounds ?? [];
  const questionTurns = rounds.filter((r) => (r.questions ?? []).length > 0);
  const perTurn = questionTurns.map((r) => r.questions.length);
  const allQuestions = [];
  const compoundFlags = [];
  const mixedAxisFlags = [];

  const offChipFlags = [];
  const valueAskWithChips = [];
  const valueAskHits = [];
  const codeStatusGaps = [];
  const codeStatusDrawn = [];
  const codeAskHits = [];
  rounds.forEach((round, roundIndex) => {
    (round.questions ?? []).forEach((q, qIndex) => {
      const at = `r${roundIndex + 1}q${qIndex + 1}`;
      allQuestions.push({ at, text: q.text, options: q.options ?? [] });
      const reasons = suspectCompound(q.text);
      if (reasons.length) compoundFlags.push({ at, text: q.text, reasons });
      if (suspectMixedAxis(q.options)) mixedAxisFlags.push({ at, text: q.text, options: q.options });
      const answer = (round.answers ?? [])[qIndex];
      if (suspectOffChipAnswer(q, answer)) {
        offChipFlags.push({ at, text: q.text, options: q.options ?? [], answer });
      }
      // Active-vs-stored. On a PRE-fix artifact this counts the gap: a code ask
      // that never asked whether the code is live. On a POST-fix artifact the
      // clause is already in the stored text, so `codeStatusDrawn` is the
      // regression pin and `codeStatusGaps` should read 0 by construction --
      // the same shape as valueAsksWithChips, and read the same way.
      // UI-7 (c): did the interview ask for codes AT ALL? Question text only --
      // an unpicked chip offering "Engine fault code" is not an ask, and that
      // undeclared choice is why the two banked hand counts disagree. Unlike the
      // two metrics below this is NOT a regression pin: nothing in the parser
      // forces it to a value, so it is a behavioural endpoint that can move.
      if (raisesCodes(q.text)) codeAskHits.push({ at, text: q.text });
      if (asksForCodeStatus(q.text)) codeStatusGaps.push({ at, text: q.text });
      else if (/\bcodes?\b/i.test(q.text)) codeStatusDrawn.push({ at, text: q.text });
      if (seeksExactValue(q.text)) {
        // Every hit is recorded, chipped or not. The chipped ones are the UI-7
        // (b) endpoint; the FULL list is how a false positive is caught after
        // someone widens the pattern list, and post-fix artifacts carry no
        // chips on a value ask at all, so counting only those would read 0 and
        // show nothing to check.
        valueAskHits.push({ at, text: q.text, options: q.options ?? [] });
        if ((q.options ?? []).length > 0) {
          valueAskWithChips.push({ at, text: q.text, options: q.options ?? [] });
        }
      }
    });
  });

  // UXT-6: a fact asked twice inside one interview. Compared across rounds only
  // — two questions in the SAME turn are a bundle, which is UXT-3's problem.
  const repeats = [];
  for (let i = 0; i < allQuestions.length; i += 1) {
    for (let j = i + 1; j < allQuestions.length; j += 1) {
      if (allQuestions[i].at.slice(0, 2) === allQuestions[j].at.slice(0, 2)) continue;
      const score = overlap(allQuestions[i].text, allQuestions[j].text);
      if (score >= 0.4) {
        repeats.push({ a: allQuestions[i], b: allQuestions[j], overlap: Number(score.toFixed(2)) });
      }
    }
  }

  const readyRound = rounds.find((r) => r.status === "ready");
  const preQuestionMessages = questionTurns.map((r, i) => ({ at: `r${i + 1}`, message: r.message ?? "" }));

  return {
    scenarioId: artifact.scenarioId,
    model: artifact.model,
    promptVariant: artifact.promptVariant ?? null,
    replayedFrom: artifact.replayedFrom ?? null,
    rounds: rounds.length,
    questionTurns: questionTurns.length,
    totalQuestions: perTurn.reduce((a, b) => a + b, 0),
    questionsPerTurn: perTurn,
    turnsAskingOneOrTwo: perTurn.filter((n) => n <= 2).length,
    turnsAskingThree: perTurn.filter((n) => n === 3).length,
    forcedReport: Boolean(artifact.forcedReport),
    reportParsed: artifact.reportParsed !== false,
    durationMs: artifact.durationMs ?? null,
    usage: artifact.usage ?? null,
    // Handed to the judges verbatim — these are the judgment calls.
    readyMessage: readyRound?.message ?? null,
    preQuestionMessages,
    suspectCompound: compoundFlags,
    suspectMixedAxisOptions: mixedAxisFlags,
    suspectOffChipAnswers: offChipFlags,
    valueAsksWithChips: valueAskWithChips,
    valueAsks: valueAskHits,
    codeStatusGaps,
    codeStatusDrawn,
    codesRaised: codeAskHits.length > 0,
    codeAsks: codeAskHits,
    suspectRepeatAsks: repeats,
    rankedTop3: (artifact.ranked ?? []).slice(0, 3).map((r) => ({
      rank: r.rank,
      problem: r.problem,
      likelihood: r.likelihood,
      confidence: r.confidence,
    })),
  };
}

const files = readdirSync(dir).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort();
const cases = files.map((f) => analyse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const allPerTurn = cases.flatMap((c) => c.questionsPerTurn);

const rollup = {
  runDir: dir,
  cases: cases.length,
  promptVariant: cases[0]?.promptVariant ?? null,
  model: cases[0]?.model ?? null,
  medianQuestionsPerCase: median(cases.map((c) => c.totalQuestions)),
  medianRoundsPerCase: median(cases.map((c) => c.rounds)),
  questionTurnsTotal: allPerTurn.length,
  turnsAskingThree: `${allPerTurn.filter((n) => n === 3).length}/${allPerTurn.length}`,
  turnsAskingOneOrTwo: `${allPerTurn.filter((n) => n <= 2).length}/${allPerTurn.length}`,
  pctTurnsOneOrTwo: allPerTurn.length ? `${Math.round((allPerTurn.filter((n) => n <= 2).length / allPerTurn.length) * 100)}%` : "n/a",
  forcedReport: `${cases.filter((c) => c.forcedReport).length}/${cases.length}`,
  reportParseFailures: `${cases.filter((c) => !c.reportParsed).length}/${cases.length}`,
  // ⚠ SHORTLIST SIZES, NOT FINDINGS. Measured 2026-08-15 against ten opus judges
  // ruling case by case: `compound` resolved 60-68 -> 8-15 real, `mixedAxis`
  // 25-35 -> 4-6, and BOTH missed real violations. Quoting these as counts
  // overstates every rate by ~5x. `offChip` is the one with a real hit rate.
  "shortlist-compound (≈15% real)": sum(cases.map((c) => c.suspectCompound.length)),
  "shortlist-mixedAxis (≈15% real)": sum(cases.map((c) => c.suspectMixedAxisOptions.length)),
  "shortlist-repeatAsk (under-fires)": sum(cases.map((c) => c.suspectRepeatAsks.length)),
  "offChipAnswers (high precision)": sum(cases.map((c) => c.suspectOffChipAnswers.length)),
  // The primary endpoint for the chip-strip change, and NOT a shortlist — it is the same
  // predicate the production parser enforces, so it is exact by construction.
  // Post-fix it must read 0 on any run made after the change; a non-zero value
  // means `parseInterview` was bypassed, not that the model misbehaved.
  // Its precision was checked before shipping: over the 1536 questions in every
  // banked run dir it fired 80 times with zero non-code false positives.
  "valueAsksWithChips (exact)": sum(cases.map((c) => c.valueAsksWithChips.length)),
  // Every question the predicate matched, chipped or not. Read this one (via
  // --json, which prints the question text) when auditing the pattern list for
  // false positives; read the line above for the UI-7 (b) endpoint.
  "valueAsks (predicate hits)": sum(cases.map((c) => c.valueAsks.length)),
  // Baseline over the 2026-08-15 code arms: the active-vs-stored distinction was
  // asked in 0/12 runs, and two reports asserted a status nobody established.
  "codeStatusGaps (code ask, status not asked)": sum(cases.map((c) => c.codeStatusGaps.length)),
  "codeMentions (not a status gap)": sum(cases.map((c) => c.codeStatusDrawn.length)),
  // ROADMAP §5 UI-7 (c): runs where the interview never asked for codes at all.
  // The ONLY code metric here that can actually move -- the two above are pinned
  // to 0 by the parser and are regression pins. Read `codeAsks` via --json to
  // audit the predicate; read this line for the endpoint.
  "codesNeverRaised (UI-7 c endpoint)": `${cases.filter((c) => !c.codesRaised).length}/${cases.length}`,
  totalTokens: cases.reduce(
    (acc, c) => ({
      input: acc.input + (c.usage?.input ?? c.usage?.inputTokens ?? 0),
      output: acc.output + (c.usage?.output ?? c.usage?.outputTokens ?? 0),
    }),
    { input: 0, output: 0 },
  ),
  wallClockMinutes: Number((sum(cases.map((c) => c.durationMs ?? 0)) / 60000).toFixed(1)),
};

if (asJson) {
  console.log(JSON.stringify({ rollup, cases }, null, 2));
} else {
  console.log(`\n=== ${dir} ===\n`);
  for (const [k, v] of Object.entries(rollup)) {
    console.log(`${k.padEnd(26)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  console.log("\nper case:");
  for (const c of cases) {
    console.log(
      `  ${c.scenarioId.slice(0, 24).padEnd(25)} rounds ${c.rounds}  q ${String(c.totalQuestions).padStart(2)} ${JSON.stringify(c.questionsPerTurn)}` +
        `  forced:${c.forcedReport ? "Y" : "n"}  codes:${c.codesRaised ? "Y" : "-"}  shortlist: cmp ${c.suspectCompound.length} axis ${c.suspectMixedAxisOptions.length} rpt ${c.suspectRepeatAsks.length} offchip ${c.suspectOffChipAnswers.length}  valuechips ${c.valueAsksWithChips.length}`,
    );
  }
}
