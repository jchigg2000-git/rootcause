/**
 * ▶ SUPERSEDED 2026-08-19 by `uxt-5-split.mjs`, which was promoted to
 * production. This variant's own text was never shipped: the unamended form
 * produced verdict-shaped ready messages (6/10, one contradicting its own
 * report) and the amended form cost 4 pooled cases of ranking accuracy. The
 * split kept both halves.
 *
 * THIS VARIANT NOW THROWS when run — its `replaceOnce` guard cannot find the
 * original text because production no longer contains it. That is the guard
 * working, not a bug. Kept as the record of what was measured.
 *
 * UXT-5 — tell the model its budget; tell the operator why it stopped.
 *
 * The model is told "Interview turns already used: N" and never told the
 * ceiling, while `MAX_TRANSCRIPT_MESSAGES = 12` (~6 rounds) is enforced in
 * `contract.ts` and `prompts.ts`'s "aim to finish within five turns" is both
 * advisory and wrong by one. Opus runs hit forcedReport 2/10 without ever
 * converging — the model had no way to know it was running out.
 *
 * The second half is the operator's side of the same gap: ready messages were
 * content-free in 10/10 runs ("Ready to generate the report"), so the moment
 * the interview ends carries no information about what it established.
 *
 * ⚠ UXT-6 depends on this landing first — a "one question is a complete turn"
 * rule without a visible budget is an invitation to spend turns freely.
 */

const READY_RULE_ORIGINAL =
  "- Mark ready when the remaining plausible causes are separated as far as interview answers can separate them — when no further answerable question would change the ranking or materially raise its confidence. Ask the highest-value eliminations first and aim to finish within five turns.";

const READY_RULE_REPLACEMENT = `- Mark ready when the remaining plausible causes are separated as far as interview answers can separate them — when no further answerable question would change the ranking or materially raise its confidence. Ask the highest-value eliminations first.
- You have six turns at most. The machine context above tells you how many remain. Spend them on questions that eliminate, not on questions that confirm what you already believe. When one turn remains, say so plainly in your message and ask only what you most need — the report is written from whatever you have when the turns run out, and a question you never asked becomes a disclosed evidence gap rather than a wrong answer.
- When you mark ready, the message must name one thing the interview settled and one thing it could not, both in operator language — "you confirmed it cranks strong and only misbehaves cold, and nobody has measured the glow plugs, so that one stays open." "Ready to generate the report" tells the operator nothing about what was learned and nothing about what the report will hedge.
- That message reports EVIDENCE, never a verdict. Say what the operator told you and what nobody has checked. Do not say which cause it points to, points away from, rules out, or makes unlikely — the report decides that after weighing everything, and a message that announces a direction can contradict the ranking the report then produces.`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(`uxt-5 variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`);
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "UXT-5 — real turn budget, and a ready message with content",
  interviewSystem(base) {
    return replaceOnce(base, READY_RULE_ORIGINAL, READY_RULE_REPLACEMENT, "ready/turn-budget rule");
  },
  // The harness header must agree with the prompt, or the model is told a
  // ceiling it cannot locate. `max` comes from the harness's own round cap.
  turnBudgetLine(used, max) {
    const remaining = Math.max(0, max - used);
    return `Interview turns used: ${used} of ${max} (${remaining} remaining)`;
  },
};

export default variant;
