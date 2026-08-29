/**
 * Shared request contract for `/api/diagnose`.
 *
 * Pure functions and constants only — no Cloudflare or DOM imports — so both
 * the Worker route and the client component can hold the same limits, and so
 * the whole contract is testable under plain `node --test`.
 */

export const MAX_IMAGES = 4;

/** Largest photo we accept, measured before base64 expansion. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** base64 costs 4 bytes per 3, plus room for the `data:image/webp;base64,` prefix. */
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;

/** Every photo at its cap, plus slack for the intake fields and transcript. */
export const MAX_REQUEST_BYTES =
  MAX_IMAGES * MAX_IMAGE_DATA_URL_LENGTH + 256 * 1024;

export const MAX_TRANSCRIPT_MESSAGES = 12;
export const MAX_MESSAGE_LENGTH = 4_000;

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type Action = "interview" | "report";

/**
 * The only two models a report request may pick directly. A narrow literal
 * union rather than the full admin catalog (`app/lib/settings.ts`) — this is
 * an operator-facing thoroughness choice on one request, not the server-wide
 * default an admin sets in Settings.
 */
export const REPORT_MODEL_OPTIONS = ["claude-sonnet-5", "claude-opus-5"] as const;
export type ReportModel = (typeof REPORT_MODEL_OPTIONS)[number];

export type Equipment = {
  year: string;
  make: string;
  model: string;
  machineType?: string;
  serialPin?: string;
  hours?: string;
  market?: string;
  operatingConditions?: string;
  recentWork?: string;
  /**
   * Fault codes the operator can already read off the machine, collected at
   * intake rather than asked for mid-interview.
   *
   * Measured 2026-08-19 over 256 banked eval runs: **176 (69%) never raise
   * fault codes at all**, and when the interview does ask it asks in round 1
   * (59 of the 80 that ever ask) or never. Collecting it at intake beats a
   * deterministic round-1 question because every round-1 turn already carries
   * the maximum three questions — 256 of 256 — so inside the interview there is
   * no free slot at any price. A form field costs zero interview turns.
   *
   * Unbounded, like every other optional string here; `MAX_REQUEST_BYTES` is
   * the ceiling. Deliberately NOT part of `IntakeEquipment` — a fault code is
   * a symptom of one visit, not machine identity, and must never be written to
   * the `machine` inventory row.
   */
  faultCodes?: string;
};

export type Attachment = {
  name: string;
  type: string;
  dataUrl: string;
};

export type TranscriptMessage = {
  role: "assistant" | "user";
  content: string;
};

export type DiagnosisRequest = {
  action: Action;
  equipment: Equipment;
  problem: string;
  /** Full image payload. Sent on the first interview turn and on the report. */
  attachments?: Attachment[];
  /** Names of every photo in the case, sent on every turn so later prompts can cite them. */
  attachmentNames?: string[];
  transcript?: TranscriptMessage[];
  /** Set once the first interview turn returns one. Absent means "create a new case". */
  caseId?: string;
  /**
   * An inventory machine the operator picked at intake. The server re-checks
   * ownership before trusting it; absent or foreign falls back to the fuzzy
   * year/make/model match `autosaveMachineFromIntake` has always done.
   */
  machineId?: string;
  /** Report-thoroughness pick from the intake UI. Only meaningful when `action` is "report". */
  reportModel?: ReportModel;
};

/** A single interview question. `options` is empty for a free-text ask. */
export type InterviewQuestion = {
  text: string;
  options: string[];
};

export type InterviewResult = {
  status: "needs_more_information" | "ready";
  message: string;
  questions: InterviewQuestion[];
  /**
   * The model's own differential reasoning, carried in the transcript but
   * never rendered to the operator.
   *
   * Wire-only, and live: `INTERVIEW_SYSTEM_PROMPT` asks for it on every turn
   * and the model emits it, but no display path renders it. It exists because
   * the operator-facing `message` is forbidden
   * verdict-shaped claims ("this rules out X"), and that message is also the
   * last thing the model said to itself before the report call reads the
   * transcript — measured 2026-08-19, banning the claim there cost 4 pooled
   * cases of ranking accuracy. This field is where the reasoning goes instead.
   */
  reasoning?: string;
};

/** Chips per question: enough to cover yes/no through a short severity scale. */
const MAX_OPTIONS_PER_QUESTION = 5;

/**
 * Patterns for an ask whose only correct answer is a value the operator reads
 * off the machine — a fault code, a serial/PIN, a part number, a metered
 * reading. A chip set cannot contain such a value, so offering one replaces it.
 *
 * Deliberately NARROW, and widening it is a measured change rather than a
 * tidy-up. It must never fire on an ordinary categorical ask ("constant or
 * intermittent?", "how long has it done this?") — stripping the chips off those
 * costs the operator a keyboard and buys nothing. Re-run
 * `evals/interview-metrics.mjs` over your own run directories after any edit
 * here — it prints every question this fires on, so a false positive is
 * visible without billing a model.
 *
 * Two notes on specific entries:
 * - Bare `code`/`codes` is in, because in this domain the word has no other
 *   common sense and the categorical dash ask ("regen light, filter % full, or
 *   a fault code?") is exactly the measured failure.
 * - `PIN` is case-SENSITIVE. Lowercase "pin" is a bucket pin, a king pin, a
 *   wrist pin — the most common mechanical noun in the corpus.
 */
const VALUE_ASK_PATTERNS: readonly RegExp[] = [
  /\bcodes?\b/i,
  /\b(?:dtc|spn|fmi)s?\b/i,
  /\bserial\b/i,
  /\bPIN\b/,
  /\bpin (?:number|#)/i,
  /\bproduct identification number\b/i,
  /\bpart (?:number|no\.?|#)/i,
  /\bmodel number\b/i,
  /\bhour meter\b/i,
  // Value forms only. An earlier draft matched the bare verb ("gauge reads")
  // and its single hit across 1536 banked questions was a false positive —
  // "does the coolant temperature gauge read higher than normal?" is a yes/no,
  // and its chips are correct.
  /\b(?:gauge|meter|readout|display|screen) reading\b/i,
  /\bwhat (?:does|did) the [\w\s]{0,24}?(?:gauge|meter|readout|display|screen) (?:read|show|say)/i,
  /\bexact(?:ly)? (?:reading|number|value|figure|pressure|temperature|voltage|hours)\b/i,
];

/**
 * Chip labels that mean "I have not gone and looked", which the app must never
 * offer as a tap target.
 *
 * WHY. Measured 2026-08-20 over every option this app has ever emitted in the
 * eval corpus: 16,622 chips, of which **22.5% were some flavour of shrug**. The
 * operator simulator takes an offered chip verbatim 96% of the time, and on the
 * first run of the mechanic-persona arm **5 of 5 shrugged answers were a chip the
 * model itself had put on the menu**. A question shaped "have you checked the
 * water separator bowl?" with `["Checked, clean", "Checked, water found", "Not
 * checked"]` hands the operator a one-tap way out of a sixty-second job, and they
 * take it. This is a diagnostic tool for mechanics; not checking must be a
 * deliberate act, not the path of least resistance.
 *
 * ⚠ THE NARROWNESS IS THE WHOLE DESIGN — do not widen this to "uncertainty".
 * Two chip families look alike and are opposites:
 *   - "I have not gone and looked"  → `Not checked`, `Haven't tried`, `Not tested`.
 *     Actionable. The fix is to go look. These are stripped.
 *   - "I looked and I cannot tell"  → `Not sure`, `Can't tell`, `Don't know`.
 *     Epistemic, and often the honest answer. These STAY.
 * `Not sure` alone is 2,183 of the 3,745 shrug chips. Stripping it would leave an
 * operator who genuinely cannot tell with no true option, and the documented
 * consequence of an option set missing the machine's true state is that they take
 * the nearest chip and the report recommends the opposite repair — proven two ways
 * on the c3/c4 scenarios. Same reason a chip set always keeps its escape.
 *
 * Removing these does NOT strand anyone: "None of these — type it" and Skip both
 * still settle a question the operator cannot answer. It costs a gesture, which is
 * the point.
 */
const UNCHECKED_OPTION_PATTERNS: readonly RegExp[] = [
  // not / never / haven't / hasn't + a verb of GOING AND LOOKING.
  /\b(?:not|never|haven'?t|hasn'?t|didn'?t|hadn'?t)\s+(?:\w+\s+){0,2}?(?:check|checked|checking|look|looked|test|tested|tri(?:ed|y)|measur(?:e|ed)|compar(?:e|ed)|inspect(?:ed)?|verif(?:y|ied)|clean(?:ed)?|clear(?:ed)?|pull(?:ed)?|open(?:ed)?|drain(?:ed)?)\b/i,
];

/**
 * True when a chip label means "I have not gone and looked".
 * Deliberately blind to uncertainty — see UNCHECKED_OPTION_PATTERNS.
 */
export function isUncheckedOption(label: string): boolean {
  // An uncertainty word anywhere disqualifies it: "Original/unknown age" and
  // "No indicator/not sure" are answers about records and perception, not about
  // skipping a check.
  if (/\b(?:sure|know|knows|tell|idea|unknown|notice[d]?|remember|recall)\b/i.test(label)) return false;
  return UNCHECKED_OPTION_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Does this question ask for a value rather than a category?
 *
 * Measured 2026-08-15 over a banked eval campaign: the
 * operator simulator takes an offered chip verbatim **96% of the time (77/80)**,
 * so an option set that omits the machine's true state does not merely fail to
 * help — it substitutes a wrong answer that the report then reasons correctly
 * from. Two of twelve runs asked a categorical dash question, took the
 * category, and never obtained the fault code; across the campaign, asking for
 * a code *as a value* and obtaining it were the same event, 6/6 in both
 * directions.
 *
 * `prompts.ts` already carries this rule ("Leave `options` empty for anything
 * that needs free text, such as a serial number, an exact reading, or an open
 * description") and the model ignores it. A settled negative result stands
 * behind this: restating a prompt rule harder — as a pre-emit check, with a
 * worked counter-example — does not bind on this model. So the enforcement
 * lives here instead, in the one place options are cleaned, which
 * both `app/api/diagnose/route.ts` and `evals/run-eval.mjs` import.
 *
 * Exported for `tests/diagnose-contract.test.mjs` and `evals/interview-metrics.mjs`.
 */
export function seeksExactValue(text: string): boolean {
  return VALUE_ASK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Patterns for a question that ASKS THE OPERATOR TO READ FAULT CODES OFF THE
 * MACHINE, as opposed to merely mentioning codes.
 *
 * Narrower than `VALUE_ASK_PATTERNS` above on purpose: that list fires on the
 * bare noun, which is right for "strip the chips" and wrong here. "Did the
 * dealer clear the codes?" mentions codes and must not collect a clause about
 * reading them. So each pattern requires a request verb, an interrogative, or
 * an explicit display word.
 */
const CODE_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(?:what|which)\b[^?]{0,90}\bcodes?\b/i,
  /\b(?:any|there any)\b[^?]{0,60}\bcodes?\b/i,
  // Verb STEMS, not whole words. `\bpull\b` does not match "pulled" and
  // `\bscan\b` does not match "scanned" — the 2026-08-19 list was written with
  // whole words and so missed the single most common ask shape in the corpus.
  // See the audit note below.
  /\b(?:read|pull|scan|check|retriev|obtain)\w*\b[^?]{0,60}\bcodes?\b/i,
  // These two stay WHOLE WORDS on purpose. `list\w*` matches "is listed as",
  // which turned "do you know if the code E-1147 is LISTED as a pump
  // controller…" — a question about a code already in hand — into a false hit.
  /\b(?:list|display)\b[^?]{0,60}\bcodes?\b/i,
  // The categorical dash ask: "does the dash show … or an actual fault code?".
  // Requires an INDEFINITE reference between the verb and the noun, which is
  // what separates it from the six questions about a code already in hand that
  // this list correctly declines to match.
  /\bshow(?:s|ing)?\b[^?]{0,90}\b(?:an?|any|actual|specific)\b[^?]{0,30}\bcodes?\b/i,
  /\b(?:dtc|spn|fmi)s?\b/i,
];
// A display-verb pattern (`codes? … shown|showing|appear`) was drafted and cut:
// over the 1536 banked questions it matched nothing the four above did not,
// except one false positive — "when it goes soft, does the fault code E-1147
// APPEAR at the same time?", a timing question about a code already in hand.
//
// ⚠ CORRECTED 2026-08-19, second pass. Re-audited over all 1764 questions
// (1622 unique) in the 28 banked run dirs: the whole-word verb list above
// missed 24 distinct shapes of the form "has anyone CHECKED / PULLED / SCANNED
// for stored fault codes?" — the most common code ask in the corpus and,
// per `runs/2026-08-19-codes-postfix/scorecard.md`, the exact ask whose missing
// active-vs-stored clause the fix was written for. It also missed the three
// categorical dash asks the campaign counted as a separate failure mode.
// Corrected list: 71 hits, and every one of the 7 code-mentioning questions it
// declines names a code the operator already has in hand. The one residual
// false positive is the pre-existing, already-accepted `SPN` hit on "does the
// dash show the same SPN 636 code every single time it dies?".

/**
 * Does the ask ALREADY draw the distinction? Only if it names BOTH sides.
 *
 * An earlier draft excused any mention of "stored" or "active", which gutted
 * the fix: "are there any STORED fault codes?" is the single most common shape
 * in the corpus, and it presupposes one side rather than asking which. The ask
 * that genuinely does its own job names both — "any active or stored codes?" —
 * and that one is left exactly as the model wrote it.
 */
const CODE_STATUS_ACTIVE_SIDE = /\b(?:active|live|current(?:ly)?|right now|showing now|now)\b/i;
const CODE_STATUS_STORED_SIDE =
  /\b(?:stored|historical|history|logged|inactive|pending|past|previous|earlier)\b/i;

/**
 * The one clause the server appends. Operator language, present tense, no
 * jargon: a technician reads "active/stored", an operator reads "showing now".
 */
const CODE_STATUS_CLAUSE =
  " For each code, say whether it is showing now or stored from earlier.";

/**
 * Does this ask for codes without asking whether they are live?
 *
 * Measured 2026-08-15 over the code-bearing scenario set: the distinction was
 * asked in **0 of 12 runs**, and two reports went on to assert a status the
 * interview never established — a stale stored code read as a live fault is
 * the difference between "replace the sensor" and "clear it and drive it".
 *
 * The enforcement lives here rather than in `prompts.ts` for the same settled
 * reason the chip-strip rule does: restating a rule harder does not bind on
 * this model, and this is the one place questions are cleaned before either
 * production or the eval harness sees them.
 *
 * ⚠ This is the ONLY place the server authors question text rather than
 * cleaning it. Keep it to one appended sentence, keep the patterns narrow, and
 * re-run the free audit over the banked run dirs after any edit —
 * `evals/interview-metrics.mjs` prints every question this fires on.
 *
 * Exported for `tests/diagnose-contract.test.mjs` and the eval metrics.
 */
export function asksForCodeStatus(text: string): boolean {
  if (CODE_STATUS_ACTIVE_SIDE.test(text) && CODE_STATUS_STORED_SIDE.test(text)) return false;
  return raisesCodes(text);
}

/**
 * Does this question ask the operator to read fault codes off the machine at
 * all — however well or badly?
 *
 * This is `asksForCodeStatus` WITHOUT the both-sides exemption. An ask that
 * already names active and stored needs no appended clause but is still very
 * much a code ask, so the two predicates must not be the same function.
 *
 * ⚠ Unlike `seeksExactValue` and `asksForCodeStatus`, this one enforces
 * NOTHING. It is a pure measurement predicate, and it exists because the open
 * question it serves — "how many runs never raise fault codes at all?" — had
 * no mechanical definition and was counted by a human reading transcripts.
 * That count did not reproduce: the two banked scorecards disagree with each
 * other and with the artifacts, in opposite directions, because nobody wrote
 * down whether an unpicked CHIP offering "Engine fault code" counts as raising
 * one. It does not, here. **This predicate reads question TEXT only.**
 *
 * A warning-lamp question is deliberately NOT a code ask. Measured: c6 in
 * `runs/2026-08-15-codes-1` asked only "are there any warning lights or dash
 * messages showing", got an honest "No" because that machine's code came off a
 * dealer's reader rather than a lamp, and never learned the code existed.
 * Scoring that as a code ask would hide the exact defect this measures.
 *
 * Exported for `tests/diagnose-contract.test.mjs` and `evals/interview-metrics.mjs`.
 */
export function raisesCodes(text: string): boolean {
  return CODE_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

/** The question as the operator should see it: unchanged, or with the clause. */
export function withCodeStatus(text: string): string {
  if (!asksForCodeStatus(text)) return text;
  return `${text.replace(/\s+$/, "")}${CODE_STATUS_CLAUSE}`;
}

function coerceQuestion(raw: unknown): InterviewQuestion | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { text, options: [] } : null;
  }
  if (!raw || typeof raw !== "object") return null;

  const { text, options } = raw as { text?: unknown; options?: unknown };
  const cleanText = typeof text === "string" ? text.trim() : "";
  if (!cleanText) return null;

  // A code ask collects the active-vs-stored clause. Computed from the ORIGINAL
  // text, so the appended sentence can never feed back into either predicate.
  const askText = withCodeStatus(cleanText);

  // A value ask carries no chips at all. Dropping them here rather than in the
  // view means the eval harness and the FSM see the same free-text question the
  // operator does — `interview-machine.ts` treats `options: []` as free-text-only.
  if (seeksExactValue(cleanText)) return { text: askText, options: [] };

  const cleanOptions = Array.isArray(options)
    ? options
        .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
        .map((option) => option.trim())
        .filter((option) => !isUncheckedOption(option))
        .slice(0, MAX_OPTIONS_PER_QUESTION)
    : [];
  // A single surviving chip is not a choice — it reads as the expected answer and
  // biases toward itself. Drop the set and let the question stand as free text,
  // exactly as a value ask does above.
  return { text: askText, options: cleanOptions.length >= 2 ? cleanOptions : [] };
}

export function clean(value?: string): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function validateRequest(body: DiagnosisRequest): string | null {
  if (!body || (body.action !== "interview" && body.action !== "report")) {
    return "Choose a valid diagnostic action.";
  }

  const equipment = body.equipment;
  if (!equipment || !clean(equipment.year) || !clean(equipment.make) || !clean(equipment.model)) {
    return "Year, make, and model are required.";
  }
  if (!clean(body.problem)) return "Describe the machine problem before continuing.";

  const attachments = body.attachments ?? [];
  if (attachments.length > MAX_IMAGES) return `Attach no more than ${MAX_IMAGES} photos.`;
  for (const attachment of attachments) {
    if (!SUPPORTED_IMAGE_TYPES.includes(attachment.type?.toLowerCase?.() ?? "")) {
      return "Photos must be JPEG, PNG, or WebP files.";
    }
    if (
      typeof attachment.dataUrl !== "string" ||
      !attachment.dataUrl.startsWith(`data:${attachment.type};base64,`) ||
      attachment.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH
    ) {
      return "One of the attached photos is invalid or too large.";
    }
  }

  const attachmentNames = body.attachmentNames ?? [];
  if (attachmentNames.length > MAX_IMAGES) return `Attach no more than ${MAX_IMAGES} photos.`;
  if (attachmentNames.some((name) => typeof name !== "string" || name.length > 256)) {
    return "One of the attached photos has an unusable file name.";
  }

  const transcript = body.transcript ?? [];
  if (transcript.length > MAX_TRANSCRIPT_MESSAGES) {
    return "The interview is longer than this diagnostic session supports.";
  }
  if (
    transcript.some(
      (message) =>
        (message.role !== "assistant" && message.role !== "user") ||
        !clean(message.content) ||
        message.content.length > MAX_MESSAGE_LENGTH,
    )
  ) {
    return "The interview contains an invalid message.";
  }

  if (
    body.caseId !== undefined &&
    (typeof body.caseId !== "string" || !body.caseId.trim() || body.caseId.length > 128)
  ) {
    return "The diagnostic case reference is invalid.";
  }

  if (
    body.machineId !== undefined &&
    (typeof body.machineId !== "string" || !body.machineId.trim() || body.machineId.length > 128)
  ) {
    return "The machine reference is invalid.";
  }

  if (
    body.reportModel !== undefined &&
    !REPORT_MODEL_OPTIONS.includes(body.reportModel as ReportModel)
  ) {
    return "Choose a valid report thoroughness option.";
  }

  return null;
}

export function parseInterview(content: string): InterviewResult {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  try {
    const parsed = JSON.parse(
      firstBrace >= 0 && lastBrace > firstBrace
        ? normalized.slice(firstBrace, lastBrace + 1)
        : normalized,
    ) as { status?: unknown; message?: unknown; questions?: unknown };
    const status = parsed.status === "ready" ? "ready" : "needs_more_information";
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .map(coerceQuestion)
          .filter((question): question is InterviewQuestion => question !== null)
          .slice(0, 3)
      : [];
    const reasoning =
      typeof (parsed as { reasoning?: unknown }).reasoning === "string"
        ? (parsed as { reasoning: string }).reasoning.trim()
        : "";
    const message =
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : status === "ready"
          ? "I have enough information to prepare the field report."
          : "A little more detail will help narrow the likely causes.";
    return reasoning ? { status, message, questions, reasoning } : { status, message, questions };
  } catch {
    return {
      status: "needs_more_information",
      message: normalized.slice(0, 1_200),
      questions: [],
    };
  }
}

/**
 * The interview reply shape, for schema-constrained providers.
 * Mirrors the shape `INTERVIEW_SYSTEM_PROMPT` describes and `parseInterview`
 * reads; keep the three in step.
 */
export const INTERVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // `reasoning` is declared but NOT required: `additionalProperties: false`
  // would otherwise reject the field outright, and leaving it unrequired means
  // a prompt variant that drops it still validates.
  required: ["status", "message", "questions"],
  properties: {
    status: { type: "string", enum: ["needs_more_information", "ready"] },
    message: { type: "string" },
    reasoning: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "options"],
        properties: {
          text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
