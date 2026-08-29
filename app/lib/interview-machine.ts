import { MAX_TRANSCRIPT_MESSAGES } from "../api/diagnose/contract.ts";

/**
 * The diagnostic interview's finite-state machine.
 *
 * One reducer owns every piece of flow state that used to live in separate
 * useState hooks — phase, transcript, the current turn's questions, chip
 * selections, error — because the interaction bugs this replaces were all
 * illegal *combinations* of those hooks: a chip firing while a reply was in
 * flight, a second send racing a pending one, stale chips from an answered
 * turn, the chip panel unmounting mid-response and jumping the layout. Every
 * transition below is guarded on the phase it is legal from and returns the
 * state unchanged otherwise, so those combinations cannot be reached at all.
 *
 * ## One question at a time
 *
 * A turn may carry up to three questions (`parseInterview` slices there), but
 * the operator is asked exactly one of them at a time. `cursor` is which one.
 * That walk is *entirely local*: the wire protocol is unchanged, the model
 * still receives one combined user turn per round, and `composeReply` still
 * folds every question's answer into it. Asking one at a time is a rendering
 * decision, not a protocol one — it costs no extra model calls.
 *
 * The consequence that makes retraction cheap: until the turn is sent, no
 * answer has left the browser. Any settled question can be reopened and
 * changed, because there is nothing to take back yet. After `TURN_SENT` the
 * answers are a message in the transcript and the panel goes inert — that is a
 * property of the conversation, not a UI limitation.
 *
 * Pure module — no React, no DOM — so `node --test` drives the machine
 * directly (tests/interview-machine.test.mjs).
 */

import type { InterviewQuestion, TranscriptMessage } from "../api/diagnose/contract.ts";

/**
 * Every state the diagnostic flow can be in, as one value. The four page
 * stages the shell renders (`stage-intake` … `stage-report`) are derived by
 * `stageForPhase`, never stored beside the phase — a phase/stage disagreement
 * was representable in the useState version and is not here.
 *
 * - intake            filling the form; no interview yet
 * - awaiting-model    an interview call is in flight; chips render disabled
 * - interviewing      the model asked; the current questions are open
 * - turn-failed       a call failed; the transcript is intact, retry offered
 * - ready-for-report  the model has enough evidence
 * - generating        the report call is in flight
 * - report            the report rendered
 */
export type InterviewPhase =
  | "intake"
  | "awaiting-model"
  | "interviewing"
  | "turn-failed"
  | "ready-for-report"
  | "generating"
  | "report";

export type InterviewState = {
  phase: InterviewPhase;
  transcript: TranscriptMessage[];
  /**
   * The current turn's questions. Deliberately kept through `awaiting-model`
   * and `turn-failed` so the panel never unmounts under the operator's thumb;
   * only the next assistant turn replaces them.
   */
  questions: InterviewQuestion[];
  /**
   * One selection per question, by index; null = unanswered. Single-select
   * within a question on purpose: the option lists are yes/no and short
   * severity scales (see MAX_OPTIONS_PER_QUESTION in the contract), where two
   * simultaneous answers would contradict each other.
   */
  selections: ReadonlyArray<string | null>;
  /**
   * One free-text answer per question, by index; "" = nothing typed. Lives
   * beside the chip selection rather than replacing it, because the honest
   * answer is often a qualified chip — "Yes — but only when it's warm" — and
   * forcing a bare yes/no was losing exactly the discriminating half.
   */
  typedAnswers: ReadonlyArray<string>;
  /**
   * Which question is being asked. `questions.length` — one past the end — is
   * the turn's review state: everything is settled, nothing is being asked,
   * and the send control is armed. Deriving it instead of storing it was
   * tried and is wrong: "answered question 2, now back on 2 to change it" and
   * "answered question 2, moving on" have identical answer arrays.
   */
  cursor: number;
  /**
   * Questions the operator passed on, by index. Needed because a skipped
   * question and an unreached one both have a null selection and an empty
   * typed answer — without this the walk could never step over one.
   */
  skipped: ReadonlyArray<boolean>;
  /**
   * Display-only snapshot of `answerSummary` for every question, taken at
   * `TURN_SENT` — i.e. what the just-sent turn said, per question. The live
   * `selections`/`typedAnswers` must clear at send (they were consumed into
   * the turn), but the panel still needs to SHOW the sent answers while the
   * model composes; deriving the in-flight view from the cleared arrays is
   * what made the panel rewind to a blank Question 1 on every send.
   * Never composed into a reply; cleared when the next assistant turn lands.
   */
  sentSummaries: ReadonlyArray<string>;
  caseId?: string;
  reportHtml: string;
  error: string;
};

export type InterviewAction =
  | { type: "INTERVIEW_STARTED" }
  | {
      type: "ASSISTANT_REPLIED";
      status: "needs_more_information" | "ready";
      message: string;
      questions: InterviewQuestion[];
      /** Wire-only; asked for every turn, never rendered — see `contract.ts`. */
      reasoning?: string;
      caseId?: string;
    }
  | { type: "QUESTION_ANSWERED"; questionIndex: number; option?: string; text?: string }
  | { type: "QUESTION_SKIPPED"; questionIndex: number }
  | { type: "QUESTION_REOPENED"; questionIndex: number }
  | { type: "ANSWER_TYPED"; questionIndex: number; text: string }
  | { type: "TURN_SENT"; content: string }
  | { type: "RETRY_REQUESTED" }
  | { type: "REQUEST_FAILED"; error: string }
  | { type: "REPORT_REQUESTED" }
  | { type: "REPORT_RENDERED"; html: string };

export const INITIAL_INTERVIEW_STATE: InterviewState = {
  phase: "intake",
  transcript: [],
  questions: [],
  selections: [],
  typedAnswers: [],
  cursor: 0,
  skipped: [],
  sentSummaries: [],
  reportHtml: "",
  error: "",
};

/** Phases from which the operator may compose and send a turn. */
const SENDABLE: ReadonlyArray<InterviewPhase> = [
  "interviewing",
  "turn-failed",
  "ready-for-report",
];

/**
 * The interview has no turn left that the report could survive.
 *
 * ⚠ The threshold is MAX − 2, and the two is load-bearing. A round appends the
 * operator's message on the way out and the model's on the way back, so the
 * transcript only ever holds an ODD count — 1, 3, 5, 7, 9, 11, 13. It is never
 * 12. `validateRequest` rejects anything longer than MAX for BOTH actions, so
 * a transcript that reaches 13 cannot be sent as an interview turn *or* as a
 * report: the operator is left holding a case that can never produce a
 * document. Measured live 2026-08-19 by driving the walk to the wall.
 *
 * Refusing the send at 11 keeps the transcript at 11 forever, and 11 + the
 * report's own zero additions is comfortably inside the limit. The cost is the
 * final round — a round whose reply could never have been turned into a report
 * anyway, which is why it is not a loss.
 *
 * The counter belongs here rather than in the view because the reducer is what
 * refuses the send.
 */
export function atTranscriptCap(state: InterviewState): boolean {
  return state.transcript.length + 2 > MAX_TRANSCRIPT_MESSAGES;
}

/**
 * One round left. The warning fires here, not at the cap: an operator who
 * learns about the limit at the moment it bites cannot spend the last round
 * differently.
 */
export function onLastTurn(state: InterviewState): boolean {
  return state.transcript.length + 4 > MAX_TRANSCRIPT_MESSAGES && !atTranscriptCap(state);
}

/**
 * Whether question `index` has been dealt with — answered by chip, answered by
 * typing, or deliberately skipped. Drives which question the walk lands on
 * next and which pills render as retractable.
 */
export function isSettled(state: InterviewState, index: number): boolean {
  return (
    state.skipped[index] === true ||
    state.selections[index] != null ||
    (state.typedAnswers[index] ?? "").trim() !== ""
  );
}

/**
 * Where the cursor goes after a question settles: the lowest-index question
 * still outstanding, or `questions.length` (the review state) when none is.
 *
 * Lowest-outstanding rather than `index + 1` so the two directions of travel
 * agree. Walking forward they are the same. But after reopening question 1 of
 * 3 and re-answering it, `index + 1` would drop the operator onto question 2 —
 * which they already answered and did not ask to revisit — where this returns
 * them to review, where they came from.
 */
export function nextCursor(state: InterviewState): number {
  for (let index = 0; index < state.questions.length; index += 1) {
    if (!isSettled(state, index)) return index;
  }
  return state.questions.length;
}

/**
 * The assistant side of the wire format: message, then each question on its
 * own numbered line. `composeReply` numbers the operator's answers against
 * these same 1-based indexes, so the two functions must move together.
 */
/**
 * The marker on the wire-only reasoning line.
 *
 * The transcript is simultaneously the payload the model receives and the
 * source the bubble renders, so anything the model must see and the operator
 * must not needs a shape the display path can peel back off — the same problem
 * the numbered question lines already have, solved the same way.
 */
export const REASONING_PREFIX = "[private reasoning] ";

export function composeAssistantContent(
  message: string,
  questions: readonly InterviewQuestion[],
  reasoning?: string,
): string {
  // Collapsed to one line on purpose: the strip below peels a single leading
  // line, and a multi-line note would leave its tail rendering in the bubble.
  const note = reasoning?.replace(/\s+/g, " ").trim();
  return [
    note ? `${REASONING_PREFIX}${note}` : "",
    message,
    ...questions.map((question, index) => `${index + 1}. ${question.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The one line a question contributes to the outgoing turn: its chip, its
 * typed answer, or both joined as "chip — typed" (a chip qualified by prose is
 * one answer, not two). Empty when the question was skipped or never answered,
 * which is exactly when it should contribute no line at all.
 */
export function answerText(
  selections: ReadonlyArray<string | null>,
  typedAnswers: ReadonlyArray<string>,
  index: number,
): string {
  const choice = selections[index];
  const answer = (typedAnswers[index] ?? "").trim();
  return choice && answer ? `${choice} — ${answer}` : choice || answer || "";
}

/**
 * How an answer reads back in the progress rail and the review list. Same
 * text the model will receive, so the operator checks what actually sends —
 * with the two empty cases named rather than rendered blank, because a blank
 * row reads as a rendering bug when it is really a deliberate skip.
 */
export function answerSummary(state: InterviewState, index: number): string {
  if (state.skipped[index]) return "Skipped";
  return answerText(state.selections, state.typedAnswers, index) || "Not answered";
}

/**
 * Folds chip selections, per-question typed answers, and the trailing
 * free-text field into one outgoing user turn. Answer lines carry their
 * question number only when the turn asked more than one question — mirroring
 * how the assistant content numbered them — and the trailing typed text rides
 * after the answer lines. Empty result means there is nothing to send, which
 * is also what disables the send control.
 */
export function composeReply(
  questions: readonly InterviewQuestion[],
  selections: ReadonlyArray<string | null>,
  typedAnswers: ReadonlyArray<string>,
  typed: string,
): string {
  const lines: string[] = [];
  questions.forEach((_question, index) => {
    const line = answerText(selections, typedAnswers, index);
    if (!line) return;
    lines.push(questions.length > 1 ? `${index + 1}. ${line}` : line);
  });
  const text = typed.trim();
  if (text) lines.push(text);
  return lines.join("\n");
}

/**
 * The assistant's preamble, with the numbered question lines and the wire-only
 * reasoning line `composeAssistantContent` added stripped back off.
 *
 * The transcript stores the composed form because that is what the model must
 * receive. The bubble must not render it: the questions are asked one at a
 * time in the panel below, so printing all three above the first one both
 * duplicates the ask and hands back the wall of questions the one-at-a-time
 * walk exists to break up.
 *
 * Peels matching lines off the end only, and compares them whole against what
 * the composer would have produced — so a numbered line the model wrote inside
 * its own prose is never mistaken for a question and eaten.
 */
export function stripComposedQuestions(
  content: string,
  questions: readonly InterviewQuestion[],
): string {
  const lines = content.split("\n");
  let end = lines.length;
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    if (lines[end - 1] !== `${index + 1}. ${questions[index].text}`) break;
    end -= 1;
  }
  // The wire-only reasoning line, peeled off the FRONT. Same discipline as the
  // questions: an exact marker, never a fuzzy match, so prose is never eaten.
  const start = lines[0]?.startsWith(REASONING_PREFIX) ? 1 : 0;
  return lines.slice(start, Math.max(start, end)).join("\n").trim();
}

export function stageForPhase(
  phase: InterviewPhase,
): "intake" | "interview" | "generating" | "report" {
  switch (phase) {
    case "intake":
      return "intake";
    case "generating":
      return "generating";
    case "report":
      return "report";
    default:
      return "interview";
  }
}

export function interviewReducer(
  state: InterviewState,
  action: InterviewAction,
): InterviewState {
  switch (action.type) {
    case "INTERVIEW_STARTED":
      // A fresh diagnosis drops the previous case wholesale — transcript,
      // caseId and report included — rather than patching fields one by one.
      if (state.phase !== "intake") return state;
      return { ...INITIAL_INTERVIEW_STATE, phase: "awaiting-model" };

    case "ASSISTANT_REPLIED": {
      if (state.phase !== "awaiting-model") return state;
      const ready = action.status === "ready";
      return {
        ...state,
        phase: ready ? "ready-for-report" : "interviewing",
        transcript: [
          ...state.transcript,
          {
            role: "assistant",
            content: composeAssistantContent(action.message, action.questions, action.reasoning),
          },
        ],
        // The new turn's questions replace the old chips in the same commit
        // that clears the selections — there is no frame where a stale chip
        // renders enabled.
        questions: ready ? [] : action.questions,
        selections: ready ? [] : action.questions.map(() => null),
        typedAnswers: ready ? [] : action.questions.map(() => ""),
        // The walk restarts at the first question of the new turn.
        cursor: 0,
        skipped: ready ? [] : action.questions.map(() => false),
        // The in-flight snapshot has served its purpose — the reply is here.
        sentSummaries: [],
        caseId: action.caseId ?? state.caseId,
        error: "",
      };
    }

    case "QUESTION_ANSWERED": {
      // Only an open turn takes an answer: while the model is composing, after
      // a failure, and after the turn is sent the chips are inert.
      if (state.phase !== "interviewing") return state;
      const question = state.questions[action.questionIndex];
      if (!question) return state;
      // A chip the question never offered is stale — it belongs to a turn that
      // has already been replaced — and cannot land.
      if (action.option !== undefined && !question.options.includes(action.option)) return state;
      // An omitted field means "keep what is already there", so tapping the
      // chip you already picked re-confirms and advances, and the send arrow
      // can commit a typed answer the ANSWER_TYPED stream already stored.
      const option = action.option ?? state.selections[action.questionIndex] ?? null;
      const text = action.text ?? state.typedAnswers[action.questionIndex] ?? "";
      // Nothing to commit is not an answer; it would settle the question with
      // no content and silently drop it from the reply. Skipping is how a
      // question gets settled empty, and it says so.
      if (option === null && text.trim() === "") return state;
      const answered: InterviewState = {
        ...state,
        selections: state.selections.map((selected, index) =>
          index === action.questionIndex ? option : selected,
        ),
        typedAnswers: state.typedAnswers.map((answer, index) =>
          index === action.questionIndex ? text : answer,
        ),
        // Answering un-skips: the two are mutually exclusive states of one
        // question, and a reopened-then-answered question must not stay flagged.
        skipped: state.skipped.map((flag, index) => (index === action.questionIndex ? false : flag)),
      };
      return { ...answered, cursor: nextCursor(answered) };
    }

    case "QUESTION_SKIPPED": {
      if (state.phase !== "interviewing") return state;
      if (!state.questions[action.questionIndex]) return state;
      // Skipping clears whatever was there. Otherwise a half-typed answer the
      // operator explicitly passed on would still compose into the reply.
      const passed: InterviewState = {
        ...state,
        selections: state.selections.map((selected, index) =>
          index === action.questionIndex ? null : selected,
        ),
        typedAnswers: state.typedAnswers.map((answer, index) =>
          index === action.questionIndex ? "" : answer,
        ),
        skipped: state.skipped.map((flag, index) => (index === action.questionIndex ? true : flag)),
      };
      return { ...passed, cursor: nextCursor(passed) };
    }

    case "QUESTION_REOPENED": {
      // The retract gesture. Nothing has been sent, so this only moves the
      // cursor and clears the skip flag — the existing answer is kept and
      // rendered as the current pick, so reopening to confirm costs nothing
      // and reopening to change is one tap.
      if (state.phase !== "interviewing") return state;
      if (!state.questions[action.questionIndex]) return state;
      return {
        ...state,
        cursor: action.questionIndex,
        skipped: state.skipped.map((flag, index) => (index === action.questionIndex ? false : flag)),
      };
    }

    case "ANSWER_TYPED": {
      // Live typing into the current question's box. Deliberately does NOT
      // advance the cursor — only an explicit submit does, or a half-typed
      // word would carry the operator to the next question.
      if (state.phase !== "interviewing") return state;
      if (!state.questions[action.questionIndex]) return state;
      return {
        ...state,
        typedAnswers: state.typedAnswers.map((answer, index) =>
          index === action.questionIndex ? action.text : answer,
        ),
      };
    }

    case "TURN_SENT": {
      // Ignored from awaiting-model, so a double submit cannot append the
      // same turn twice however fast it arrives.
      if (!SENDABLE.includes(state.phase)) return state;
      // And refused at the cap: the server would reject the request anyway,
      // and appending the turn locally would grow a transcript that can never
      // be sent again. The report is the way out from here.
      if (atTranscriptCap(state)) return state;
      const content = action.content.trim();
      if (!content) return state;
      return {
        ...state,
        phase: "awaiting-model",
        transcript: [...state.transcript, { role: "user", content }],
        // Questions stay mounted (disabled) so the panel keeps its height,
        // but the selections and typed answers clear: they were consumed into
        // the turn just sent, and leaving them live would compose them into
        // the next reply a second time if this call fails and the operator
        // types instead.
        selections: state.selections.map(() => null),
        typedAnswers: state.typedAnswers.map(() => ""),
        skipped: state.skipped.map(() => false),
        cursor: 0,
        // Snapshot what each question said BEFORE the arrays clear, so the
        // in-flight panel can show the sent answers instead of a rewound
        // blank Question 1. Taken from the pre-clear `state` on purpose.
        // From turn-failed the arrays are ALREADY cleared (the failed send
        // consumed them), so recomputing would blank every row — the snapshot
        // of the original send stays.
        sentSummaries:
          state.phase === "turn-failed"
            ? state.sentSummaries
            : state.questions.map((_question, index) => answerSummary(state, index)),
        error: "",
      };
    }

    case "RETRY_REQUESTED":
      // Retry re-sends the transcript exactly as it stands; the failed turn's
      // user message is already in it, so nothing is composed again.
      if (state.phase !== "turn-failed") return state;
      // Which is precisely why it must not fire at the cap. Nothing mutates
      // between attempts, so a retry of an over-long transcript fails the same
      // way forever — the dead end this guard closes.
      if (atTranscriptCap(state)) return state;
      return { ...state, phase: "awaiting-model", error: "" };

    case "REQUEST_FAILED":
      if (state.phase === "awaiting-model") {
        return { ...state, phase: "turn-failed", error: action.error };
      }
      if (state.phase === "generating") {
        // Back to ready-for-report, not to the report page: the transcript is
        // intact and "Generate field report" is right there to retry.
        return { ...state, phase: "ready-for-report", error: action.error };
      }
      return state;

    case "REPORT_REQUESTED":
      // Normally the model decides the interview is over. The one exception is
      // the cap: with no turn left to send, the report is the only terminal
      // state, and refusing it here is what made the far end unrecoverable.
      // Deliberately NOT a general operator early-stop — that needs truncation
      // guards this does not build, and at the cap the interview is as long as
      // the protocol allows rather than cut short.
      if (
        state.phase !== "ready-for-report" &&
        !((state.phase === "interviewing" || state.phase === "turn-failed") && atTranscriptCap(state))
      ) {
        return state;
      }
      return { ...state, phase: "generating", error: "" };

    case "REPORT_RENDERED":
      if (state.phase !== "generating") return state;
      return { ...state, phase: "report", reportHtml: action.html, error: "" };

    default:
      return state;
  }
}
