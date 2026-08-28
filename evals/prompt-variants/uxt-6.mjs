/**
 * UXT-6 — break the three-question quota. Stacks ON TOP of UXT-5.
 *
 * `prompts.ts`'s "no more than three" reads as a floor, not a ceiling:
 * 94 of 97 question-bearing turns across all six eval runs asked exactly three,
 * with visible padding — one run asked about oil sheen in the coolant on three
 * consecutive turns, another re-asked a fact the operator had already picked
 * from an option list. Every padded question is a real trip and a real tap for
 * someone standing at a machine in the field.
 *
 * The wire protocol is untouched: `contract.ts` still slices at three, the
 * client still composes one combined reply, and `interview-machine.ts` already
 * renders one- and two-question turns. This is a value gate, not a format change.
 *
 * UXT-5's budget is included deliberately — the roadmap makes it the
 * prerequisite. Told "ask fewer questions" without a visible turn ceiling, the
 * model has every reason to spread the same questions over more rounds.
 */

import uxt5 from "./uxt-5.mjs";

const QUOTA_RULE_ORIGINAL = "- Ask no more than three concise questions at a time. Avoid repeating questions already answered.";

const QUOTA_RULE_REPLACEMENT = `- Three questions is a ceiling, not a target. One question is a complete turn when one question is what the evidence needs. Ask the single question that most separates your shortlist; add a second or third only if it is independently decisive and its value does not depend on how the first is answered. A question asked to fill out the turn is a question that costs an operator a walk to the machine and buys nothing.
- Never ask for something you already have, in any form: not from the reported problem, not from the machine context, not from an earlier answer, and not from an option the operator already chose. Asking the same fact a second time, in different words, reads as though the first answer was not heard.`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(`uxt-6 variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`);
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "UXT-6 — three is a ceiling (includes UXT-5's turn budget)",
  interviewSystem(base) {
    return replaceOnce(uxt5.interviewSystem(base), QUOTA_RULE_ORIGINAL, QUOTA_RULE_REPLACEMENT, "three-question quota rule");
  },
  turnBudgetLine: uxt5.turnBudgetLine,
};

export default variant;
