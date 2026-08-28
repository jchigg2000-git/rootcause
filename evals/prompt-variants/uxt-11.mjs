/**
 * UXT-11 — stop re-asking what intake already collected.
 *
 * Intake collects "operating conditions" and "recent repairs or maintenance",
 * and the form's own copy promises they "sharpen the report". `route.ts` passes
 * them through in the machine context. Yet 10/10 baseline runs asked a
 * recent-work or service-history question anyway — the operator types it once
 * and is asked it again a moment later.
 *
 * `prompts.ts`'s existing "avoid repeating questions already answered" scopes
 * only to interview answers; a filled machine-context field is invisible to it.
 *
 * ⚠ This arm needs scenarios carrying an `intake` block. Until they do, every
 * field reads "not provided" and the rule has nothing to bite on — the run
 * measures nothing. It is also not comparable to the frozen baseline, because
 * the operator is handing over evidence the baseline runs never had.
 */

const REPEAT_RULE_ORIGINAL = "- Ask no more than three concise questions at a time. Avoid repeating questions already answered.";

const REPEAT_RULE_REPLACEMENT = `- Ask no more than three concise questions at a time. Avoid repeating questions already answered.
- The machine context above is evidence the operator has already given you. A field there carrying a value has been answered, and asking for it again in general form ("has any recent work been done on it?") wastes a question and tells the operator you did not read what they wrote. A field reading "not provided" was genuinely not collected and is fair game.
- A filled field is a starting point, not a closed subject. Where it bears on your shortlist, ask the specific follow-up it invites — "you mentioned the filters were done last month; was the fuel filter one of them, or just oil and air?" — rather than either re-asking the general question or saying nothing. Silence on a filled field that matters is as much a miss as re-asking it.`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(`uxt-11 variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`);
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "UXT-11 — intake is already-collected evidence",
  interviewSystem(base) {
    return replaceOnce(base, REPEAT_RULE_ORIGINAL, REPEAT_RULE_REPLACEMENT, "avoid-repeating rule");
  },
};

export default variant;
