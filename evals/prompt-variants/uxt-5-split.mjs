/**
 * ▶ PROMOTED TO PRODUCTION 2026-08-19 (the split's text won; see below).
 * `app/api/diagnose/prompts.ts` now carries the replacement, which means THIS
 * VARIANT NOW THROWS when run — its `replaceOnce` guard cannot find the
 * original text because production no longer contains it. That is the guard
 * working, not a bug. Kept as the record of what changed and what it was
 * measured against; to re-derive the A/B, invert it (find the NEW text,
 * restore the OLD).
 *
 * UXT-5-split — keep the verdict ban on the operator's text, give the model
 * somewhere else to put its reasoning.
 *
 * ▶ WHY THIS ARM EXISTS. Measured 2026-08-19 by scoring the two banked
 * `2026-08-15-uxt-5-amended` replicates, which had run but were never judged:
 *
 *   uxt-5 (verdict-shaped messages allowed)   pooled 18/20  — control's score
 *   uxt-5-amended (verdict claims banned)     pooled 14/20  — below the gate
 *   control                                   pooled 18/20
 *
 * Case 06 is a formally claimable per-case regression under README rule 2: it
 * fails in BOTH amended replicates and passes in BOTH control replicates. Both
 * amended arms rank "boom cylinder internal bypass" over the true boom-circuit
 * relief valve.
 *
 * The mechanism is not mysterious, and the roadmap predicted it before the
 * score existed. The ready message is the last thing the model says to itself
 * before the report call reads the transcript. The amendment deleted the
 * eliminative sentences ("that points away from a general pump problem") from
 * it — and with them, the eliminations the report was carrying forward.
 *
 * So the amendment removed the right thing from the wrong place. The operator
 * must not be handed a verdict the report may contradict; the MODEL should
 * still get to keep its own reasoning. This variant splits them: `message`
 * keeps the amended evidence-only ban, and a new `reasoning` field carries the
 * directional thinking into the transcript without ever being rendered.
 *
 * The field is real code (`InterviewResult.reasoning`, optional; carried by
 * `composeAssistantContent` behind a marker the bubble strips). It is INERT in
 * production, because production's prompt never asks for it — which is exactly
 * why the ask lives here, in a variant, rather than in `prompts.ts`.
 *
 * Reads as three replacements rather than one because the JSON shape block and
 * the ready rule are far apart in the prompt.
 */

const READY_RULE_ORIGINAL =
  "- Mark ready when the remaining plausible causes are separated as far as interview answers can separate them — when no further answerable question would change the ranking or materially raise its confidence. Ask the highest-value eliminations first and aim to finish within five turns.";

const READY_RULE_REPLACEMENT = `- Mark ready when the remaining plausible causes are separated as far as interview answers can separate them — when no further answerable question would change the ranking or materially raise its confidence. Ask the highest-value eliminations first.
- You have six turns at most. The machine context above tells you how many remain. Spend them on questions that eliminate, not on questions that confirm what you already believe. When one turn remains, say so plainly in your message and ask only what you most need — the report is written from whatever you have when the turns run out, and a question you never asked becomes a disclosed evidence gap rather than a wrong answer.
- When you mark ready, the message must name one thing the interview settled and one thing it could not, both in operator language — "you confirmed it cranks strong and only misbehaves cold, and nobody has measured the glow plugs, so that one stays open." "Ready to generate the report" tells the operator nothing about what was learned and nothing about what the report will hedge.
- That message reports EVIDENCE, never a verdict. Say what the operator told you and what nobody has checked. Do not say which cause it points to, points away from, rules out, or makes unlikely — the report decides that after weighing everything, and a message that announces a direction can contradict the ranking the report then produces.
- Put the directional thinking in "reasoning" instead, on every turn. That field is never shown to the operator and exists so the verdict ban above costs you nothing: name which of your shortlisted causes each answer moved, which you have eliminated and on what evidence, and which remain live. Write it for the technician who will read this transcript next, not for the operator.`;

const SHAPE_ORIGINAL = `{
  "status": "needs_more_information" | "ready",
  "message": "one short, plain-language sentence",
  "questions": [`;

const SHAPE_REPLACEMENT = `{
  "status": "needs_more_information" | "ready",
  "message": "one short, plain-language sentence",
  "reasoning": "your own differential reasoning — what each answer ruled in or out, and what stays live. Never shown to the operator.",
  "questions": [`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(
      `uxt-5-split variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`,
    );
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "UXT-5-split — verdict ban on the operator's message, reasoning kept in a hidden field",
  interviewSystem(base) {
    let next = replaceOnce(base, READY_RULE_ORIGINAL, READY_RULE_REPLACEMENT, "ready/turn-budget rule");
    next = replaceOnce(next, SHAPE_ORIGINAL, SHAPE_REPLACEMENT, "JSON shape block");
    return next;
  },
  // Must agree with the prompt above, or the model is told a ceiling it cannot
  // locate. Same as uxt-5 — the budget half is unchanged and unproven; this arm
  // is not testing it.
  turnBudgetLine(used, max) {
    const remaining = Math.max(0, max - used);
    return `Interview turns used: ${used} of ${max} (${remaining} remaining)`;
  },
};

export default variant;
