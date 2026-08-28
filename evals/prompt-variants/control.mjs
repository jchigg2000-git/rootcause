/**
 * control — the explicit no-op arm.
 *
 * `run-eval.mjs` defaults `--prompt-variant` to "control" so a run with no
 * flag still resolves a real module and every artifact still says which arm
 * produced it, instead of a bare run silently meaning "no variant" out of
 * band. Exporting no interviewSystem/reportSystem/turnBudgetLine means every
 * one of those falls through to the live prompt/context exactly as
 * `run-eval.mjs` builds it today — this file changes nothing about what gets
 * sent, only what the artifact calls it.
 */
const variant = {
  label: "control (live prompts)",
};

export default variant;
