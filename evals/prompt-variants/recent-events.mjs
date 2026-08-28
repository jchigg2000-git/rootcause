/**
 * The recent-EVENTS fix — the best-evidenced prompt change in the corpus.
 *
 * ▶ PROMOTED TO PRODUCTION 2026-08-15. The replacement text below is now in
 * `app/api/diagnose/prompts.ts`, which means THIS VARIANT NOW THROWS when run —
 * its `replaceOnce` guard cannot find the original text because production no
 * longer contains it. That is the guard working, not a bug. The file is kept as
 * the record of what was changed and what it was measured against; to re-derive
 * the A/B, invert it (search for the NEW text, restore the OLD).
 *
 * `prompts.ts`'s coverage bullet lists "any recent work or change of any kind —
 * service, repairs, new attachments or installs, a new fuel or fluid source".
 * Every item on that list is a MAINTENANCE event, so the model reliably renders
 * it as "has any work been done recently?" — and an operator whose machine was
 * winched onto a trailer last week answers "No", honestly, because a tow is not
 * work.
 *
 * That is scenario 07's entire failure. Across 8 independent runs the interview
 * NEVER ONCE asked about towing, recovery or relocation, and 6 of the 8 runs
 * converged on the identical wrong answer (low hydrostatic charge pressure)
 * while the true cause — a tow/bypass valve left unseated after the move — was
 * never surfaced as a fact by any of them. The one arm that got it right
 * reached it by pattern-matching "sudden onset + both sides equally weak", not
 * by learning what happened.
 *
 * The 2026-08-07-03-50 scorecard spotted this exact failure and proposed this
 * exact one-line fix, then declined to apply it on single-run evidence:
 *   "If this recurs in future runs, the candidate one-line fix is extending the
 *    coverage bullet's recent-change list with 'transport, storage, or a change
 *    of jobsite or operator' — not applied now on single-run evidence."
 * It recurred. The evidence threshold that scorecard set is now met eight times
 * over, which is why this is a variant and not a note.
 *
 * Deliberately narrow: it adds event classes to one existing list. It does not
 * restructure the bullet, add a rule, or touch anything else — the failure was
 * a gap in coverage, not a discipline the model was ignoring. That distinction
 * matters, because the campaign's other finding is that this model does NOT
 * respond to being told a rule harder.
 */

const COVERAGE_ORIGINAL =
  "any recent work or change of any kind — service, repairs, new attachments or installs, a new fuel or fluid source — not only work on the suspect system";

const COVERAGE_REPLACEMENT =
  "any recent work or change of any kind — service, repairs, new attachments or installs, a new fuel or fluid source, and non-maintenance events too: the machine being towed, winched, recovered, transported or moved to a new site, coming out of storage, or a change of operator — not only work on the suspect system. Ask what happened around the machine before the problem started, not only what was done to it; an operator will answer \"no recent work\" truthfully about a week that included a trailer move";

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(`recent-events variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`);
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "recent-events — the coverage list includes non-maintenance events",
  interviewSystem(base) {
    return replaceOnce(base, COVERAGE_ORIGINAL, COVERAGE_REPLACEMENT, "coverage bullet's recent-change list");
  },
};

export default variant;
