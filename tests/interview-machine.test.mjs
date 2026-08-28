import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TRANSCRIPT_MESSAGES } from "../app/api/diagnose/contract.ts";
import {
  INITIAL_INTERVIEW_STATE,
  atTranscriptCap,
  composeAssistantContent,
  composeReply,
  interviewReducer,
  isSettled,
  nextCursor,
  onLastTurn,
  stageForPhase,
  stripComposedQuestions,
} from "../app/lib/interview-machine.ts";

const questions = [
  { text: "Any warning lights on the monitor?", options: ["Yes", "No"] },
  { text: "When did the symptom start?", options: [] },
  { text: "How severe is it now?", options: ["Mild", "Severe"] },
];

/** A machine mid-interview, the state most transitions depart from. */
const interviewing = {
  ...INITIAL_INTERVIEW_STATE,
  phase: "interviewing",
  transcript: [{ role: "assistant", content: "First turn." }],
  questions,
  selections: [null, null, null],
  typedAnswers: ["", "", ""],
  cursor: 0,
  skipped: [false, false, false],
};

const noTyped = ["", "", ""];

test("composeReply numbers chip answers only when the turn asked several questions", () => {
  // Numbers track the question's own index, mirroring the assistant's lines.
  assert.equal(composeReply(questions, ["Yes", null, "Severe"], noTyped, ""), "1. Yes\n3. Severe");
  assert.equal(composeReply([questions[0]], ["No"], [""], ""), "No");
  // Typed text rides after the chip lines; either side alone also sends.
  assert.equal(composeReply(questions, ["Yes", null, null], noTyped, "About two weeks ago."), "1. Yes\nAbout two weeks ago.");
  assert.equal(composeReply(questions, [null, null, null], noTyped, "  Started Tuesday.  "), "Started Tuesday.");
  // Nothing selected, nothing typed: nothing to send — this disables the control.
  assert.equal(composeReply(questions, [null, null, null], noTyped, "   "), "");
});

test("a per-question typed answer composes on the question's own line", () => {
  // Typed answer alone takes the question's numbered slot.
  assert.equal(
    composeReply(questions, [null, "Last Tuesday", null], ["", "", "getting worse daily"], ""),
    "2. Last Tuesday\n3. getting worse daily",
  );
  // A chip qualified by typed text is one answer, not two lines.
  assert.equal(
    composeReply(questions, ["Yes", null, null], ["only when it's loaded", "", ""], ""),
    "1. Yes — only when it's loaded",
  );
  // Single-question turns stay unnumbered for typed answers too.
  assert.equal(composeReply([questions[1]], [null], ["about a week ago"], ""), "about a week ago");
  // Whitespace-only typed answers do not arm the send control.
  assert.equal(composeReply(questions, [null, null, null], ["  ", "", ""], ""), "");
});

test("typing lands only on an open turn and clears when the turn sends", () => {
  let state = interviewReducer(interviewing, {
    type: "ANSWER_TYPED",
    questionIndex: 1,
    text: "yes when loaded, no when empty",
  });
  assert.deepEqual(state.typedAnswers, ["", "yes when loaded, no when empty", ""]);
  // A typed answer for a question that does not exist cannot land.
  assert.equal(interviewReducer(state, { type: "ANSWER_TYPED", questionIndex: 9, text: "x" }), state);
  // Sending consumes the typed answers exactly like the chip selections.
  const sent = interviewReducer(state, { type: "TURN_SENT", content: "2. yes when loaded" });
  assert.deepEqual(sent.typedAnswers, ["", "", ""]);
  // While the model composes, typing bounces off like a chip toggle does.
  assert.equal(interviewReducer(sent, { type: "ANSWER_TYPED", questionIndex: 0, text: "late" }), sent);
});

test("composeAssistantContent numbers questions the way composeReply answers them", () => {
  assert.equal(
    composeAssistantContent("Two checks.", questions.slice(0, 2)),
    "Two checks.\n1. Any warning lights on the monitor?\n2. When did the symptom start?",
  );
  assert.equal(composeAssistantContent("", [{ text: "Only ask.", options: [] }]), "1. Only ask.");
});

test("a chip answers its question and walks the cursor to the next one", () => {
  let state = interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  assert.deepEqual(state.selections, ["Yes", null, null]);
  // Tap-to-submit: the answer and the advance are one gesture, not two.
  assert.equal(state.cursor, 1);
  // A typed answer settles a free-text question the same way.
  state = interviewReducer(state, { type: "QUESTION_ANSWERED", questionIndex: 1, text: "Last Tuesday" });
  assert.deepEqual(state.typedAnswers, ["", "Last Tuesday", ""]);
  assert.equal(state.cursor, 2);
  // The last question settling lands one past the end — the review state,
  // where the send control is armed. It must NOT send by itself.
  state = interviewReducer(state, { type: "QUESTION_ANSWERED", questionIndex: 2, option: "Severe" });
  assert.equal(state.cursor, 3);
  assert.equal(state.phase, "interviewing");
  assert.equal(state.transcript.length, interviewing.transcript.length);
  // An option the question never offered is a stale chip; it cannot land.
  assert.equal(interviewReducer(state, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Maybe" }), state);
  // Neither can an empty submit — it would settle the question with no content.
  assert.equal(interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 1, text: "   " }), interviewing);
  assert.equal(interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 1 }), interviewing);
  // Nor one for a question this turn never asked.
  assert.equal(interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 9, option: "Yes" }), interviewing);
});

test("an omitted field keeps what is already stored rather than clearing it", () => {
  // The send arrow commits text the ANSWER_TYPED stream stored, with no
  // `text` of its own to pass.
  const typed = interviewReducer(interviewing, { type: "ANSWER_TYPED", questionIndex: 1, text: "Last Tuesday" });
  const committed = interviewReducer(typed, { type: "QUESTION_ANSWERED", questionIndex: 1 });
  assert.deepEqual(committed.typedAnswers, ["", "Last Tuesday", ""]);
  assert.equal(committed.cursor, 0, "question 1 is still outstanding, so the walk goes back to it");

  // A chip tapped over a typed qualifier keeps both: one answer, not two.
  const qualified = interviewReducer(
    interviewReducer(interviewing, { type: "ANSWER_TYPED", questionIndex: 0, text: "only when loaded" }),
    { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" },
  );
  assert.equal(composeReply(questions, qualified.selections, qualified.typedAnswers, ""), "1. Yes — only when loaded");

  // Re-tapping the chip already picked re-confirms and advances; it does not
  // toggle the answer off, because clearing is what Skip is for.
  const picked = interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  const reopened = interviewReducer(picked, { type: "QUESTION_REOPENED", questionIndex: 0 });
  const confirmed = interviewReducer(reopened, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  assert.deepEqual(confirmed.selections, ["Yes", null, null]);
  assert.equal(confirmed.cursor, 1);
});

test("a chip answer replaces the previous pick without stacking", () => {
  const first = interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  const reopened = interviewReducer(first, { type: "QUESTION_REOPENED", questionIndex: 0 });
  assert.equal(reopened.cursor, 0);
  // Reopening keeps the answer so it renders as the current pick.
  assert.deepEqual(reopened.selections, ["Yes", null, null]);
  const changed = interviewReducer(reopened, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "No" });
  assert.deepEqual(changed.selections, ["No", null, null]);
});

test("skipping steps over a question and clears whatever was there", () => {
  const typed = interviewReducer(interviewing, { type: "ANSWER_TYPED", questionIndex: 0, text: "half a thought" });
  // Typing alone does not advance — a half-typed word must not carry the
  // operator to the next question.
  assert.equal(typed.cursor, 0);
  const passed = interviewReducer(typed, { type: "QUESTION_SKIPPED", questionIndex: 0 });
  assert.equal(passed.cursor, 1);
  assert.deepEqual(passed.skipped, [true, false, false]);
  // The abandoned text is gone, so it cannot compose into the reply.
  assert.deepEqual(passed.typedAnswers, ["", "", ""]);
  assert.equal(composeReply(questions, passed.selections, passed.typedAnswers, ""), "");
  // A skipped question is settled for the walk but holds no answer.
  assert.equal(isSettled(passed, 0), true);
  assert.equal(nextCursor(passed), 1);
});

test("retracting reopens a settled question and returns to review when re-answered", () => {
  let state = interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  state = interviewReducer(state, { type: "QUESTION_SKIPPED", questionIndex: 1 });
  state = interviewReducer(state, { type: "QUESTION_ANSWERED", questionIndex: 2, option: "Mild" });
  assert.equal(state.cursor, 3);

  // Reaching back past an intervening question is legal: nothing has been
  // sent, so every answer in the turn is still the operator's to change.
  const back = interviewReducer(state, { type: "QUESTION_REOPENED", questionIndex: 1 });
  assert.equal(back.cursor, 1);
  // Reopening a skipped question un-skips it, or the walk would step straight
  // back over it again.
  assert.deepEqual(back.skipped, [false, false, false]);

  // Re-answering returns to review — where the operator came from — rather
  // than dropping them onto question 2, which they never asked to revisit.
  const again = interviewReducer(back, { type: "QUESTION_ANSWERED", questionIndex: 1, text: "Two weeks ago" });
  assert.equal(again.cursor, 3);
  assert.equal(composeReply(questions, again.selections, again.typedAnswers, ""), "1. Yes\n2. Two weeks ago\n3. Mild");

  // Reopening a question this turn never asked is a no-op.
  assert.equal(interviewReducer(state, { type: "QUESTION_REOPENED", questionIndex: 9 }), state);
});

test("a sent turn freezes the panel: no answers, no retracts, no second send", () => {
  const armed = interviewReducer(interviewing, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "Yes" });
  const sent = interviewReducer(armed, { type: "TURN_SENT", content: "1. Yes" });
  assert.equal(sent.phase, "awaiting-model");
  assert.deepEqual(sent.transcript.at(-1), { role: "user", content: "1. Yes" });
  // Questions stay mounted (disabled in the UI) so the layout holds still,
  // but the consumed selections clear — they must not compose twice.
  assert.equal(sent.questions, interviewing.questions);
  assert.deepEqual(sent.selections, [null, null, null]);
  assert.deepEqual(sent.skipped, [false, false, false]);
  assert.equal(sent.cursor, 0);
  // The display snapshot is taken BEFORE the arrays clear: it is what the
  // in-flight panel shows instead of a rewound blank Question 1.
  assert.deepEqual(sent.sentSummaries, ["Yes", "Not answered", "Not answered"]);
  // Retraction ends at the send: the answers are a transcript message now.
  assert.equal(interviewReducer(sent, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "No" }), sent);
  assert.equal(interviewReducer(sent, { type: "QUESTION_REOPENED", questionIndex: 0 }), sent);
  assert.equal(interviewReducer(sent, { type: "QUESTION_SKIPPED", questionIndex: 0 }), sent);
  assert.equal(interviewReducer(sent, { type: "TURN_SENT", content: "1. Yes" }), sent);
});

test("the next assistant turn replaces the chips and restarts the walk", () => {
  const sent = interviewReducer(interviewing, { type: "TURN_SENT", content: "1. Yes" });
  const next = [{ text: "Does it change when the oil warms?", options: ["Yes", "No", "Unsure"] }];
  const replied = interviewReducer(sent, {
    type: "ASSISTANT_REPLIED",
    status: "needs_more_information",
    message: "One more check.",
    questions: next,
    caseId: "case-7",
  });
  assert.equal(replied.phase, "interviewing");
  assert.deepEqual(replied.questions, next);
  assert.deepEqual(replied.selections, [null]);
  assert.deepEqual(replied.typedAnswers, [""]);
  assert.deepEqual(replied.skipped, [false]);
  assert.equal(replied.cursor, 0);
  assert.equal(replied.caseId, "case-7");
  assert.equal(replied.transcript.at(-1).content, "One more check.\n1. Does it change when the oil warms?");
  // The in-flight snapshot clears the moment the reply lands.
  assert.deepEqual(replied.sentSummaries, []);

  // "ready" retires the chips entirely and opens the report gate.
  const ready = interviewReducer(sent, {
    type: "ASSISTANT_REPLIED",
    status: "ready",
    message: "Enough evidence.",
    questions: next,
  });
  assert.equal(ready.phase, "ready-for-report");
  assert.deepEqual(ready.questions, []);
  assert.deepEqual(ready.skipped, []);
});

test("a failed turn keeps the transcript and only retry re-arms the call", () => {
  const sent = interviewReducer(interviewing, { type: "TURN_SENT", content: "1. Yes" });
  const failed = interviewReducer(sent, { type: "REQUEST_FAILED", error: "The diagnostic request failed." });
  assert.equal(failed.phase, "turn-failed");
  assert.equal(failed.transcript, sent.transcript);
  // The sent-answers snapshot survives the failure — the panel keeps showing
  // what was sent ("your answers are safe"), not a blank re-asked question.
  assert.equal(failed.sentSummaries, sent.sentSummaries);
  // And a send from turn-failed keeps it too: the arrays were already cleared
  // by the failed send, so recomputing would blank every row.
  const resent = interviewReducer(failed, { type: "TURN_SENT", content: "typed instead" });
  assert.equal(resent.sentSummaries, sent.sentSummaries);
  // Chips from the answered turn are inert after a failure too.
  assert.equal(interviewReducer(failed, { type: "QUESTION_ANSWERED", questionIndex: 0, option: "No" }), failed);
  assert.equal(interviewReducer(failed, { type: "QUESTION_REOPENED", questionIndex: 0 }), failed);
  const retried = interviewReducer(failed, { type: "RETRY_REQUESTED" });
  assert.equal(retried.phase, "awaiting-model");
  assert.equal(retried.error, "");
  // Retry is only meaningful from the failed state.
  assert.equal(interviewReducer(interviewing, { type: "RETRY_REQUESTED" }), interviewing);
});


/** A transcript of exactly `count` alternating messages. */
const transcriptOf = (count) =>
  Array.from({ length: count }, (_unused, index) => ({
    role: index % 2 === 0 ? "assistant" : "user",
    content: `message ${index + 1}`,
  }));

test("the cap stops one round early, because the transcript is never even", () => {
  // A round appends the operator's message out and the model's back, so the
  // count is always ODD -- 1,3,5,7,9,11,13 -- and never 12. validateRequest
  // rejects >12 for BOTH actions, so a transcript that reaches 13 can be sent
  // neither as a turn nor as a report. Measured live 2026-08-19.
  assert.equal(MAX_TRANSCRIPT_MESSAGES, 12);
  assert.equal(atTranscriptCap({ transcript: transcriptOf(9) }), false);
  assert.equal(atTranscriptCap({ transcript: transcriptOf(11) }), true);
  // The warning fires one round early, and stops once it has bitten.
  assert.equal(onLastTurn({ transcript: transcriptOf(7) }), false);
  assert.equal(onLastTurn({ transcript: transcriptOf(9) }), true);
  assert.equal(onLastTurn({ transcript: transcriptOf(11) }), false);
});

test("the cap leaves the transcript short enough that a report can still be sent", () => {
  // The invariant the whole fix rests on: whatever the walk does, the array
  // generateReport() hands to validateRequest is inside the limit.
  let state = { ...interviewing, transcript: transcriptOf(1) };
  for (let round = 0; round < 12; round += 1) {
    if (atTranscriptCap(state)) break;
    const sent = interviewReducer(state, { type: "TURN_SENT", content: "answer" });
    // What the interview request carries.
    assert.ok(sent.transcript.length <= MAX_TRANSCRIPT_MESSAGES, "an interview turn exceeded the cap");
    state = interviewReducer({ ...sent, phase: "awaiting-model" }, {
      type: "ASSISTANT_REPLIED", status: "needs_more_information", message: "more", questions,
    });
    // What a report request would carry, at every point in the walk.
    assert.ok(state.transcript.length <= MAX_TRANSCRIPT_MESSAGES, "the report request would exceed the cap");
  }
  assert.equal(atTranscriptCap(state), true, "the walk must actually reach the cap");
  assert.equal(state.transcript.length, 11);
});

test("at the cap the send is refused and retry stops re-sending a doomed transcript", () => {
  const spent = { ...interviewing, transcript: transcriptOf(MAX_TRANSCRIPT_MESSAGES - 1) };

  // The send the server would reject anyway never appends locally.
  const afterSend = interviewReducer(spent, { type: "TURN_SENT", content: "1. Yes" });
  assert.equal(afterSend, spent, "TURN_SENT must be a no-op at the cap");

  // Nothing mutates between retry attempts, so a retry of an over-long
  // transcript fails identically forever -- the dead end itself.
  const failed = { ...spent, phase: "turn-failed", error: "The interview is longer than this diagnostic session supports." };
  assert.equal(interviewReducer(failed, { type: "RETRY_REQUESTED" }), failed, "retry must be a no-op at the cap");

  // Below the cap both still work exactly as before.
  const room = { ...interviewing, transcript: transcriptOf(4) };
  assert.equal(interviewReducer(room, { type: "TURN_SENT", content: "1. Yes" }).phase, "awaiting-model");
  const failedWithRoom = { ...room, phase: "turn-failed" };
  assert.equal(interviewReducer(failedWithRoom, { type: "RETRY_REQUESTED" }).phase, "awaiting-model");
});

test("the report is reachable at the cap, and nowhere else the model has not opened", () => {
  const spent = transcriptOf(MAX_TRANSCRIPT_MESSAGES - 1);
  const room = transcriptOf(4);

  // The one new door: no turn left to send, so the report is the only terminal
  // state. Deliberately NOT a general early stop.
  for (const phase of ["interviewing", "turn-failed"]) {
    assert.equal(
      interviewReducer({ ...interviewing, phase, transcript: spent }, { type: "REPORT_REQUESTED" }).phase,
      "generating",
      `${phase} at the cap must reach the report`,
    );
    assert.equal(
      interviewReducer({ ...interviewing, phase, transcript: room }, { type: "REPORT_REQUESTED" }).phase,
      phase,
      `${phase} below the cap must NOT reach the report`,
    );
  }

  // Still illegal mid-flight, cap or not: a second report call would be billed
  // on top of one already running.
  for (const phase of ["awaiting-model", "generating"]) {
    assert.equal(
      interviewReducer({ ...interviewing, phase, transcript: spent }, { type: "REPORT_REQUESTED" }).phase,
      phase,
      `${phase} must never reach the report`,
    );
  }

  // And the ordinary path is untouched.
  assert.equal(
    interviewReducer({ ...interviewing, phase: "ready-for-report", transcript: room }, { type: "REPORT_REQUESTED" }).phase,
    "generating",
  );
});

test("the model's private reasoning rides the transcript and never reaches the bubble", () => {
  // Optional and inert in production: the live prompt does not ask for it, so
  // the composed content is byte-identical to what it always was.
  const plain = composeAssistantContent("A couple more details.", questions);
  assert.equal(plain, composeAssistantContent("A couple more details.", questions, undefined));
  assert.equal(plain, composeAssistantContent("A couple more details.", questions, "   "));

  const wire = composeAssistantContent("A couple more details.", questions, "Glow plugs still live;\n  compression not separated.");
  // One line, whitespace collapsed -- a multi-line note would leave its tail
  // rendering in the bubble, since only a single leading line is peeled.
  assert.equal(wire.split("\n")[0], "[private reasoning] Glow plugs still live; compression not separated.");
  assert.ok(wire.includes("A couple more details."), "the operator-facing message still rides the wire");

  // The bubble sees neither the reasoning nor the numbered questions.
  assert.equal(stripComposedQuestions(wire, questions), "A couple more details.");
  assert.equal(stripComposedQuestions(plain, questions), "A couple more details.");

  // A numbered line the model wrote inside its own prose is still not eaten,
  // and neither is prose that merely mentions the marker mid-sentence.
  const prose = composeAssistantContent("Check 1. the filter", questions);
  assert.equal(stripComposedQuestions(prose, questions), "Check 1. the filter");
});

test("report phases map onto the shell's stages and fall back to the interview", () => {
  const ready = { ...interviewing, phase: "ready-for-report", questions: [], selections: [] };
  const generating = interviewReducer(ready, { type: "REPORT_REQUESTED" });
  assert.equal(stageForPhase(generating.phase), "generating");
  // A failed generation returns to the ready state, keeping the retry visible.
  const failed = interviewReducer(generating, { type: "REQUEST_FAILED", error: "Upstream 500" });
  assert.equal(failed.phase, "ready-for-report");
  const done = interviewReducer(generating, { type: "REPORT_RENDERED", html: "<!doctype html>" });
  assert.equal(stageForPhase(done.phase), "report");
  assert.equal(done.reportHtml, "<!doctype html>");
  // Generating is only reachable from ready-for-report.
  assert.equal(interviewReducer(interviewing, { type: "REPORT_REQUESTED" }), interviewing);
});
