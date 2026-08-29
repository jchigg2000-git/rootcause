"use client";

/* eslint-disable @next/next/no-img-element --
   The only images here are the brand-board icons, served from `public/icons`
   at their native 88px and displayed at 44px or less. They are a few KB each
   and never above the fold, so next/image's loader would add a request path
   and a runtime dependency for no measurable gain. */

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  type InterviewQuestion,
  type TranscriptMessage,
} from "./api/diagnose/contract";
import {
  INITIAL_INTERVIEW_STATE,
  answerSummary,
  answerText,
  composeReply,
  interviewReducer,
  isSettled,
  stageForPhase,
  atTranscriptCap,
  onLastTurn,
  stripComposedQuestions,
} from "./lib/interview-machine.ts";
import { useDefaultMachine } from "./lib/prefs.ts";
import {
  DEFAULT_MARKET,
  MACHINE_TYPES,
  MANUFACTURERS,
  machineTypeForModel,
  modelsForMake,
  parseModelYear,
  randomMachine,
} from "./lib/equipment-catalog.ts";
import { ComboField } from "./components/combobox.tsx";
import Link from "next/link";
import { Wordmark } from "./components/logo.tsx";
import type { MachineRecord } from "./api/inventory/contract.ts";

const MAX_IMAGE_MEGABYTES = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

// How long the "Generate field report" countdown estimates against. 100s is
// the measured medium-effort Sonnet case; a deeper model runs considerably
// longer, which is why this estimates against the low end rather than the
// worst case. The countdown switches to an
// indeterminate message past zero rather than sit at 0:00 for however much
// longer the request actually takes.
const REPORT_ESTIMATE_SECONDS = 100;

type EquipmentForm = {
  year: string;
  make: string;
  model: string;
  machineType: string;
  serialPin: string;
  hours: string;
  market: string;
  operatingConditions: string;
  recentWork: string;
  faultCodes: string;
  problem: string;
};

type PreparedAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

type SelectedImage = {
  file: File;
  previewUrl: string;
};

type InterviewResponse = {
  status: "needs_more_information" | "ready";
  message: string;
  questions: InterviewQuestion[];
  /** Wire-only; the reducer carries it into the transcript and the bubble
   *  strips it back off. Absent in production — see `contract.ts`. */
  reasoning?: string;
  caseId?: string;
};

/** The fields the server's fuzzy machine match keys on. */
const IDENTITY_FIELDS = new Set<keyof EquipmentForm>(["year", "make", "model", "serialPin"]);

/** How a saved machine reads in the picker. Matches /parts-lookup's list. */
const savedMachineLabel = (machine: MachineRecord) =>
  ([machine.year, machine.make, machine.model].filter(Boolean).join(" ") || machine.make) +
  (machine.label ? ` — ${machine.label}` : "");

const initialForm: EquipmentForm = {
  year: "",
  make: "",
  model: "",
  machineType: "",
  serialPin: "",
  hours: "",
  market: DEFAULT_MARKET,
  operatingConditions: "",
  recentWork: "",
  faultCodes: "",
  problem: "",
};

export function DiagnosticApp({
  userEmail,
  isAdmin,
}: {
  userEmail: string;
  isAdmin: boolean;
}) {
  // Everything the interview flow can be — phase, transcript, questions, chip
  // selections, error — lives in one reducer (app/lib/interview-machine.ts).
  // The handlers below only dispatch and run the network calls; every guard
  // against an illegal combination is in the machine itself.
  const [machine, dispatch] = useReducer(interviewReducer, INITIAL_INTERVIEW_STATE);
  const stage = stageForPhase(machine.phase);
  const awaiting = machine.phase === "awaiting-model";
  const readyForReport = machine.phase === "ready-for-report";
  // The interview has a hard 12-message ceiling the server enforces. Before
  // 2026-08-19 the client did not know it existed: the 7th send just 400'd and
  // "Try again" re-sent the same doomed transcript forever.
  const lastTurn = onLastTurn(machine);
  const turnsSpent = atTranscriptCap(machine);
  const canGenerate = readyForReport || turnsSpent;
  // The turn's questions are asked one at a time; `machine.cursor` is which.
  // The block stays mounted through awaiting-model and turn-failed with its
  // controls inert — `panelLive` is what disables them — so the layout never
  // jumps under a thumb mid-tap.
  const panelLive = machine.phase === "interviewing";
  const askIndex = machine.cursor;
  // A turn is in flight (or its call failed): the questions are still mounted
  // for layout, but TURN_SENT consumed the live arrays and reset the cursor,
  // so the panel must show the frozen sent view — deriving an "open question"
  // from the cursor here is what used to rewind the panel to a blank
  // Question 1 on every send.
  const sentTurn =
    (machine.phase === "awaiting-model" || machine.phase === "turn-failed") &&
    machine.questions.length > 0;
  const currentQuestion = machine.questions[askIndex] ?? null;
  // The question actually being asked right now. Null while a turn is in
  // flight — `currentQuestion` still resolves to the old turn's question 1
  // there, and binding the label, composer or send control to it re-creates
  // the rewound panel.
  const openQuestion = panelLive ? currentQuestion : null;
  // One past the last question: everything is settled and the send is armed.
  const reviewing = machine.questions.length > 0 && askIndex >= machine.questions.length;
  const [form, setForm] = useState<EquipmentForm>(initialForm);
  // Model suggestions follow whatever make (and, once typed, year) has been
  // entered so far. A partial or out-of-range year just narrows the
  // suggestion list to nothing — the field stays free text either way.
  const modelOptions = useMemo(() => modelsForMake(form.make, parseModelYear(form.year)), [form.make, form.year]);
  // Machine type autopopulates from a catalogued make + model, but never
  // overwrites a value the operator typed themselves — only a value this
  // effect set previously.
  const autoMachineTypeRef = useRef<string | null>(null);
  useEffect(() => {
    const inferred = machineTypeForModel(form.make, form.model);
    if (!inferred || inferred === form.machineType) return;
    if (form.machineType && form.machineType !== autoMachineTypeRef.current) return;
    autoMachineTypeRef.current = inferred;
    setForm((current) => ({ ...current, machineType: inferred }));
  }, [form.make, form.model, form.machineType]);
  const defaultMachine = useDefaultMachine();
  // Prefill from the per-browser default, but never clobber typing in progress.
  const [prefilled, setPrefilled] = useState(false);
  // The caller's saved machines, offered as a shortcut over section 01. The
  // picker is a shortcut on a form that works perfectly without it, so a
  // failed or empty load renders nothing at all rather than a broken control:
  // no error line above the Year field, and nothing for a first-time user
  // whose inventory is legitimately empty (the workspace nav already explains
  // where machines come from).
  const [savedMachines, setSavedMachines] = useState<MachineRecord[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [pickedMachineId, setPickedMachineId] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [reply, setReply] = useState("");
  // The ↑ arrow becomes the network Send in the same DOM position the moment
  // the last answer commits; this holds it disabled briefly so the second tap
  // of a double-tap cannot ship the turn before the review renders.
  // The ref mirrors the state for handlers that must not trust a stale closure.
  const [sendCooling, setSendCooling] = useState(false);
  const sendCoolingRef = useRef(false);
  // Intake-page concerns only — field validation, photo rejections, attachment
  // prep. Interview and report errors belong to the machine.
  const [intakeError, setIntakeError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const interviewInputRef = useRef<HTMLTextAreaElement>(null);
  // Whatever the operator should be reading right now — the open question, the
  // review heading, the sent-turn heading, or the readiness line. Focus lands
  // here rather than on the compose box between turns; see focusAskTarget.
  const askFocusRef = useRef<HTMLParagraphElement>(null);
  // The whole .ask-block, for two jobs. The post-turn scroll brings the
  // question into view WITH the error row above it and the compose row below
  // it — a bare focus() scrolls "nearest" on the <p> alone and can leave the
  // question flush at the viewport bottom with every control off-screen. And
  // the height ratchet floors the block as a unit, so a child unmounting at a
  // state swap (the rail at send, the error on retry) cannot yank the compose
  // row upward.
  const askSectionRef = useRef<HTMLDivElement>(null);
  // The visually-hidden polite live region, written imperatively — a text
  // change is an announcement; a re-render is not required for one. Two
  // writers: the phase effect (a new turn's preamble) and the walk effect,
  // when a typed commit keeps focus in the compose box so no focus event
  // will announce the next question.
  const liveRegionRef = useRef<HTMLSpanElement>(null);
  const announce = useCallback((text: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = text;
  }, []);

  /** Focus the walk's read target without the browser's implicit minimal
   *  scroll, then bring the whole ask block into view as one unit. */
  const focusAskTarget = useCallback(() => {
    const target = askFocusRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    const section = askSectionRef.current ?? target;
    const rect = section.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      section.scrollIntoView({ block: "nearest" });
    }
  }, []);
  // Belt to the reducer's braces: the reducer makes a racing send
  // unrepresentable in state, and this ref stops the duplicate fetch a
  // same-tick double submit would still fire before React re-renders.
  const requestInFlightRef = useRef(false);
  // The chip settle window — see the effect by sendCooling and the guard in
  // answerCurrent.
  const chipCoolingRef = useRef(false);

  const machineLabel = useMemo(
    () => [form.year, form.make, form.model].filter(Boolean).join(" "),
    [form.make, form.model, form.year],
  );

  // Whether the hours in the form came from the saved record rather than a
  // reading the operator just took.
  const hoursFromRecord = useMemo(
    () => savedMachines.some((saved) => saved.id === pickedMachineId && saved.currentHours !== null),
    [savedMachines, pickedMachineId],
  );

  // Ticks the countdown shown on the full-screen "generating" stage. Keyed
  // to the stage rather than a start-timestamp ref so it resets cleanly on
  // every entry, including a retry after a failed generation.
  useEffect(() => {
    if (stage !== "generating") return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      setGenerationElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [stage]);
  const generationRemaining = Math.max(REPORT_ESTIMATE_SECONDS - generationElapsed, 0);
  const generationProgress = Math.min(generationElapsed / REPORT_ESTIMATE_SECONDS, 1);

  // Adjusting state during render rather than in an effect: React discards the
  // in-progress render and redoes it before committing, so the form is never
  // painted empty and then refilled.
  if (!prefilled && Object.values(defaultMachine).some(Boolean)) {
    setPrefilled(true);
    setForm((current) => ({ ...current, ...defaultMachine, market: DEFAULT_MARKET }));
  }

  /**
   * Move focus to the new stage's heading on transition.
   *
   * Without this a screen-reader user gets no announcement that the screen
   * changed: the URL does not change, so there is no route announcement, and
   * focus stays on the button that triggered the swap — which has since been
   * unmounted, dropping focus to <body>. Skipped on first paint, where there
   * has been no transition to announce.
   */
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const reportFrameRef = useRef<HTMLIFrameElement>(null);
  const hasRenderedRef = useRef(false);
  useEffect(() => {
    if (!hasRenderedRef.current) {
      hasRenderedRef.current = true;
      return;
    }
    stageHeadingRef.current?.focus();
  }, [stage]);

  /**
   * Announce each step of the walk. Moving between questions changes neither
   * the URL nor the live region, so without this a screen-reader user taps a
   * chip and hears nothing at all — and a sighted operator who retracted an
   * answer gets no confirmation the cursor actually went back.
   *
   * Guarded on an actual change so it never re-steals focus on an unrelated
   * re-render, and skipped on the walk's own reset to 0 at TURN_SENT, which
   * runInterview's own focus call covers once the reply lands.
   */
  const cursorRef = useRef(machine.cursor);
  useEffect(() => {
    if (cursorRef.current === machine.cursor) return;
    const wasSend = machine.phase !== "interviewing";
    cursorRef.current = machine.cursor;
    if (wasSend) return;
    // A commit from the compose box means the operator is typing: stealing
    // focus to the question <p> closes the soft keyboard on every free-text
    // answer. Focus stays in the box — its label is already the next
    // question — and the live region announces the step, since no focus
    // event will.
    if (document.activeElement === interviewInputRef.current) {
      const next = machine.questions[machine.cursor];
      announce(next ? next.text : "All answered — check and send");
      return;
    }
    focusAskTarget();
  }, [machine.cursor, machine.phase, machine.questions, announce, focusAskTarget]);

  /**
   * Keep the newest turn against the bottom of the transcript. On a phone the
   * panel is a fixed-height pane and the transcript scrolls inside it, so
   * without this the latest message is the one clipped by the fold — the exact
   * opposite of what a scrolling conversation should show.
   */
  const messagesRef = useRef<HTMLDivElement>(null);
  // Layout effect, not a passive one: the pin must land in the same frame the
  // new content commits, or every turn boundary paints once at the old scroll
  // offset and then snaps.
  useLayoutEffect(() => {
    const region = messagesRef.current;
    if (!region) return;
    // A fresh case starts compact again.
    if (machine.transcript.length === 0) region.classList.remove("is-grown");
    region.scrollTop = region.scrollHeight;
    // Latch the pane at its cap the moment content actually fills it — at
    // that instant min-height == current height, so the reserve is applied
    // with ZERO visual delta, and every later send scrolls the region
    // instead of growing it under the ask block. A transcript-count
    // threshold was tried first and crossed itself on the first send — the
    // worst possible commit to add 46vh in. Imperative classList because
    // this is measured knowledge, not render state.
    if (region.scrollHeight > region.clientHeight) region.classList.add("is-grown");
  }, [machine.transcript.length, awaiting]);

  /**
   * Focus follows the turn lifecycle. Into awaiting-model with a sent turn
   * mounted: the frozen view's heading — sending disabled the control focus
   * was on, which otherwise drops focus to <body> for the whole call
   * — and the heading text announces the wait. Out of awaiting-model:
   * the new question, the failure heading, or the readiness line — on success
   * *and* failure, exactly as before. An effect rather than a timeout in
   * runInterview's finally, so it runs after the target has actually rendered.
   *
   * Deliberately NOT the compose box, which is where this used to go:
   * focusing a textarea on a phone opens the soft keyboard over the question
   * the operator has not read yet, on every single turn.
   */
  const prevPhaseRef = useRef(machine.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev === machine.phase) return;
    prevPhaseRef.current = machine.phase;
    if (machine.phase === "awaiting-model") {
      // From intake the stage-heading effect owns focus. From ANY other
      // phase, sending just disabled the control focus was on (or retry
      // unmounted the button under it), so the rescue must fire even when
      // the turn carried no questions — askFocusRef then points at the
      // readiness line, which is always mounted on this stage.
      if (prev !== "intake") focusAskTarget();
      return;
    }
    if (prev === "awaiting-model") {
      // Announce the new turn's preamble. `.messages` deliberately carries no
      // aria-live: announcing from the scrolling container re-read older
      // bubbles whenever stripComposedQuestions changed their rendered text,
      // and its aria-busy deferred the pending bubble into silence
      // entirely. The dedicated hidden node announces just the new
      // content; the question itself is announced by the focus move.
      const last = machine.transcript.at(-1);
      if (last?.role === "assistant") {
        announce(stripComposedQuestions(last.content, machine.questions));
      }
      focusAskTarget();
    }
  }, [machine.phase, machine.questions, machine.transcript, focusAskTarget, announce]);

  // Height ratchet on the whole ask block: it keeps the tallest height it
  // has reached, so a state swap — the review replacing a tall five-chip
  // question, the rail unmounting at send — can grow the panel but never
  // shrink it under a thumb mid-tap. The static CSS floor cannot know how
  // tall a turn's tallest state was, and the mobile override zeroed it on the
  // assumption of a bottom anchor this layout never had. The floor
  // CARRIES ACROSS question turns: it originally reset on every new turn's
  // questions, and that reset was measured as the biggest between-turns jump
  // — the block reshuffled to its new natural height the moment a reply
  // landed. It resets only when the walk UI itself is gone (ready-for-report,
  // or a fresh case) — holding a tall walk's floor under the bare readiness
  // line would pin a void with nothing left to keep still — and on
  // resize/orientation change, where a px floor measured in the old viewport
  // would hold a void open.
  const askFloorRef = useRef(0);
  const askFloorTurnRef = useRef<ReadonlyArray<InterviewQuestion>>(machine.questions);
  const remeasureAskFloor = useCallback(() => {
    const block = askSectionRef.current;
    if (!block) return;
    block.style.minHeight = "";
    const natural = block.offsetHeight;
    if (natural > askFloorRef.current) askFloorRef.current = natural;
    block.style.minHeight = `${askFloorRef.current}px`;
  }, []);
  useLayoutEffect(() => {
    if (askFloorTurnRef.current !== machine.questions) {
      askFloorTurnRef.current = machine.questions;
      if (machine.questions.length === 0) {
        // Releasing a tall walk's floor shortens the page by hundreds of px
        // in one frame, and the browser's scroll clamp turned that into the
        // biggest jump on the page: the compose row teleported ~590px up the
        // viewport the moment the model said it had enough. Give the scroll
        // back the same height the floor gave up, in the same layout pass,
        // and the compose row and the report action hold still while the
        // transcript's tail slides down into the freed space above them.
        const block = askSectionRef.current;
        const before = block?.offsetHeight ?? 0;
        askFloorRef.current = 0;
        remeasureAskFloor();
        const after = block?.offsetHeight ?? 0;
        // behavior: "instant", because html has scroll-behavior: smooth — a
        // bare scrollBy here starts an ANIMATED scroll that lands after the
        // paint (and loses to the focus effect's scrollIntoView), which is
        // no compensation at all.
        if (before > after) window.scrollBy({ top: after - before, behavior: "instant" });
        return;
      }
    }
    remeasureAskFloor();
  }, [machine.questions, machine.cursor, machine.phase, remeasureAskFloor]);
  useEffect(() => {
    const rebuild = () => {
      askFloorRef.current = 0;
      remeasureAskFloor();
    };
    window.addEventListener("resize", rebuild);
    window.addEventListener("orientationchange", rebuild);
    return () => {
      window.removeEventListener("resize", rebuild);
      window.removeEventListener("orientationchange", rebuild);
    };
  }, [remeasureAskFloor]);

  // Preview object URLs outlive their component unless we release them.
  const selectedImagesRef = useRef<SelectedImage[]>([]);
  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);
  useEffect(
    () => () => {
      for (const image of selectedImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    },
    [],
  );

  function updateField(field: keyof EquipmentForm, value: string) {
    // Editing an identity field means the form no longer describes the machine
    // that was picked, so the explicit link is dropped and the case files by
    // the server's fuzzy match instead. Hours and machine type deliberately do
    // not detach — hours is the field most likely corrected right after a pick.
    if (IDENTITY_FIELDS.has(field)) setPickedMachineId("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  /** Fill section 01 from a saved machine. Six fields, all still editable. */
  const applyPick = useCallback((picked: MachineRecord) => {
    setPickedMachineId(picked.id);
    setPrefilled(true);
    // A recorded machine type is operator data, not a catalog guess. Clearing
    // the ref makes the autopopulate effect's guard read it as hand-entered,
    // so it can never be overwritten; a blank type is left alone so that
    // effect still fills it in from make + model.
    if (picked.machineType) autoMachineTypeRef.current = null;
    setForm((current) => ({
      ...current,
      year: picked.year,
      make: picked.make,
      model: picked.model,
      machineType: picked.machineType,
      serialPin: picked.serialPin,
      // null means "not recorded" and must stay blank. Zero is a real reading.
      hours: picked.currentHours === null ? "" : String(picked.currentHours),
    }));
  }, []);

  function pickMachine(id: string) {
    // The placeholder detaches the case from the machine but deliberately does
    // NOT erase the fields: wiping six of them from a menu choice, with no
    // undo, is destructive, and the case still files correctly by match.
    if (!id) {
      setPickedMachineId("");
      return;
    }
    const picked = savedMachines.find((candidate) => candidate.id === id);
    if (picked) applyPick(picked);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/inventory");
        const payload = (await response.json()) as { machines?: MachineRecord[] };
        if (cancelled || !response.ok) return;
        const loaded = payload.machines ?? [];
        setSavedMachines(loaded);
        // Deep link from a machine card: /?machine=<id>. Plain window.location
        // rather than useSearchParams — a one-shot read on mount, not a
        // subscription. An id not in the caller's own list is silently
        // ignored, so not-yours reads exactly like not-exists.
        const wanted = new URLSearchParams(window.location.search).get("machine");
        const match = wanted ? loaded.find((candidate) => candidate.id === wanted) : undefined;
        if (match) applyPick(match);
      } catch {
        // The picker is a shortcut, not the input. Losing it is not worth an
        // error in front of an operator who has a machine to diagnose.
      } finally {
        if (!cancelled) setMachinesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPick]);

  // Same pathway as the machine-type autopopulate effect above: recorded as
  // an auto-set value so a later manual make/model edit still overrides it.
  // Admin-only (the button does not render for viewers, and the scenario API
  // is admin-gated): the machine fills instantly, then a Haiku call writes a
  // matching operator complaint into the problem field. A scenario failure
  // keeps the machine fill — the demo affordance degrades, never blocks.
  const [randomizing, setRandomizing] = useState(false);
  async function fillRandomMachine() {
    const machine = randomMachine();
    autoMachineTypeRef.current = machine.machineType;
    setForm((current) => ({ ...current, ...machine, problem: "" }));
    setRandomizing(true);
    try {
      const response = await fetch("/api/random-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(machine),
      });
      const payload = (await response.json()) as { scenario?: string };
      if (response.ok && payload.scenario) {
        setForm((current) =>
          current.make === machine.make && current.model === machine.model
            ? { ...current, problem: payload.scenario ?? "" }
            : current,
        );
      }
    } catch {
      // Scenario is a garnish; the machine fill above already landed.
    } finally {
      setRandomizing(false);
    }
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const remaining = MAX_IMAGES - selectedImages.length;
    const rejections: string[] = [];

    if (files.length > remaining) {
      rejections.push(`You can attach up to ${MAX_IMAGES} photos.`);
    }

    const accepted = files
      .slice(0, remaining)
      .filter((file) => {
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          rejections.push("Photos must be JPEG, PNG, or WebP files.");
          return false;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          rejections.push(`Each photo must be ${MAX_IMAGE_MEGABYTES} MB or smaller.`);
          return false;
        }
        return true;
      })
      .map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));

    setIntakeError([...new Set(rejections)].join(" "));
    setSelectedImages((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(index: number) {
    setSelectedImages((current) => {
      const image = current[index];
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function beginDiagnosis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIntakeError("");
    if (!form.year.trim() || !form.make.trim() || !form.model.trim() || !form.problem.trim()) {
      setIntakeError("Enter the year, make, model, and a description of the problem.");
      return;
    }

    // Attachments are prepared before the machine leaves intake, so a photo
    // that fails to read keeps the operator on the form it was picked from
    // rather than stranding them on an empty interview.
    setPreparing(true);
    try {
      const prepared = await Promise.all(
        selectedImages.map(async ({ file }) => ({
          name: file.name,
          type: file.type,
          dataUrl: await readAsDataUrl(file),
        })),
      );
      setAttachments(prepared);
      dispatch({ type: "INTERVIEW_STARTED" });
      await runInterview([], prepared);
    } catch (requestError) {
      setIntakeError(errorMessage(requestError));
    } finally {
      setPreparing(false);
    }
  }

  async function runInterview(
    messages: TranscriptMessage[],
    preparedAttachments = attachments,
  ) {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      const response = await diagnose<InterviewResponse>(
        "interview",
        messages,
        preparedAttachments,
        // The model has already seen the photos by the second turn. Re-sending
        // megabytes of base64 on every reply buys nothing and is billed.
        messages.length === 0,
      );
      dispatch({
        type: "ASSISTANT_REPLIED",
        status: response.status,
        message: response.message,
        questions: response.questions,
        reasoning: response.reasoning,
        caseId: response.caseId,
      });
    } catch (requestError) {
      dispatch({ type: "REQUEST_FAILED", error: errorMessage(requestError) });
    } finally {
      requestInFlightRef.current = false;
      // Focus movement lives in the phase-transition effect above — it fires
      // after the reply's (or the error's) focus target has rendered.
    }
  }

  async function submitReply() {
    // Chips, per-question answers, and typed text ride the same pipeline:
    // whatever is selected plus whatever was typed becomes the one outgoing turn.
    const content = composeReply(machine.questions, machine.selections, machine.typedAnswers, reply);
    if (!content || awaiting || requestInFlightRef.current || sendCoolingRef.current) return;
    dispatch({ type: "TURN_SENT", content });
    setReply("");
    await runInterview([...machine.transcript, { role: "user", content }]);
  }

  // Arms the send cooldown when the walk hands the ↑ control its second
  // meaning (last answer committed → review). Cleared early if a question
  // reopens. The chip path is protected by design — the last chip tap lands
  // in review instead of sending; this gives the arrow/Enter path the same
  // guard against a double-tap reaching the network.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    const isOpen = panelLive && machine.cursor < machine.questions.length;
    wasOpenRef.current = isOpen;
    if (!wasOpen || isOpen || !panelLive) return;
    sendCoolingRef.current = true;
    setSendCooling(true);
    const timer = window.setTimeout(() => {
      sendCoolingRef.current = false;
      setSendCooling(false);
    }, 400);
    return () => {
      window.clearTimeout(timer);
      sendCoolingRef.current = false;
      setSendCooling(false);
    };
  }, [panelLive, machine.cursor, machine.questions.length]);

  // Arms the chip settle window whenever the question under the thumb
  // changes — a commit advancing the walk, a retract, a new turn landing.
  // Ref only, no state: dropping a tap needs no re-render.
  useEffect(() => {
    if (!panelLive) return;
    chipCoolingRef.current = true;
    const timer = window.setTimeout(() => {
      chipCoolingRef.current = false;
    }, 250);
    return () => {
      window.clearTimeout(timer);
      chipCoolingRef.current = false;
    };
  }, [panelLive, askIndex]);

  /**
   * A short haptic tick on a committed answer. Gloved or greasy hands feel a
   * tap land before they see it, and this is the only confirmation that
   * survives a screen the operator is not looking straight at. Unsupported on
   * every iOS browser, which is why nothing depends on it — the answer also
   * appears in the progress rail immediately.
   */
  function tick() {
    try {
      navigator.vibrate?.(8);
    } catch {
      // Best-effort only; a blocked or missing vibrate is not an error.
    }
  }

  /**
   * Tap-to-submit: a chip commits its question and the walk advances, in one
   * gesture. Called with no option by the send arrow, which commits whatever
   * the operator typed instead — the reducer keeps the field it is not given,
   * so a chip tapped over a typed qualifier sends both as one answer.
   */
  function answerCurrent(option?: string) {
    if (!panelLive || !openQuestion) return;
    // Chips hold still between questions now (the question box reserves two
    // lines and the compose row is pinned), which means a double-tap lands on
    // the NEXT question's chip in the same spot — and tap-to-submit would
    // commit it as that question's answer. A tap arriving inside the settle
    // window is the tail of the previous gesture, not a considered answer to
    // a question that has been readable for a quarter second. The send arrow
    // path (option === undefined) has its own cooldown.
    if (option !== undefined && chipCoolingRef.current) return;
    // Tick only when the reducer will accept the commit — a haptic confirming
    // a rejected empty submit is worse than none for an operator answering by
    // feel. Mirrors the reducer's own accept rule.
    const accepts =
      option !== undefined ||
      machine.selections[askIndex] != null ||
      (machine.typedAnswers[askIndex] ?? "").trim() !== "";
    if (accepts) tick();
    dispatch({ type: "QUESTION_ANSWERED", questionIndex: askIndex, option });
  }

  function skipCurrent() {
    if (!panelLive || !openQuestion) return;
    dispatch({ type: "QUESTION_SKIPPED", questionIndex: askIndex });
  }

  /** The escape hatch for an option set that has no right answer.
   *
   *  Measured 2026-08-15: when the machine's true state is absent from the
   *  chips, the operator takes the nearest one and the report then recommends
   *  the opposite repair (the c3 track-tension case — the true state was
   *  "tighter", the chips offered only looser/same). The app has ALWAYS welded
   *  typed text onto a chip and has always had Skip, but nothing on screen said
   *  typing was allowed, so nobody typed.
   *
   *  It deliberately dispatches NOTHING. `QUESTION_ANSWERED` rejects an option
   *  the question never offered (see `QUESTION_ANSWERED`) so a sentinel is not
   *  available, and `QUESTION_SKIPPED` both wipes the typed answer and advances
   *  the cursor — the opposite of what "let me type instead" means. Moving focus
   *  is the whole behaviour.
   *
   *  Opening the soft keyboard here is intended, and is the one place in this
   *  panel where it is: every other focus path avoids the textarea precisely
   *  because the keyboard covers the unread question. This is an explicit tap
   *  that asks for it. */
  function typeInsteadOfChip() {
    if (!panelLive || !openQuestion) return;
    interviewInputRef.current?.focus();
  }

  /** Retract. Nothing has left the browser yet, so any answer in this turn is
   *  still the operator's to change — right up until the turn sends. */
  function reopenQuestion(index: number) {
    if (!panelLive) return;
    dispatch({ type: "QUESTION_REOPENED", questionIndex: index });
  }

  // While a question is open the compose box IS that question's answer field,
  // so it binds to the reducer. In the review state and at ready-for-report
  // there is no open question and it holds the trailing free-text note.
  const composerValue = openQuestion ? machine.typedAnswers[askIndex] ?? "" : reply;

  function setComposer(next: string) {
    if (openQuestion) {
      dispatch({ type: "ANSWER_TYPED", questionIndex: askIndex, text: next });
      return;
    }
    setReply(next);
  }

  const pendingTurn = composeReply(machine.questions, machine.selections, machine.typedAnswers, reply);
  // Armed exactly when the reducer would accept the gesture: typed text OR an
  // existing selection — a reopened question with its chip still picked
  // commits on ↑/Enter, so the arrow must not claim otherwise.
  const composerArmed = openQuestion
    ? composerValue.trim().length > 0 || machine.selections[askIndex] != null
    : pendingTurn.length > 0;

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (awaiting) return;
    // The same control means "answer this question" while the walk is running
    // and "send the turn" once every question is settled. Only the second one
    // reaches the network, which is why the last chip tap does not send: it
    // lands in the review state, leaving the send a second, deliberate act.
    if (openQuestion) {
      answerCurrent();
      return;
    }
    await submitReply();
  }

  function handleReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      // On a touch keyboard Return means "new line": Shift+Enter does not
      // exist there, and committing mid-sentence also collapses the keyboard
      // under the operator. Enter-to-answer stays a hardware-keyboard shortcut.
      if (window.matchMedia("(pointer: coarse)").matches) return;
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  /**
   * The keyboard path, live whenever focus is inside the ask block but not in
   * the compose box. `1`–`9` picks that chip — the numbers are printed on the
   * chips, so it needs no explaining — and any other printable character means
   * the operator wants to type, so it opens the compose box carrying the
   * character rather than swallowing the first letter of their answer.
   */
  function handleAskKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!panelLive || !openQuestion) return;
    // A held key must never commit more than one answer. preventDefault does
    // not stop OS auto-repeat, and because a chip press advances the cursor,
    // every repeat would answer the NEXT question with the same position —
    // holding "2" walks the whole turn, picking options[1] each time.
    if (event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;

    // Digits pick a chip only while focus is on a CHIP, where the printed
    // number badge makes the mapping visible. From anywhere else — the focused
    // question especially — an answer that STARTS with a digit ("2 gallons a
    // minute") must fall through and type, not silently commit chip 2 and
    // advance (WCAG 2.1.4 wants single-key shortcuts focus-scoped).
    //
    // Scoped to `.ask-chip` rather than the `.ask-options` group it lives in:
    // the group also holds the unnumbered "None of these — type it" escape
    // hatch, and a digit pressed there is the first character of the value
    // the operator came to type — committing a chip would be the exact
    // substitution that control exists to prevent.
    if (/^[1-9]$/.test(event.key) && target?.closest(".ask-chip")) {
      const option = openQuestion.options[Number(event.key) - 1];
      if (!option) return;
      event.preventDefault();
      answerCurrent(option);
      return;
    }

    if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      interviewInputRef.current?.focus();
      setComposer(composerValue + event.key);
    }
  }

  // Retry re-sends the transcript exactly as it stands — the failed turn's
  // user message is already in it. Attachments still ride only when the case
  // has no messages yet, i.e. when it is the first call being retried.
  async function retryTurn() {
    if (machine.phase !== "turn-failed" || turnsSpent || requestInFlightRef.current) return;
    dispatch({ type: "RETRY_REQUESTED" });
    await runInterview(machine.transcript);
  }

  async function generateReport() {
    // Mirrors the reducer's REPORT_REQUESTED guard: normally the model's call,
    // and at the transcript cap the only terminal state left.
    if (!canGenerate || requestInFlightRef.current) return;
    dispatch({ type: "REPORT_REQUESTED" });
    setGenerationElapsed(0);
    requestInFlightRef.current = true;
    try {
      const response = await diagnose<{ html: string }>(
        "report",
        machine.transcript,
        attachments,
        true,
      );
      dispatch({ type: "REPORT_RENDERED", html: response.html });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      // The machine falls back to ready-for-report: the transcript is intact
      // and "Generate field report" is right there to retry.
      dispatch({ type: "REQUEST_FAILED", error: errorMessage(requestError) });
    } finally {
      requestInFlightRef.current = false;
    }
  }

  async function diagnose<T>(
    action: "interview" | "report",
    messages: TranscriptMessage[],
    preparedAttachments: PreparedAttachment[],
    includeAttachments: boolean,
  ): Promise<T> {
    const response = await fetch("/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        equipment: {
          year: form.year,
          make: form.make,
          model: form.model,
          machineType: form.machineType,
          serialPin: form.serialPin,
          hours: form.hours,
          market: form.market,
          operatingConditions: form.operatingConditions,
          recentWork: form.recentWork,
          faultCodes: form.faultCodes,
        },
        problem: form.problem,
        attachments: includeAttachments ? preparedAttachments : [],
        attachmentNames: preparedAttachments.map((attachment) => attachment.name),
        transcript: messages,
        caseId: machine.caseId,
        // Only ever set by picking a saved machine, and cleared the moment an
        // identity field is edited (see updateField) — so it can never claim a
        // machine the form no longer describes.
        machineId: pickedMachineId || undefined,
      }),
    });

    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "The diagnostic request failed.");
    return payload;
  }

  function downloadReport() {
    const blob = new Blob([machine.reportHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(machineLabel)}-diagnostic-field-report.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // The report document owns its own print button (report-template.ts) so a
  // downloaded, standalone file still has one — this drives that same
  // window.print() from the app toolbar so it's not buried in the sidebar.
  // The frame is sandboxed without allow-same-origin, so contentWindow.print()
  // itself throws a SecurityError from here; postMessage is the one channel
  // a cross-origin sandboxed frame still allows, and the frame's own script
  // listens for it.
  function printReport() {
    reportFrameRef.current?.contentWindow?.postMessage("rootcause:print", "*");
  }

  return (
    <main className={`app-shell stage-${stage}`}>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="RootCause HME home">
          <Wordmark />
        </Link>
        <span className="header-context">Heavy equipment diagnostics</span>
        <nav className="header-account" aria-label="Account">
          <span className="header-user" title={isAdmin ? "Administrator" : "Viewer"}>
            {userEmail}
          </span>
          {isAdmin && <a href="/observability">Observability</a>}
          <a href="/settings">Settings</a>
          <button
            type="button"
            onClick={() => {
              // Full load for the same reason as the sign-in redirect: the
              // session cookie is gone once logout resolves, and a client-side
              // navigation would leave the signed-in tree mounted.
              void fetch("/api/auth/logout", { method: "POST" }).finally(() =>
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign("/login"),
              );
            }}
          >
            Sign out
          </button>
        </nav>
      </header>

      {stage === "intake" && (
        <>
          {/* Compact identity band, not a marquee. The hero spent far more
              vertical space than it conveyed, and the proof pills in it carried
              nothing. Both are gone; the note's one useful fact (required vs.
              merely helpful fields) moved into the intake section heading
              below. */}
          <section className="hero" id="top">
            <p className="eyebrow">Field diagnostic assistant</p>
            <h1>Find the real problem. <em>Fix it right.</em></h1>
            <p className="hero-lede">
              Describe the machine and what it is doing. A short, photo-aware
              interview prepares an evidence-led field report.
            </p>
          </section>

          {/* Entry points for the two saved-data pages plus the PIN spec
              lookup. These are separate pages and deliberately NOT header
              links — the header is for account details. Spec lookup moved up
              here from the Describe step so it sits beside the report library
              and machine inventory. */}
          <nav className="workspace" aria-label="Saved records and spec lookup">
            <a href="/library">
              <img src="/icons/reports.png" width={26} height={26} alt="" />
              <strong>Report library</strong>
              <span>Every diagnosis you have run—reopen it, or download it again.</span>
              <b className="go" aria-hidden="true">→</b>
            </a>
            <a href="/inventory">
              <img src="/icons/maintenance.png" width={26} height={26} alt="" />
              <strong>Machine inventory</strong>
              <span>Your machines: PIN, current hours, and the work already done.</span>
              <b className="go" aria-hidden="true">→</b>
            </a>
            <a href="/spec-lookup">
              <img src="/icons/optimize.png" width={26} height={26} alt="" />
              <strong>Spec lookup by PIN</strong>
              <span>Only have a PIN? Identify the machine and pull its specs.</span>
              <b className="go" aria-hidden="true">→</b>
            </a>
          </nav>

          <section className="intake-section" aria-labelledby="intake-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Machine intake</p>
                <h2 id="intake-title">Tell us what is in front of you.</h2>
              </div>
              <p><span>Required *</span> — year, make, model, and the problem. Serial/PIN, hours, and recent work sharpen the report.</p>
            </div>

            {/* Brand-board icon set, used as drawn. The art is black line work,
                so it only reads on the light surfaces — never on the chrome.
                One slim procedure strip, not three cards: those were too big
                below the intake heading and forced
                needless scrolling. Spec lookup moved up to the workspace nav. */}
            <ol className="workflow" aria-label="How a diagnosis runs">
              <li>
                <img src="/icons/diagnose.png" width={24} height={24} alt="" />
                <strong><i aria-hidden="true">01</i> Describe</strong>
                <span>Machine, symptom, and any photos you have.</span>
              </li>
              <li>
                <img src="/icons/find-root-cause.png" width={24} height={24} alt="" />
                <strong><i aria-hidden="true">02</i> Find the root cause</strong>
                <span>A short interview narrows the fault path.</span>
              </li>
              <li>
                <img src="/icons/repair.png" width={24} height={24} alt="" />
                <strong><i aria-hidden="true">03</i> Repair with evidence</strong>
                <span>Ranked causes, confirmation tests, and what not to replace.</span>
              </li>
            </ol>

            <form className="intake-form" onSubmit={beginDiagnosis}>
              <fieldset className="form-block identity-block">
                <legend><span>01</span> Machine identity</legend>
                {isAdmin && (
                  <div className="identity-actions">
                    <button
                      type="button"
                      className="randomize-button"
                      disabled={randomizing}
                      onClick={() => void fillRandomMachine()}
                    >
                      {randomizing ? "Writing a scenario…" : "Randomize machine"}
                    </button>
                  </div>
                )}
                {/* Renders only once machines are known to exist: a first-time
                    operator with an empty inventory sees no picker at all,
                    rather than a control that explains why it is useless. */}
                {!machinesLoading && savedMachines.length > 0 && (
                  <div className="machine-picker">
                    <label className="field">
                      <span>Use a saved machine</span>
                      <select
                        value={pickedMachineId}
                        onChange={(event) => pickMachine(event.target.value)}
                      >
                        <option value="">Pick a machine…</option>
                        {savedMachines.map((saved) => (
                          <option key={saved.id} value={saved.id}>
                            {savedMachineLabel(saved)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="machine-picker-divider">
                      <span>or enter a machine below</span>
                    </p>
                  </div>
                )}
                <div className="field-grid primary-fields">
                  <Field label="Year" required>
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      value={form.year}
                      onChange={(event) => updateField("year", event.target.value)}
                      placeholder="2014"
                      required
                    />
                  </Field>
                  <ComboField
                    label="Make"
                    required
                    options={MANUFACTURERS}
                    value={form.make}
                    onChange={(next) => updateField("make", next)}
                    placeholder="John Deere"
                  />
                  {/* Options are empty for a make we carry no models for, and
                      the combobox renders a plain input in that case rather
                      than an openable list with nothing in it. */}
                  <ComboField
                    label="Model"
                    required
                    options={modelOptions}
                    value={form.model}
                    onChange={(next) => updateField("model", next)}
                    placeholder="350G LC"
                  />
                </div>
                <div className="field-grid secondary-fields">
                  <ComboField
                    label="Machine type"
                    options={MACHINE_TYPES}
                    value={form.machineType}
                    onChange={(next) => updateField("machineType", next)}
                    placeholder="Excavator"
                  />
                  <Field label="Serial / PIN">
                    <input value={form.serialPin} onChange={(event) => updateField("serialPin", event.target.value)} placeholder="If available" />
                  </Field>
                  {/* Saved hours are last visit's reading, and the report
                      prompt states them as current fact — the one way a pick
                      can make a report wrong rather than merely thin. */}
                  <Field
                    label="Hours"
                    hint={hoursFromRecord ? "From your saved record — update if the meter has moved." : undefined}
                  >
                    <input inputMode="decimal" value={form.hours} onChange={(event) => updateField("hours", event.target.value)} placeholder="6,850" />
                  </Field>
                  <Field label="Country / market" hint="Pinned to United States for now.">
                    <input value={form.market} disabled />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="form-block problem-block">
                <legend><span>02</span> Reported problem</legend>
                <Field label="What is the machine doing?" required hint="Include warning messages, fault codes, sounds, temperatures, leaks, or when the symptom appears.">
                  <textarea
                    className="problem-input"
                    value={form.problem}
                    onChange={(event) => updateField("problem", event.target.value)}
                    placeholder="Example: After 20–30 minutes of digging, hydraulic functions slow down and the oil temperature warning appears..."
                    required
                  />
                </Field>
                <div className="field-grid detail-fields">
                  {/* Asked here rather than mid-interview: 69% of measured runs
                      never raised codes at all, and round 1 is always already
                      full at three questions, so there was no slot to take. An
                      input, not a textarea — a code is short, and the two
                      fields below it are the prose ones. */}
                  <Field
                    label="Fault codes"
                    hint="Exactly as shown, and whether each one is showing now or stored from earlier. &ldquo;None&rdquo; and &ldquo;haven&rsquo;t checked&rdquo; are useful answers too."
                  >
                    <input
                      value={form.faultCodes}
                      onChange={(event) => updateField("faultCodes", event.target.value)}
                      placeholder="SPN 3251 FMI 16 — showing now"
                    />
                  </Field>
                  <Field label="Operating conditions">
                    <textarea value={form.operatingConditions} onChange={(event) => updateField("operatingConditions", event.target.value)} placeholder="Load, weather, terrain, duty cycle..." />
                  </Field>
                  <Field label="Recent repairs or maintenance">
                    <textarea value={form.recentWork} onChange={(event) => updateField("recentWork", event.target.value)} placeholder="Fluids, filters, parts, calibration..." />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="form-block photo-block">
                <legend><span>03</span> Photos <small>optional</small></legend>
                <label className="photo-picker">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={selectImages}
                  />
                  <span className="photo-plus" aria-hidden="true">+</span>
                  <span>
                    <strong>Add machine photos</strong>
                    <small>JPEG, PNG, or WebP · up to {MAX_IMAGES} photos · {MAX_IMAGE_MEGABYTES} MB each</small>
                  </span>
                </label>
                {selectedImages.length > 0 && (
                  <div className="photo-grid" aria-label="Selected photos">
                    {selectedImages.map((image, index) => (
                      <figure className="photo-preview" key={`${image.file.name}-${image.file.lastModified}`}>
                        {/* A blob: preview URL; next/image cannot load one anyway. */}
                        <img src={image.previewUrl} alt={`Selected attachment ${index + 1}`} />
                        <figcaption title={image.file.name}>{image.file.name}</figcaption>
                        <button type="button" onClick={() => removeImage(index)} aria-label={`Remove ${image.file.name}`}>×</button>
                      </figure>
                    ))}
                  </div>
                )}
              </fieldset>

              {intakeError && <p className="form-error" role="alert">{intakeError}</p>}

              <div className="form-submit">
                <p><span aria-hidden="true">!</span> Stop work and follow the manufacturer&apos;s safety procedures for any unsafe condition.</p>
                <button className="primary-button" type="submit" disabled={preparing}>
                  {preparing ? "Reviewing details…" : "Begin diagnosis"}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      {stage === "interview" && (
        <section className="interview-page" id="top" aria-labelledby="interview-title">
          <div className="interview-heading">
            <div>
              <p className="eyebrow">Diagnostic interview</p>
              <h1 id="interview-title" ref={stageHeadingRef} tabIndex={-1}>Narrowing the fault path.</h1>
              <p>Answer what you can. If a detail is unavailable, say so—the report will record the gap.</p>
            </div>
            <div className="machine-plaque">
              <span>Machine</span>
              <strong>{machineLabel}</strong>
              <small>{form.serialPin ? `PIN ${form.serialPin}` : "Serial / PIN not provided"}</small>
            </div>
          </div>

          <div className="interview-layout">
            <aside className="case-summary" aria-label="Case summary">
              <div className="case-index">CASE 01</div>
              <h2>Reported condition</h2>
              <p>{form.problem}</p>
              <dl>
                <div><dt>Photos</dt><dd>{attachments.length || "None"}</dd></div>
                <div><dt>Hours</dt><dd>{form.hours || "Not provided"}</dd></div>
                <div><dt>Market</dt><dd>{form.market || "Not provided"}</dd></div>
              </dl>
              <p className="case-caution"><span aria-hidden="true">!</span> Do not operate an unsafe machine while waiting for the report.</p>
            </aside>

            <div className="conversation-panel">
              <div className="conversation-status">
                <span className={awaiting ? "status-dot is-working" : "status-dot"} aria-hidden="true" />
                {/* role="status" so the wait is announced the moment it starts
                    — the transcript region cannot do it, see the live-region
                    note on the announcement effect. */}
                <span role="status">
                  {awaiting
                    ? "Reviewing evidence"
                    : machine.phase === "turn-failed"
                      ? "Interview interrupted"
                      : readyForReport
                        ? "Ready for report"
                        : "Interview active"}
                </span>
              </div>

              {/* The one place new assistant content is announced from,
                  written imperatively via `announce`. */}
              <span className="visually-hidden" aria-live="polite" ref={liveRegionRef} />

              {/* No aria-live here — see the announcement effect. The scroll
                  effect latches `is-grown` imperatively the moment content
                  fills the cap, reserving the pane so later sends scroll it
                  instead of growing it under the ask block. */}
              <div className="messages" ref={messagesRef}>
                {machine.transcript.map((message, index) => {
                  // The open turn's questions are asked one at a time below,
                  // so the bubble shows only the preamble. Printing all three
                  // here would duplicate the ask and hand back the wall of
                  // questions the one-at-a-time walk exists to break up.
                  // Earlier turns keep theirs: those are answered history, and
                  // the operator's reply reads as nonsense without them.
                  const isOpenTurn =
                    message.role === "assistant" && index === machine.transcript.length - 1;
                  const body = isOpenTurn
                    ? stripComposedQuestions(message.content, machine.questions)
                    : message.content;
                  if (!body) return null;
                  return (
                    <div className={`message ${message.role === "assistant" ? "assistant-message" : "user-message"}`} key={`${message.role}-${index}`}>
                      <span className="message-label">{message.role === "assistant" ? "RootCause" : "You"}</span>
                      <p>{body}</p>
                    </div>
                  );
                })}
                {awaiting && (
                  <div className="message assistant-message loading-message">
                    <span className="message-label">RootCause</span>
                    <p>
                      {machine.transcript.length === 0
                        ? "Reviewing the machine details and photos"
                        : "Working through your answer"}
                    </p>
                  </div>
                )}
              </div>

              {/* One question at a time, with the answers immediately above
                  the box that types them.

                  The block stays mounted while the model responds — it shows
                  the frozen sent view with its controls inert — so it never
                  unmounts under a thumb mid-tap, and the compose row holds the
                  same position in every state so the send control is never
                  somewhere new. The block sits in normal flow: sticky was
                  tried at 390×760 and rejected (measured 2026-08-07);
                  the height ratchet on the section keeps state swaps from
                  yanking the compose row instead. */}
              <div className="ask-block" ref={askSectionRef} onKeyDown={handleAskKeyDown}>
                {machine.error && (
                  <div className="conversation-error">
                    <p className="form-error" role="alert">{machine.error}</p>
                    {machine.phase === "turn-failed" && !turnsSpent && (
                      <button type="button" className="ghost-button" onClick={() => void retryTurn()}>
                        Try again
                      </button>
                    )}
                  </div>
                )}

                {/* The progress rail doubles as the retract control: every
                    settled question is a button back to itself. Hidden for a
                    single-question turn, where it would only ever say "1".
                    While a turn is in flight it stays in the layout but goes
                    invisible — the sent view lists every answer itself, and a
                    rail derived from the cleared arrays would animate its own
                    wipe — rendered from the same sentSummaries
                    snapshot the sent view uses, so its geometry is exactly
                    the review state's and neither the send nor the reply
                    landing moves the content below it by the rail's height. */}
                {machine.questions.length > 1 && (
                  <ol className={sentTurn ? "ask-track is-held" : "ask-track"}>
                    {machine.questions.map((question, index) => {
                      const settled = sentTurn || isSettled(machine, index);
                      const current = !sentTurn && index === askIndex;
                      const summary = sentTurn
                        ? machine.sentSummaries[index] ?? "Not answered"
                        : answerSummary(machine, index);
                      return (
                        <li key={question.text}>
                          <button
                            type="button"
                            className={`ask-pill${current ? " is-current" : ""}${settled ? " is-settled" : ""}${machine.skipped[index] ? " is-skipped" : ""}`}
                            disabled={!panelLive || !settled || current}
                            aria-current={current ? "step" : undefined}
                            aria-label={
                              settled
                                ? `Question ${index + 1}, answered ${summary}. Change it.`
                                : `Question ${index + 1}, not answered yet`
                            }
                            onClick={() => reopenQuestion(index)}
                          >
                            <b aria-hidden="true">{index + 1}</b>
                            <span aria-hidden="true">{settled ? summary : current ? "Now" : "—"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {sentTurn ? (
                  /* The frozen sent view. The live arrays cleared at
                     TURN_SENT, so this renders from the sentSummaries
                     snapshot: what was just sent, held still for the whole
                     round trip — never a rewound, blanked Question 1. On
                     failure it is also the resting state, and it says the
                     answers are intact. */
                  <div className="ask-review is-sent">
                    <p className="ask-step" ref={askFocusRef} tabIndex={-1}>
                      {machine.phase === "turn-failed"
                        ? "Send failed — your answers are safe"
                        : "Sent — waiting for the next question"}
                    </p>
                    <ul className="ask-answers">
                      {machine.questions.map((question, index) => (
                        <li key={question.text}>
                          <span className="ask-answer-q">{question.text}</span>
                          <strong
                            className={`ask-answer-a${machine.sentSummaries[index] === "Skipped" ? " is-skipped" : ""}`}
                          >
                            {machine.sentSummaries[index] ?? "Not answered"}
                          </strong>
                        </li>
                      ))}
                    </ul>
                    {awaiting && (
                      /* The busy affordance IN the block the operator is
                         looking at — the status bar and loading bubble can
                         both be off-screen on a phone. */
                      <p className="ask-sent-note">Working through your answers</p>
                    )}
                  </div>
                ) : openQuestion ? (
                  <div className="ask-current">
                    <p className="ask-step" id="ask-step">
                      {machine.questions.length > 1
                        ? `Question ${askIndex + 1} of ${machine.questions.length}`
                        : "One question"}
                    </p>
                    {/* Takes focus on every step of the walk, so the question
                        is announced and the soft keyboard stays shut. Keyed by
                        index so React mounts a fresh node per question: reusing
                        one node means re-focusing an element that is already
                        focused, which fires no focus event and announces
                        nothing — reachable via the 1–9 keyboard path, where
                        focus is on this <p> when the answer commits. The
                        describedby adds the step count and the nothing-sends
                        tip to that announcement. */}
                    <p
                      className="ask-question"
                      key={askIndex}
                      ref={askFocusRef}
                      tabIndex={-1}
                      aria-describedby="ask-step ask-tip"
                    >
                      {openQuestion.text}
                    </p>
                    {openQuestion.options.length > 0 && (
                      <div className="ask-options" role="group" aria-label="Answer options">
                        {openQuestion.options.map((option, position) => (
                          <button
                            type="button"
                            key={option}
                            className={`ask-chip${machine.selections[askIndex] === option ? " is-picked" : ""}`}
                            // Only ever true on a question the operator went
                            // back to. Without it the recorded answer is
                            // announced identically to the others, and the
                            // .is-picked styling is colour alone.
                            aria-pressed={machine.selections[askIndex] === option}
                            disabled={!panelLive}
                            onClick={() => answerCurrent(option)}
                          >
                            <b aria-hidden="true">{position + 1}</b>
                            <span>{option}</span>
                          </button>
                        ))}
                        {/* Inside the grid, spanning it, because the operator's
                            mental model is "one more option" — that is the
                            whole point. Rendered under exactly the same
                            condition as the chips it escapes, so it never
                            mounts or unmounts inside a question and cannot
                            reflow the block under a thumb. */}
                        <button
                          type="button"
                          className="ask-escape"
                          disabled={!panelLive}
                          onClick={typeInsteadOfChip}
                        >
                          None of these — type it
                        </button>
                      </div>
                    )}
                    <div className="ask-aside">
                      {/* Without a skip, one-at-a-time is a trap: the old panel
                          let an unanswerable question stay blank and send
                          anyway, and nothing here should be harder than that. */}
                      <button
                        type="button"
                        className="ask-skip"
                        disabled={!panelLive}
                        onClick={skipCurrent}
                      >
                        Skip — not sure
                      </button>
                      {machine.questions.length > 1 && (
                        <span className="ask-tip" id="ask-tip">
                          Nothing sends until every question is answered.
                        </span>
                      )}
                    </div>
                    {/* A chip and typed text weld into ONE answer ("Yes —
                        only when warm"). When both halves exist, show the
                        weld before it commits — this is what surfaces a stale
                        qualifier on a reopened question (the forward
                        weld cannot preview, the chip tap that creates it also
                        commits it). The slot is always in the layout when
                        chips exist, so its arrival never shifts the compose
                        row under the caret (the same reserve). */}
                    {openQuestion.options.length > 0 && (
                      <p
                        className={`ask-preview${
                          machine.selections[askIndex] != null &&
                          (machine.typedAnswers[askIndex] ?? "").trim() !== ""
                            ? ""
                            : " is-empty"
                        }`}
                      >
                        Will send:{" "}
                        <strong>{answerText(machine.selections, machine.typedAnswers, askIndex)}</strong>
                      </p>
                    )}
                  </div>
                ) : reviewing ? (
                  <div className="ask-review">
                    <p
                      className="ask-step"
                      ref={askFocusRef}
                      tabIndex={-1}
                      // Only while the note applies: describedby reads through
                      // visibility:hidden in enough AT stacks that a satisfied
                      // review would still announce the stale instruction.
                      aria-describedby={composerArmed ? undefined : "ask-review-note"}
                    >
                      {machine.questions.some((_question, index) => !machine.skipped[index] && isSettled(machine, index))
                        ? "All answered — check and send"
                        : "Nothing recorded — every question was skipped"}
                    </p>
                    {/* Skipping the lot leaves a turn with nothing in it, so
                        the send is correctly disabled — but "check and send"
                        over a dead button and no reason is the exact dead end
                        this screen is supposed to not have. Say which two
                        things unlock it. Always in the layout, hidden by
                        visibility when satisfied — unmounting it on the first
                        typed character shifted the compose box under the
                        caret. */}
                    <p
                      className={`ask-review-note${composerArmed ? " is-satisfied" : ""}`}
                      id="ask-review-note"
                    >
                      Change an answer below, or type a note — the interview needs one or the other.
                    </p>
                    <ul className="ask-answers">
                      {machine.questions.map((question, index) => (
                        <li key={question.text}>
                          <span className="ask-answer-q">{question.text}</span>
                          <strong
                            className={`ask-answer-a${machine.skipped[index] ? " is-skipped" : ""}`}
                          >
                            {answerSummary(machine, index)}
                          </strong>
                          <button
                            type="button"
                            className="ask-change"
                            disabled={!panelLive}
                            onClick={() => reopenQuestion(index)}
                          >
                            Change
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <form className="reply-form" onSubmit={sendReply}>
                  {/* While a question is open, the box IS its answer field —
                      so the question is its label. On a phone the keyboard
                      pushes the .ask-question off the top of the visual
                      viewport, and this label is the one line guaranteed to
                      survive above the box. */}
                  <label htmlFor="interview-reply">
                    {openQuestion
                      ? openQuestion.text
                      : reviewing
                        ? "Anything else to add?"
                        : "Add diagnostic information"}
                  </label>
                  {/* The trailing note lives in `reply`, which this box shows
                      only in review — reopening a question would otherwise
                      make the note vanish without a trace, and retyping it
                      would send it twice. One tap re-confirms the
                      open question and returns to review. */}
                  {openQuestion && reply.trim() !== "" && (
                    /* composerArmed → re-confirm the stored answer and
                       advance; empty (a reopened SKIPPED question) → restore
                       the skip the operator had already chosen. Either way
                       the button always goes back to review — answerCurrent
                       alone is a rejected no-op on the empty case. */
                    <button
                      type="button"
                      className="ask-note-held"
                      onClick={() => (composerArmed ? answerCurrent() : skipCurrent())}
                    >
                      Note saved for the end: “
                      {reply.trim().length > 60 ? `${reply.trim().slice(0, 60)}…` : reply.trim()}
                      ” — back to review
                    </button>
                  )}
                  <div className="reply-box">
                    <textarea
                      ref={interviewInputRef}
                      id="interview-reply"
                      value={composerValue}
                      onChange={(event) => setComposer(event.target.value)}
                      onKeyDown={handleReplyKeyDown}
                      placeholder={
                        openQuestion
                          ? openQuestion.options.length > 0
                            ? "e.g. “yes when loaded, no when empty”"
                            : "Type your answer…"
                          : reviewing
                            ? "Optional — anything the questions missed…"
                            : readyForReport
                              ? "Add any final detail, or generate the report…"
                              : "Type your answer…"
                      }
                      disabled={awaiting || turnsSpent || (!panelLive && !readyForReport)}
                      rows={3}
                    />
                    {/* One control, two meanings: it answers the open question
                        while the walk is running, and sends the turn once
                        every question is settled. Only the second reaches the
                        network — which is the whole reason the last chip tap
                        does not send. It widens and gets a label there, since
                        that tap is the one that costs money; `sendCooling`
                        holds it for a beat so the same finger cannot commit
                        the last answer AND send in one double-tap. */}
                    <button
                      type="submit"
                      className={openQuestion ? "reply-send" : "reply-send is-sending-turn"}
                      disabled={awaiting || !composerArmed || sendCooling}
                      aria-label={openQuestion ? "Answer this question" : "Send to RootCause"}
                    >
                      <span aria-hidden="true">{openQuestion ? "↑" : "Send  ↑"}</span>
                    </button>
                  </div>
                  <small>
                    {openQuestion
                      ? openQuestion.options.length > 0
                        ? `Enter to answer · Tab to the answers, 1–${openQuestion.options.length} picks one`
                        : "Enter to answer · Shift + Enter for a new line"
                      : "Enter to send · Shift + Enter for a new line"}
                  </small>
                </form>
              </div>

              <div className="report-action">
                <div>
                  <span className={readyForReport ? "readiness-mark is-ready" : "readiness-mark"} aria-hidden="true">✓</span>
                  {/* The walk's focus target when the turn asked nothing —
                      there is no question to land on, and this line is what
                      the operator needs to hear. */}
                  <p ref={machine.questions.length === 0 ? askFocusRef : undefined} tabIndex={-1}><strong>{readyForReport ? "Enough information collected" : turnsSpent ? "No questions left to ask" : "Report waits for sufficient detail"}</strong><br />{turnsSpent && !readyForReport
                    ? "This interview has run its full length. The report will name whatever the questions did not settle as an open evidence gap."
                    : lastTurn && !readyForReport
                      ? "One round of questions left — anything still unanswered after it may cause the report to rank the wrong cause first."
                      : "The model decides when the evidence is ready."}</p>
                </div>
                <button className="primary-button" type="button" onClick={generateReport} disabled={!canGenerate}>
                  Generate field report
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {stage === "generating" && (
        <section className="generating-page" id="top" aria-labelledby="generating-title">
          <div className="generating-panel" role="status" aria-live="polite">
            <span className="generating-spinner" aria-hidden="true" />
            <p className="eyebrow">Generating field report</p>
            <h1 id="generating-title" ref={stageHeadingRef} tabIndex={-1}>
              Building the report{machineLabel ? ` for ${machineLabel}.` : "."}
            </h1>
            <p className="generating-copy">
              RootCause is assembling ranked causes, confirmation tests, and evidence
              citations from the interview. This can take a couple of minutes—no need
              to refresh or navigate away.
            </p>
            <div className="generating-progress">
              <div
                className="generating-progress-bar"
                style={{ width: `${Math.round(generationProgress * 92)}%` }}
              />
            </div>
            <p className="generating-countdown">
              {generationRemaining > 0
                ? `About ${formatCountdown(generationRemaining)} remaining`
                : "Almost there—finishing up…"}
            </p>
          </div>
        </section>
      )}

      {stage === "report" && (
        <section className="report-page" id="top" aria-labelledby="report-title">
          <div className="report-toolbar">
            <div>
              <p className="eyebrow">
                <img src="/icons/reports.png" width={22} height={22} alt="" />
                Diagnostic field report
              </p>
              <h1 id="report-title" ref={stageHeadingRef} tabIndex={-1}>{machineLabel}</h1>
              <p>Generated from the machine intake, attached evidence, and diagnostic interview.</p>
            </div>
            <div className="report-actions">
              <div className="report-actions-buttons">
                <button className="primary-button" type="button" onClick={downloadReport}>
                  Download HTML report <span aria-hidden="true">↓</span>
                </button>
                <button className="ghost-button" type="button" onClick={printReport}>
                  Print / save as PDF <span aria-hidden="true">⎙</span>
                </button>
              </div>
              <p className="report-actions-hint">
                On a phone? Download the HTML report — it reflows for small screens. Print / save
                as PDF is laid out for paper.
              </p>
            </div>
          </div>
          <div className="report-frame-shell">
            {/*
              The document is authored by report-template.ts, not by the model:
              every model-supplied string is HTML-escaped before it reaches the
              page and the only script is our own. So the frame may run scripts
              (sorting, print, contents highlighting) — but gets no same-origin,
              no forms, and no popups, and the document carries its own CSP.
            */}
            <iframe
              ref={reportFrameRef}
              className="report-frame"
              srcDoc={machine.reportHtml}
              title={`${machineLabel} diagnostic field report`}
              sandbox="allow-scripts allow-modals"
            />
          </div>
        </section>
      )}

      <footer className="site-footer">
        <span>ROOTCAUSE</span>
        <p>AI-assisted troubleshooting supports—but does not replace—manufacturer procedures, qualified inspection, or safe work practices.</p>
      </footer>
    </main>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "equipment";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}
