/**
 * codes-weighted — tell the interviewer how to REASON from a fault code it
 * already has, rather than how to ask for one.
 *
 * Why this exists (2026-08-19). The intake form gained a `Fault codes` field
 * and the arm on `scenarios-codes-intake.json` proved the interview stops
 * asking for codes (`codesNeverRaised` 6/6 vs a control's 2/6 and 3/6). But
 * `INTERVIEW_SYSTEM_PROMPT` mentions codes exactly once, and only as a thing
 * to ASK about: "warning lamps or dash messages (ask separately from stored
 * fault codes), stored fault codes". Nothing in either prompt says what to do
 * with a code that is already in hand.
 *
 * Three specific silences this variant fills:
 *
 *   1. The shortlist instruction is symptom-only — "the most plausible causes
 *      of the reported symptoms on this machine". A supplied code should
 *      narrow that shortlist before question one.
 *   2. Nothing says a code names a CIRCUIT or an EFFECT, not a cause. SPN 157
 *      is "low rail pressure", SPN 102 is "low boost" — both truthful, both a
 *      symptom. The failure mode is the code making the model feel finished.
 *   3. Nothing says active-vs-stored changes the WEIGHT. The app enforces
 *      asking the distinction (`asksForCodeStatus`), but neither prompt says
 *      what to do with the answer. c3 is a stored eight-month-old code that
 *      must be discounted to background.
 *
 * ⚠ PRE-REGISTERED EXPECTATION: NO EFFECT. Measured on the 2026-08-19 intake
 * arm before this was written, the model already does all three unprompted —
 * 12 of 12 rank-1s on the effect-naming cases (c2, c5, c6) went behind the
 * code rather than restating it, and c3's stored code was classed as historic
 * background in both replicates. The standing precedent (UXT-3/4, UXT-6) is
 * that a prompt rule the model already follows buys nothing. This arm exists
 * to find out whether the gap is real or only legible.
 *
 * Touches the interview prompt only. The report prompt already carries "Never
 * invent ... fault-code meanings" and "Preserve fault codes, event history,
 * and freeze-frame data before clearing anything", and c4 showed both working
 * (2/2 refusals to invent a meaning for the proprietary E-1147).
 */

const SHORTLIST_ORIGINAL =
  "- Before each turn, privately shortlist the three to six most plausible causes of the reported symptoms on this machine. Choose each question to eliminate or confirm at least one of them. A question whose answer could not change the likely-cause ranking, its confidence, safety guidance, or the diagnostic order is not worth asking.";

const SHORTLIST_REPLACEMENT = `- Before each turn, privately shortlist the three to six most plausible causes of the reported symptoms on this machine, weighing any fault codes supplied in the machine context alongside those symptoms. Choose each question to eliminate or confirm at least one of them. A question whose answer could not change the likely-cause ranking, its confidence, safety guidance, or the diagnostic order is not worth asking.
- When the machine context already supplies fault codes, do not ask for them again, and reason from them like this:
  - A code names a circuit, a component, or a measured condition — it is not by itself a root cause. "Low fuel rail pressure" and "low boost pressure" are true readings that still leave the question of WHAT made that circuit read that way. Keep asking what would separate the causes behind the code; stopping at the code produces a confident report that names a symptom.
  - Weight an active code far above a stored one, and weight a stored code by its age and what was done at the time. A code logged months ago against a repair that has held since is background history, not evidence about today's complaint. Say which you are treating it as.
  - When a code's meaning is not one you can state with confidence — a manufacturer-proprietary code, or any code you would have to guess at — treat the meaning as an evidence gap and interview around it. Never guess what a code means in order to have a lead.
  - A code that does not fit the reported symptom is itself evidence: either the complaint has a second cause, or the code is incidental. Do not quietly drop it.
- Fault codes supplied at intake are the operator's transcription and may be partial, misread, or missing the active/stored distinction. Ask a clarifying question about a supplied code only when the answer would change your ranking — not to confirm what you were already told.`;

function replaceOnce(base, find, replacement, what) {
  if (!base.includes(find)) {
    throw new Error(
      `codes-weighted variant: could not find the ${what} to replace — prompts.ts has drifted, re-derive the variant`,
    );
  }
  return base.replace(find, replacement);
}

const variant = {
  label: "codes-weighted — how to reason from a code already in hand",
  interviewSystem(base) {
    return replaceOnce(base, SHORTLIST_ORIGINAL, SHORTLIST_REPLACEMENT, "shortlist rule");
  },
};

export default variant;
