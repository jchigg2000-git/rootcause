/**
 * UXT-3 + UXT-4 — question discipline and interviewer restraint.
 *
 * Both edit `INTERVIEW_SYSTEM_PROMPT` and neither changes the wire protocol, so
 * they share one A/B arm. Measured against the control arm, not against the
 * frozen 2026-08-07-03-50 baseline (MAX_INTERVIEW_ROUNDS moved 5 -> 6 after it).
 *
 * UXT-3: `prompts.ts:10` already forbids bundled questions and is violated
 * routinely — >=6 compound questions across 6/10 baseline runs. A rule that is
 * stated once and never checked is advisory. This restates it as a pre-emit
 * check with the run that it cost us as the worked counter-example, and closes
 * the loophole the options list opened: chips that answer different facts are a
 * bundled question wearing a different hat.
 *
 * UXT-4: 7/10 baseline runs leak the model's private differential into the
 * pre-question `message`, in technician vocabulary, before the operator has
 * answered anything. An operator told the model is weighing "head gasket, oil
 * cooler, or cracked block" now knows which answers matter, which is exactly
 * the contamination the interview exists to avoid.
 */

const ONE_FACT_RULE_ORIGINAL =
  '- Ask about one fact or observation per question. Never bundle alternatives whose answers would differ into a single question joined by "or" — one answer to a bundled question is unusable as evidence.';

const ONE_FACT_RULE_REPLACEMENT = `- Ask about one fact or observation per question. Before you emit a question, read it back and ask yourself: could an operator answer this in one word and leave you unable to tell which half they answered? If so, split it into two questions.
- This is the failure to avoid, from a real run: the interview asked "have the glow plugs ever been replaced, or does the glow lamp come on normally?" and the operator answered "yes, works normally." That answer eliminated nothing — the service history and the lamp behaviour were both still unknown — and the true cause was ranked second as a result. Asked separately, each question would have been decisive. The trap is not the word "or": any two facts joined by "or", "and", or a comma collapse the same way.`;

const OPTIONS_RULE_ORIGINAL =
  '- Give each question a short "options" list when a small set of answers covers the likely responses — yes/no, a severity or frequency scale, or a short list of known conditions or components. Keep each option to one to three words. Leave "options" empty for anything that needs free text, such as a serial number, an exact reading, or an open description. Options are quick suggestions, never the only acceptable answer.';

const OPTIONS_RULE_REPLACEMENT = `- Give each question a short "options" list when a small set of answers covers the likely responses — yes/no, a severity or frequency scale, or a short list of known conditions or components. Keep each option to one to three words. Leave "options" empty for anything that needs free text, such as a serial number, an exact reading, or an open description. Options are quick suggestions, never the only acceptable answer.
- Every option in one question's list must answer the same fact. "Recently changed / Dirty-clogged / Not checked" is three different facts — a service history, a condition, and whether anyone looked — so whichever the operator picks, the other two stay unknown and the answer discriminates nothing. That is the bundled question again, wearing chips. If you need the service history and the condition, ask two questions.`;

const MESSAGE_RULE = `- The "message" is spoken to the operator, not to yourself. Say what you are trying to narrow down, in terms of the machine's behaviour as the operator experiences it. Do not name a cause, component, or system the operator has not already reported. Listing your shortlist — "whether this is a head gasket, an oil cooler, or a cracked block" — tells the operator which answers you are hoping for and changes what they report back to you, which is the one thing an interview cannot afford. The short "why" allowed on an individual question is unaffected: explaining that one question rules out a fuel restriction is fine; announcing the differential is not.`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(`uxt-3-4 variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`);
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "UXT-3+4 — one fact per question, and no narrated differential",
  interviewSystem(base) {
    let next = replaceOnce(base, ONE_FACT_RULE_ORIGINAL, ONE_FACT_RULE_REPLACEMENT, "one-fact rule");
    next = replaceOnce(next, OPTIONS_RULE_ORIGINAL, `${OPTIONS_RULE_REPLACEMENT}\n${MESSAGE_RULE}`, "options rule");
    return next;
  },
};

export default variant;
