# Interview-discrimination eval

Measures whether the diagnostic interview asks the questions that *discriminate*
between look-alike root causes — not whether the report reads well. Ten scenarios,
each with one hidden true cause whose surface symptoms overlap 3+ plausible
alternatives; only the right interview question separates them.

## A note on the shorthand, and on run directories

Two things in this document will otherwise read as references to something you
cannot see.

**`UI-*` and `UXT-*` are local shorthand for experiments**, not links to another
file. The ones that appear below:

- **UI-7** — whether the interview asks the operator to *read fault codes off the
  machine*, and whether the chips it offers can hold the answer. Its parts: (a) a
  code ask must not carry chips, (b) a prompt-only rule does not bind, (c) some
  runs never ask for codes at all.
- **UXT-1 … UXT-12** — report-layout and interview usability experiments, scored
  offline by `measure-report.mjs`: shortlist prominence, safety-item ordering,
  sort direction, the mobile jump menu, and so on. The `prompt-variants/uxt-*.mjs`
  files are the prompt arms for these.

**`evals/runs/` is not in this repository.** Run output is a local artifact: it is
large, it is specific to the account that paid for it, and it is not something a
reader can meaningfully diff against their own. Every run directory named in this
document is one the maintainer produced; the scenarios, the harness and the
scoring code all ship, so you can regenerate equivalents. Anything below that
reads a banked directory expects one you generated yourself.

## Files

- `scenarios.json` — the ground truth, written **before** any run. Per scenario:
  the machine, the operator's surface complaint, the true root cause, each
  alternative with its discriminating evidence, and the category of that
  discriminator (fluid-condition, service-history, fault-codes, …). The
  operator simulator's private fact sheet lives here too.
  **v2 (current, 2026-08-06):** common everyday complaints whose 3 very different
  diagnoses hinge on one or two clean variables, and deliberately no obscure
  single-cause puzzles. `scenarios-v1.json` is the retired first set; runs
  `2026-08-07-02-47` (baseline prompts) and `2026-08-07-03-38` (redesigned
  prompts, A/B) used v1 and stay comparable only to each other.

  **Optional `intake` block, per scenario:**
  ```json
  {
    "id": "...",
    "machine": { "...": "..." },
    "intake": {
      "serialPin": "string, optional",
      "market": "string, optional",
      "operatingConditions": "string, optional",
      "recentWork": "string, optional",
      "faultCodes": "string, optional"
    }
  }
  ```
  Maps 1:1 onto the real intake form's fields (`route.ts`'s
  `equipment.{serialPin,market,operatingConditions,recentWork,faultCodes}`) and rides into
  `machineContext()` the same way. **`faultCodes` was added 2026-08-19** with the intake field
  that closed UI-7 (c). Every banked run predates it and reads "not provided", so the whole
  existing corpus stays comparable; the only file that sets the key is
  `scenarios-codes-intake.json`, built to measure it and **not yet run**. Per rule 3 that arm
  needs a same-day matched control on `scenarios-codes.json` v2, where the key is absent.

  **Every key is optional, and so is the block itself.** A scenario with no `intake` — every scenario as of this writing —
  builds the same "not provided" lines it always has; only a scenario that adds
  the block changes what the model is told. Use it to test whether the
  interview stops re-asking what intake already answered (see
  `prompt-variants/uxt-11.mjs` for exactly that hypothesis, which needs
  intake-bearing scenarios to measure anything at all).
- `scenarios-codes.json` — the code-bearing set (**v2, revised 2026-08-19**; `scenarios-codes-v1.json`
  is the frozen first set). Same shape as above plus
  two fields the harness ignores and the scorer does not: `shape` (which of the five
  code shapes the scenario tests) and `preRegistered` (the correct rank 1, the names that
  also count, the names scored wrong, and the behavioural checks) — written before the first
  run. Selected with `--scenarios`. See "The code-bearing quadrant" below.
- `scenarios-codes-v4.json` — **v4, 2026-08-20. The one to use for any new arm.** Repairs exactly one
  scenario, **c9**, and touches nothing else: c1–c8 and c10–c20 are **byte-identical** to v3, so every
  banked v3 arm stays comparable on those nineteen. **Only c9 goes non-comparable — 61 banked runs.**
  **Why:** the 2026-08-20 triage found c9 BROKEN on two counts. 50 of its 61 rank-1 answers named a
  cold- and condensation-affected boost/MAP **sensor** and 5 more named a charge-air leak, and
  **neither appeared anywhere in its `preRegistered` block** — so no discriminator had ever been
  written to argue either down, and the judge was scoring an answer the pre-registration never
  anticipated. 92% of answers fell in that gap; the four alternatives that *were* written were chosen
  a combined **1 time in 61**. That is the c4 "missing fourth alternative" defect again. Meanwhile its
  only discriminator — the turbo actuator rod stiff by hand when cold — was delivered in **0 of 61**
  runs.
  **The repair is keyed to questions the banked interviews measurably DO ask**, which is the part
  worth copying: a **moisture-independence** fact (damp/fog/frost is asked in **56%** of c9 runs, and
  the sheet had *no answer for it*, so the Haiku operator improvised one) and a **recovery time that
  scales with how cold it is** (asked in 51%). Together they read as a mechanism warming through
  rather than a contact making up, which is what argues down the condensation story the modal answer
  rests on. The rod fact is kept and additionally voiced as something the dealer's tech observed, so
  it can also land on the 15% of interviews that ask what the dealer did. Two alternatives and two
  scored-wrong entries added.
  ⚠ **c3 and c13 were triaged at the same time and deliberately NOT touched** — c13 is hard and c3 is
  an instrument leak, not a scenario defect. Editing either would destroy a good case.
- `scenarios-codes-v4-intake.json` — **v3, 2026-08-20.** The intake twin of v4, same one-scenario
  repair, c9's v3 intake string kept verbatim. Twin of `scenarios-codes-v3-intake.json` otherwise.
- `scenarios-codes-v3.json` — **v3, 2026-08-19. FROZEN 2026-08-20, superseded by v4 above.** The
  code-bearing set widened from 6 to 20. `c1..c6` are **byte-identical** to v2, so every banked v2 arm stays
  comparable on them; `c7..c20` are new.
  **Why it exists:** v2's *effective* n was **2**. Across the six runs of the 2026-08-19 campaign,
  c1, c2, c4 and c6 were correct **6/6 every time** — a case every arm gets right carries no
  information about which arm is better. Only c3 and c5 ever moved. Widening the set is only useful
  if the new cases sit in the band where an arm can move them, which is what c7–c20 were written
  for: a code cascade with one electrical cause, a code that contradicts the symptom because the
  sensor is lying (the deliberate inverse of c6, where it told the truth), codes cleared before
  anyone diagnosed, a service reminder that is not a fault at all, a generic derate code that names
  no component, a wrong fluid added at service, a real fault beside an unrelated code, a code that
  only appears on a slope, a right-circuit-wrong-part after a failed repair, an aftermarket
  parasitic drain, an attachment-interface fault, and a dead display that hides the codes.
  ⚠ **c19 and c20 are deliberate BALANCE cases where the ordinary cheap answer is correct.** All six
  of v2's cases had non-obvious answers, which rewards distrusting the obvious reading; a set that
  never rewards the boring answer measures the wrong thing. A model that has learned to reach past
  the simple explanation will fail these two, and that failure is a **finding, not a scenario
  defect** — do not "fix" them by making the answer exotic.
- `scenarios-codes-v3-intake.json` — **v2, 2026-08-19. FROZEN 2026-08-20, superseded by
  `scenarios-codes-v4-intake.json`.** The twenty-scenario twin with codes handed
  over at intake, generated mechanically from `scenarios-codes-v3.json` the same way v1 was from v2.
  `c1..c6` reuse the v1 intake strings verbatim, so the four banked arms stay comparable on them.
- `scenarios-codes-intake.json` — **v1, 2026-08-19.** The same six code-bearing scenarios with
  the codes handed over on the **intake form** (`intake.faultCodes`) instead of held back for the
  interview to extract. Derived mechanically from `scenarios-codes.json` v2: every field is
  byte-identical except that each scenario's code-**status** `hiddenFacts` are deleted and
  re-voiced in the operator's words as the one intake key. No other intake key is set — not even
  `serialPin` — so the code's presence at intake is the only variable against a v2 control.
  ⚠ **It deliberately breaks `scenarios-intake.json` v4's decontamination rule**, because on c1,
  c5 and c6 the code *is* operative and handing it over is the hypothesis rather than a leak. What
  it still never carries is a code's **interpretation** or any **non-code** fact — the split
  charge-air hose, the clay-packed track, the DEF crystals, the cancelled regens and the disturbed
  pump connector all stay ask-only. Its `knownEffects` field names, per case, what got easier by
  construction; read it before scoring, and note **c3's red-herring shape is only half-tested**
  here (the intake string carries the stale code's provenance, which is nearly the discriminator
  itself). The instrument for the owed intake-field arm; **no run against it exists yet.**
> # ⛔ FREEZE BREAK — 2026-08-20. THE OPERATOR NOW GOES AND LOOKS.
>
> **No run from 2026-08-20 onward is comparable to any banked run** unless it passes
> `--sim-legacy-shrug`. Every artifact records `simPersona` (`"mechanic"` | `"legacy-shrug"`);
> check it before comparing anything to anything.
>
> **What changed and why.** The operator simulator was told *"you are not mechanically
> sophisticated"* and, decisively, *"if none of your facts answer the question, say you don't know
> or haven't checked."* That single line killed every **directed-inspection** question unless the
> scenario author had pre-written that exact observation into `hiddenFacts`. Measured across the
> whole banked corpus: **717 of 5,337 questions — 13.4% — died on a shrug.** The most-shrugged
> shapes were *"are the battery terminals clean and tight?"*, *"does the preheat light go out
> normally?"*, *"does it pull right in reverse too?"*, *"any water in the filter bowl?"* — each one
> a check a diesel mechanic does without thinking.
>
> **That measured a user who does not exist.** This product is for mechanics who will walk to the
> machine. An instrument that refuses inspection requests penalises the most valuable interview
> behaviour there is, and it produced two false findings before anyone noticed:
> - **Opus's higher question count read as waste.** 20% shrugged vs Sonnet's 12% — recorded as
>   Opus burning questions. It was Opus asking for *inspections* and being refused. See
>   `runs/2026-08-07-04-34/OPUS-VS-SONNET-QUESTION-QUALITY.md`.
> - **c9's discriminator was scored "unreachable" at 0/61.** It was unreachable *to a shrugger*.
>   The v4 repair's other half — 92% of rank-1 answers naming a cause absent from the whole
>   `preRegistered` block — is persona-independent and still stands.
>
> **The new operator** is a competent owner-operator with hand tools, a multimeter and a
> flashlight, standing at the machine. Asked to check, look at, measure, listen for or try
> something, **he does it and reports what he finds.** He is given `trueRootCause` as ground truth
> he *does not know*, so derived findings are correct rather than invented — the 2026-08-07
> scorecard had already caught the old sim improvising off-sheet observations on case 07. He may
> only refuse when the check genuinely needs teardown, a dealer scan tool, a pressure kit or a
> bench test, and he must say which.
>
> ⚠ **What did NOT change, and must not: he never volunteers.** That rule is the entire
> discrimination test. An operator who offers facts unasked measures nothing.
>
> ⚠ **Scenario authoring changes with it.** `hiddenFacts` is no longer the only reachable evidence,
> so a discriminator no longer has to be pre-voiced as something the operator already noticed. Write
> the fact the operator would *already know*; let the inspection findings derive.

- `run-eval.mjs` — the harness. Imports the live prompts/schemas/parsers from
  `app/api/diagnose/` and mirrors the wire call `providers.ts` makes (marked
  `MIRROR` where route internals aren't exported). Bypasses the HTTP route on
  purpose: no auth, no eval junk in the case library or machine inventory.
  A Haiku operator answers only what's asked, honestly, never volunteering.
- `runs/<stamp>/run-<id>.json` — one artifact per scenario: full interview
  rounds, wire transcript, the report's ranked list, token usage.
- `runs/<stamp>/scorecard.md` — the scored comparison against ground truth.

## Rerun after a prompt change

```sh
node evals/run-eval.mjs              # all 10, ~20-30 min, bills the Anthropic key
node evals/run-eval.mjs --only 03,07 # subset
```

Then score the new `runs/<stamp>/` against `scenarios.json` the same way as the
previous scorecard (per run: true cause ranked #1 / present / missed; per
alternative: was its discriminator surfaced by an interview question, answered
incidentally, or never surfaced) and diff the two scorecards. Keep `scenarios.json`
frozen between comparisons — changing scenarios and prompts at once measures nothing.

Scoring is judgment (prose matching), done by reading, not automated.

## ⚠ Accuracy cannot compare two prompts on this set. Measured 2026-08-15.

Nine arms were run to test the UXT prompt experiments, each scored by two
independent judges. The governing result is about the **instrument**, not any arm:

- `control` scored **10/10**. `control-2`, the **identical prompt** re-run, scored
  **8/10**.
- `uxt-5` scored 8/10; `uxt-5-rep` scored ~10/10 — on the same two cases, opposite way.
- **Cases 01, 06 and 07 are demonstrated coin-flips.** Case 01 flipped three times
  across the campaign, including once under control on the intake set.

Pooled control is 18/20 ≈ 0.9/case, so the 95% band on a single-run comparison is
**±2.6 cases before** correcting for multiple arms. Consequences, binding:

1. **A single-run accuracy delta of ≤2 cases is noise. A finding needs ≥4.** Two arms
   were declared "hard gate failed" on 6/10 and 7/10 before this was understood; both
   verdicts were later vacated.
2. **Run every arm twice.** Ship requires **pooled ≥15/20**. Claim a per-case
   regression only when the case fails in **both** arm replicates *and* passes in
   **both** control replicates.
3. **An arm on a different scenario file needs a same-day matched control on that same
   file.** UXT-11's headline result — "0 general re-asks vs a 10/10 baseline" —
   evaporated when the matched control produced the same behaviour without the prompt
   rule. The old baseline had measured scenarios with *no* intake block, where every
   field read "not provided" and asking is correct.
4. **The behavioural criterion is the primary endpoint.** This instrument resolves
   behaviour cleanly (UXT-5's ready messages: 10/10 vs 0/10, p < 10⁻⁴). It cannot
   resolve accuracy at all.
5. **Write down the adjacent-component matching rule before scoring.** "Holding valve"
   vs "relief valve" was scored both ways in the same campaign; until that is in the
   rubric every total carries ±1 of silent slack.
6. **Give the judges the replicate data.** All four judges on the two vacated arms
   issued accuracy verdicts they could not have issued with it in hand.

**One arm has since cleared these rules rather than tripped over them.** `uxt-5-split`
(2026-08-19) scored **19/20 pooled** and repaired case 06 — wrong in *both* replicates of the
arm it replaced, right in *both* of its own, with control right in both. That is rule 2's bar
met in the improving direction, and it is the only per-case causal claim this campaign has
earned besides the original chip ablation. See `runs/2026-08-19-uxt-5-split/scorecard.md`.

## ⚠ SCORE ARMS ON DISCORDANT CASES, NOT ON POOLED TOTALS. Established 2026-08-19.

Every arm comparison in this repo has been scored by comparing pooled totals — "arm 11/12 vs
control 10/12". That throws away the design. The arms run the **same scenarios**, so the comparison
is **paired**, and a paired comparison carries information only in the cases where the two arms
**disagree**.

The 2026-08-19 campaign made the cost of ignoring this concrete: six runs over six scenarios, and
**four of the six cases were correct in every single run.** c1, c2, c4 and c6 contributed nothing
to any comparison; the entire campaign turned on c3 and c5. Reporting "10/12 vs 11/12" implies
twelve observations of evidence. There were two.

Binding from here:

1. **Report the discordant count next to any arm claim** — how many cases one arm got right and the
   other wrong, in each direction. If that number is under about ten, say plainly that the
   comparison cannot resolve anything.
2. **Run a DIFFICULTY SCREEN before spending on arms.** Two control replicates on the scenario file,
   scored per case. A case at 2/2 or 0/2 across both control replicates is **ballast for arm
   comparison**, however good a scenario it is on its own. Spend the arm budget on the cases that
   sit in between.
3. **Unpaired totals need numbers this instrument will never have.** At p≈0.85 the 95% band on a
   *difference* between two arms is ±28.6pp at 12 cases per arm, ±15.6pp at 40, and still ±9pp at
   120. Chasing a five-point effect by growing the set is not a plan; pairing and screening is.

⚠ **NEVER SCORE A c3 RANK-1 MISS WITHOUT READING THE OPERATOR'S TENSION ANSWER FIRST.** Measured
2026-08-19 on the intake arm: the interview offered
`["Same both sides", "Right looser", "Left looser", "Haven't checked"]`, ground truth is that the
**right** track has no slack and the left gives two inches — so the correct chip, **"Left
looser"**, was on the list — and the Haiku operator picked **"Right looser."** The model then
reasoned correctly from a false premise and ranked *low* tension, which scores as a rank-1 miss
that has nothing to do with the arm under test.

This is **not** the UI-7 c3 failure shape. There the true state was *absent* from the option set
and the operator took the nearest chip. Here it was *present* and the simulator inverted it. The
v2 revision de-inverted c3's **tell**; it did not make the simulator immune to inverting its
**answer**, and those are different problems. In the same campaign, a control replicate answered
the same question class correctly in free text (*"Right track has no slack and is packed solid
with dried clay; left track gives a couple inches"*), consistent with the measured 96%
chip-verbatim rate being the mechanism. Any arm can catch this; c3 is the case that shows it.

**Quantified 2026-08-20 over 75 banked c3 runs** — `runs/2026-08-19-settle-triage/TRIAGE-c3-c9-c13.md`.
All 75 asked a tension question. Rank-1 accuracy was **78% (21/27) when the abnormality actually
reached the model** and **3% (1/32) when it did not**, so c3's headline score is mostly a measurement
of whether a directional fact survived a single-select, not of difficulty. There are **two** leaks,
and only the first is the inversion above:

- **17 runs, 0 correct — the simulator inverted it.** In most of them the correct chip *was on the
  list* and it picked `Right looser` regardless.
- **15 runs, 1 correct — the simulator answered TRUTHFULLY and the answer misled.** A question shaped
  *"which track is looser?"* has an honest answer — "Left" — that presupposes looser = faulty, and
  the model goes on to diagnose a slack left track. **De-inverting a fact cannot fix this**; the fact
  is already de-inverted. Watch for it on any scenario whose abnormality is the *tight*, *high* or
  *full* side of a relative comparison.

`--sim-free-text` is the built-for-purpose control here and **no banked run uses it** — every
artifact in `runs/` is `simFreeText: false`. A c3-only free-text arm should predict ≈78%.

⚠ **c9 WAS BROKEN and is REPAIRED in `scenarios-codes-v4.json` (2026-08-20). Do not run it from v3.** Same file. Over 61 banked
runs, **56 rank-1 answers (92%) name a cause that appears nowhere in its `preRegistered` block** — a
cold-affected boost/MAP **sensor**, which is not the correct cause, not an accepted phrasing, and not
on the scored-wrong list, so no discriminator was ever written to argue it down. This is the c4
"missing fourth alternative" defect again, at 92% incidence. Its only written discriminator (the turbo
actuator rod stiff by hand when cold) was delivered in **0 of 61** runs. c13, measured the same way,
is the opposite call: **hard, and the best case in the file** — its discriminator works when asked,
it was asked in 2 of 59 runs, and the true cause waits at rank 2–3 in 81% of them.

⚠ **A case can be at the floor on rank-1 and at the CEILING on the endpoint that resolves.** c3, c9
and c13 pass their report-side behavioural criteria at 92%, 100% and 100% over those same 195 runs.
Rule 4 makes behaviour the primary endpoint; screening a set on rank-1 alone (rule 2 above) will
therefore keep cases that carry no behavioural information. Screen on both.

⚠ **The written-down adjacent-component rule rule 5 asks for now exists**, in
`runs/2026-08-15-uxt-5-amended/scorecard.md`: a rank-1 counts when it names the true failed
component, or a directly adjacent member of the same valve/circuit group performing the same
function. Applied blind it reproduces all four previously-judged 2026-08-15 arms exactly. Use
it rather than inventing a sixth reading of "holding valve vs relief valve".

`scenarios-intake.json` carries the same freeze discipline as `scenarios.json`, and was
**decontaminated at v4** (2026-08-15): an intake string may set up a specific follow-up
but must never contain the operative clause of `trueRootCause` or of any alternative's
`discriminator`. Cases 05 and 10 violated that and were rewritten, their tells moved
back into `hiddenFacts`. **Runs before v4 are not comparable to runs after it.**

## v2 of the code-bearing set — revised 2026-08-19

⚠ **Runs against v1 are NOT comparable to runs against v2**, the same discipline
`scenarios-intake.json` v4 carries. The six banked arms (`codes-1`, `-2`, `-ablation`,
`-ablation-rep`, `codes-postfix`, `-rep`) are all v1. Frozen at `evals/scenarios-codes-v1.json`;
per README rule 3, **the next arm on this file needs a same-day matched control on v2.**

c1, c2 and c6 are untouched. Three scenarios changed, each repairing a defect the arms exposed
rather than raising difficulty:

- **c3 — the tell is de-invertible, and the code is now visible.** The Haiku operator conflated
  "the side with the problem" with "the loose one" and answered `Right loose` against a fact sheet
  saying the right track is *tighter*; both reports then reasoned correctly from a false premise
  and advised tightening an already over-tight track. The fact now reads *"the right track has no
  slack in it at all — you cannot push it down by hand, where the left one gives a couple of
  inches"*, which has no inverted form. Separately, c3's declared shape is `stale-red-herring-code`
  and the code was raised in only **1 of 4** arms, so the trap never sprang and the scenario tested
  nothing it was written to test — the complaint now mentions a code sitting in the monitor's list,
  the way c4's does. Its `preRegistered.behavioural` gains the matching check.
- **c4 — the missing fourth alternative.** *"Air trapped or ingested at the repaired hydraulic
  hose"* is what **both** pre-fix arms actually ranked #1, and it was absent from `alternatives`,
  so no discriminator had ever been written to eliminate it. Added with the vibration correlation
  as its discriminator. The v1 scoring stands; this stops the same answer being scored wrong with
  nothing in the instrument to argue it down.
- **c5 — the same inversion, the same fix.** Arm 1 answered *"Yes, looks clean"* against a sheet
  holding white crystalline deposits. Both inversions land on questions bundling "did you check"
  with "what did you find" into one single-select, so the fact now answers the check and the
  finding separately. **c5's code stays hidden** — it is the UI-7 (c) probe, the only case that is
  0/4 on raising codes.

## The code-bearing quadrant — MEASURED 2026-08-15

`scenarios.json` and `scenarios-intake.json` are **code-less by design** — every fact sheet
says "codes not read" or "none shown" — so they measure symptom-only discrimination, the hard
mode. Code-bearing scenarios were deferred on 2026-08-06 because the no-code
result was the point.

**`scenarios-codes.json` (v1, frozen 2026-08-15) closes that gap**: 6 scenarios across five
shapes — code nails it · code is a symptom of a deeper cause (×2) · stale red-herring code ·
a code whose meaning the model must not invent · rare-but-clean path. Each carries a
`preRegistered` block — correct rank 1, the adjacent names that also count, the ones scored
wrong, and per-scenario behavioural checks — **written before any run**, which is what closes
the ±1 scoring slack rule 5 below is about. Same conventions as the frozen baseline (no
`intake` block, serial in `hiddenFacts`), so the only new variable is the presence of codes.

Two replicates of the production configuration ran against it the same day
(`runs/2026-08-15-codes-1`, `-2`); the joint scorecard is in the first. Headlines:

- **Never inventing a fault-code meaning holds under direct pressure — 2/2 on the
  undocumented code, and no report anywhere cites a code the operator did not supply.** Three
  real J1939 codes were decoded correctly.
- **The interview obtains the code in only 6/12 runs** — and asking for it verbatim and getting
  it are the same event, 6/6 in both directions. 4/12 never raised codes at all; 2/12 asked a
  categorical dash question instead of a verbatim one.
- **A chip set that omits the true state produces a factually wrong answer.** Proven by the
  `--sim-free-text` ablation (`runs/2026-08-15-codes-ablation`, `-rep`): same app, chips hidden
  from the operator only, and c3 + c4 flip from wrong in both chip replicates to right in both
  free-text replicates (pooled 8/12 → 11/12). Read the scorecard's ablation section for what that
  does **not** prove — the free-text operator also volunteers more, so 11/12 is a ceiling.

### Acted on 2026-08-15 — and the confound that governs measuring it

Two changes shipped off that finding: every chip set now carries a "None of these — type it"
escape, and `parseInterview` strips `options` from any question asking for a code / serial / PIN /
part number / metered reading. Decided 2026-08-15.

- `interview-metrics.mjs` reports **`valueAsksWithChips`**, computed from `seeksExactValue()` —
  the *same* predicate the production parser enforces, imported rather than restated. Pre-fix it
  reads **2 and 4 on the two code replicates**. Post-fix it reads **0 by construction**: it is a
  regression pin proving the parser fired, **not** a result.
- ⚠ **An arm measuring (b) needs a `--sim-free-text` matched control.** Stripping chips inside the
  app is exactly the "improves by construction" case the ablation flag exists to partition — see
  the comment at `run-eval.mjs:333-341`. Codes-obtained will rise on the simulator whether or not a
  real operator would benefit; the unknown that converts it is how often a real operator taps a chip
  that does not fit, which only the stored `diagnostic_case` transcripts can answer.
- The predicate's precision was checked over **all 1536 questions in the 24 banked run dirs**: 80
  hits, zero non-code false positives. **Re-run that audit after any edit to the pattern list** —
  it costs nothing and it already killed one bad draft pattern (matching the bare verb "gauge
  reads" caught *"does the coolant temperature gauge read higher than normal?"*, a yes/no whose
  chips are correct). The audit is `valueAsks` — every question the predicate matched, chipped or
  not — read with the question text via `--json`:

  ```sh
  for d in evals/runs/*/; do node evals/interview-metrics.mjs "$d" --json; done \
    | jq -r '.cases[].valueAsks[] | .text'
  ```

  Read `valueAsks` when auditing the patterns; read `valueAsksWithChips` for the UI-7 (b) endpoint.
- **Active vs stored was asked in 0/12 runs**, and two reports asserted a status they never
  established. **Acted on 2026-08-19:** `asksForCodeStatus()` appends the distinction to a code
  ask in the same parser seam, and the post-fix arms
  (`runs/2026-08-19-codes-postfix`, `-rep`) establish it in **5/12**. `codeStatusGaps` reads 0
  post-fix **by construction** — a regression pin, not a result, exactly like
  `valueAsksWithChips`. Read that scorecard before citing any of it; codes-obtained moved 6/12 →
  7/12, which is noise, and the 4/12-never-ask gap (UI-7 c) is untouched.
- Ranking the root cause over the coded component: 4/4. Pooled accuracy 8/12, with one miss
  genuine and one confounded by an operator-simulator inversion — read the scorecard before
  citing either.

⚠ **c3 is known-broken as an instrument** (the simulator inverted its own fact sheet on a chip
question) and c4's alternative list is missing a plausible cause the model actually chose. Both
are documented in the scorecard. Fixing either makes that scenario non-comparable to this run,
so a fix is a v2 with the change recorded, not a quiet edit. **Done 2026-08-19 — see "v2" below.**

## UI-7 (c) has a mechanical endpoint now, and the blind spot is general — 2026-08-19

`codesRaised` / `codeAsks` in `interview-metrics.mjs`, from a new `raisesCodes()` predicate
imported live from `contract.ts` alongside `seeksExactValue` and `asksForCodeStatus`. It reads
**question text only** — an unpicked chip offering "Engine fault code" is not an ask. That
undeclared choice is why the banked hand counts do not reproduce: they read **4/12 pre** and
**5/12 post**, the mechanical count reads **5/12 pre** and **4/12 post**, transposed. Unlike
`valueAsksWithChips` and `codeStatusGaps` this one is **not** a regression pin — nothing in the
parser forces it to a value, so it is a behavioural endpoint that can actually move.

**Re-derived over all 256 case-runs in the 28 banked run dirs, free:**

| | never raise codes |
|---|---|
| code-BEARING set (`scenarios-codes.json`, 4 production arms) | **12/36 — 33%** |
| code-LESS sets (`scenarios.json`, `-intake`) | **164/220 — 75%** |
| **all banked runs** | **176/256 — 69%** |

The code-less scenarios say "codes not read" by design, so not asking is not a *wrong* answer
there — but the interview never *establishes* it, and a real machine's code state is unknown
until somebody asks. **UI-7 (c) is a general property of the interview, not a codes-set artifact.**

⚠ **`runs/2026-08-19-codes-postfix/scorecard.md` said "c5 and c6 raise no codes in any of the
four arms." c6 raised them in 2 of 4** — see that scorecard's appended
correction. **c5 is the only case that is 0/4.**

### Pricing the round-1 fix, before building it

A deterministic round-1 code question is the obvious candidate, but it lengthens
every interview. Both halves are now measured off banked data, with no model spend:

- **When the interview asks for codes it asks in round 1** — 59 of the 80 runs that ever ask,
  then 13 / 6 / 2 in rounds 2-4. It does not defer codes; it either reaches for them immediately
  or never. **A round-2+ nudge would buy almost nothing.**
- **Only 23% of round-1 turns already contain a code ask**, so the injected question is genuinely
  new 77% of the time.
- ⚠ **Every round-1 turn already carries the maximum 3 questions — 256 of 256.** Across all turns
  the split is 551 × 3, 49 × 2, 13 × 1. `parseInterview` slices at 3, so **there is no free slot
  in round 1, ever**: an injected question must displace a model-chosen discriminating question or
  widen the turn past the stated cap. That is the real price, and it is not the "it makes
  interviews longer" cost originally anticipated.

### A shipped predicate was under-firing, and the fix's own target shape leaked

Found while auditing the above. `CODE_REQUEST_PATTERNS` used **whole-word verbs**, so `\bpull\b`
did not match "pulled" and `\bscan\b` did not match "scanned", and "checked" was absent entirely.
That missed **24 distinct shapes** of *"has anyone checked / pulled / scanned for stored fault
codes?"* — the most common code ask in the corpus, and per the postfix scorecard the exact ask
whose missing active-vs-stored clause the fix was written for. The guard requiring both sides was
never even consulted, because the request pattern never matched.

Corrected to verb stems plus a categorical-dash pattern, and re-audited over all **1764 questions
(1622 unique)** in the 28 dirs: **71 hits**, every one of the 7 code-mentioning questions it
declines names a code the operator already has in hand, and the single residual false positive is
the pre-existing accepted `SPN` hit. Consequence: `codeStatusGaps` on the post-fix arms is **1 per
replicate, not the 0 the scorecard reported "by construction"** — both on c1's *"Have you checked
for stored fault codes with a scan tool or dealer?"*. Pinned in `tests/diagnose-contract.test.mjs`.
