/**
 * The report data contract.
 *
 * The model supplies content only. Section identity, order, numbering, chrome,
 * styling and print rules live in `report-template.ts` and are never delegated
 * to the model — that was the whole failure mode of free-generated HTML.
 *
 * Everything here is coerced defensively: a model that omits a field, sends a
 * number where a string belongs, or invents an evidence label must degrade to a
 * readable report rather than a 502.
 */

/** Fixed section list. Order and numbering come from this array, not the model. */
export const REPORT_SECTIONS = [
  { id: "identity", title: "Machine identity and core finding" },
  { id: "safety", title: "Safety and stop-work warnings" },
  { id: "applicability", title: "Applicability and configuration matrix" },
  { id: "systems", title: "How the relevant systems work" },
  { id: "ranked", title: "Ranked most likely problems" },
  { id: "operation", title: "Top operation- and maintenance-related problems" },
  { id: "documented", title: "Top documented known issues and fixes" },
  { id: "paths", title: "Symptom-based diagnostic paths" },
  { id: "normals", title: "Normal values and service information" },
  { id: "priority", title: "Repair-priority plan" },
  { id: "ledger", title: "Evidence ledger and remaining gaps" },
  { id: "sources", title: "Sources" },
] as const;

export type SectionId = (typeof REPORT_SECTIONS)[number]["id"];

/** The evidence vocabulary from sample-prompt.md, mapped to its badge class. */
export const EVIDENCE_LABELS: Record<string, string> = {
  "CONFIRMED MACHINE FACT": "b-confirmed",
  "DOCUMENTED COMPONENT FACT": "b-component",
  "REASONABLE INFERENCE": "b-inference",
  "MODEL-FAMILY GUIDANCE": "b-family",
  "FIELD PATTERN": "b-field",
  "PROPRIETARY-DOCUMENT GAP": "b-gap",
  "NOT APPLICABLE": "b-na",
};

export type Qualitative = "High" | "Medium" | "Low" | "";
export type Tone = "info" | "warning" | "danger";

export type Block =
  | { type: "paragraph"; text: string; label?: string }
  | { type: "list"; items: string[]; style?: "bullet" | "checklist" | "steps" }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "callout"; tone: Tone; title?: string; text: string }
  | { type: "cards"; cards: Array<{ title: string; text: string; label?: string }> };

export type RankedProblem = {
  rank: number;
  problem: string;
  likelihood: Qualitative;
  confidence: Qualitative;
  variant: string;
  why: string;
  symptoms: string;
  /** Controller / fault-code evidence — `sample-prompt.md` §5, column 8. */
  codes: string;
  tests: string;
  action: string;
  doNotReplaceUntil: string;
  sources: number[];
};

export type ReportSource = { title: string; meta: string; url: string };

export type ReportData = {
  title: string;
  lede: string;
  metaChips: string[];
  coreFinding: { label: string; statement: string; likelihood: Qualitative; confidence: Qualitative };
  kpis: Array<{ label: string; value: string; tone: "normal" | "caution" | "urgent" }>;
  safety: Array<{ tone: Tone; title: string; detail: string }>;
  ranked: RankedProblem[];
  sources: ReportSource[];
  sections: Partial<Record<SectionId, Block[]>>;
  disclaimer: string;
  generatedOn: string;
};

const str = (value: unknown, max = 4000): string =>
  typeof value === "string" ? value.slice(0, max) : typeof value === "number" ? String(value) : "";

const strList = (value: unknown, max = 60): string[] =>
  Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean).slice(0, max) : [];

const qualitative = (value: unknown): Qualitative => {
  const normalized = str(value, 20).trim().toLowerCase();
  if (normalized.startsWith("high")) return "High";
  if (normalized.startsWith("med")) return "Medium";
  if (normalized.startsWith("low")) return "Low";
  return "";
};

const tone = (value: unknown): Tone => {
  const normalized = str(value, 20).trim().toLowerCase();
  return normalized === "danger" || normalized === "warning" ? normalized : "info";
};

/** Unknown labels are dropped rather than rendered as an unstyled badge. */
const evidenceLabel = (value: unknown): string | undefined => {
  const normalized = str(value, 40).trim().toUpperCase();
  return normalized in EVIDENCE_LABELS ? normalized : undefined;
};

function coerceBlock(value: unknown): Block | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  switch (str(raw.type, 20)) {
    case "paragraph": {
      const text = str(raw.text);
      return text ? { type: "paragraph", text, label: evidenceLabel(raw.label) } : null;
    }
    case "list": {
      const items = strList(raw.items);
      const style = str(raw.style, 12);
      return items.length
        ? {
            type: "list",
            items,
            style: style === "checklist" || style === "steps" ? style : "bullet",
          }
        : null;
    }
    case "table": {
      const columns = strList(raw.columns, 14);
      const rows = Array.isArray(raw.rows)
        ? raw.rows.map((row) => strList(row, 14)).filter((row) => row.length).slice(0, 60)
        : [];
      return columns.length && rows.length
        ? { type: "table", columns, rows, caption: str(raw.caption, 300) || undefined }
        : null;
    }
    case "callout": {
      const text = str(raw.text);
      return text
        ? { type: "callout", tone: tone(raw.tone), title: str(raw.title, 200) || undefined, text }
        : null;
    }
    case "cards": {
      const cards = Array.isArray(raw.cards)
        ? raw.cards
            .map((card) => {
              const item = (card ?? {}) as Record<string, unknown>;
              return {
                title: str(item.title, 200),
                text: str(item.text),
                label: evidenceLabel(item.label),
              };
            })
            .filter((card) => card.title || card.text)
            .slice(0, 12)
        : [];
      return cards.length ? { type: "cards", cards } : null;
    }
    default:
      return null;
  }
}

const coerceBlocks = (value: unknown): Block[] =>
  Array.isArray(value)
    ? value.map(coerceBlock).filter((block): block is Block => block !== null).slice(0, 40)
    : [];

/**
 * Repair the two JSON faults models actually commit at this length: literal
 * control characters inside string values, and trailing commas. Both are
 * rejected outright by JSON.parse even though the intent is unambiguous.
 *
 * Both repairs are STRING-AWARE, and the trailing-comma half has to be. It was
 * a plain `out.replace(/,(\s*[}\]])/g, "$1")` over the finished text until
 * 2026-08-19, which is not aware of anything: report prose containing `", ]"`
 * or `", }"` — *"drain the tank, ] then refill"* — came back with the comma
 * deleted. Silent, unlogged, and only on the repair path, so a model reply that
 * needed repairing for some unrelated reason was the one that got corrupted.
 * A comma outside a string is therefore held back until the next non-space
 * character says whether it was trailing.
 *
 * Only \n, \r and \t are escaped. Any other literal control character still
 * fails the parse, and `parseReportJson` returns null — a failed generation the
 * route reports, not a silent corruption. Measured 2026-08-19; widening the set
 * has never been needed.
 */
export function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  // Held-back comma, plus whatever whitespace followed it. `inString` is always
  // false while either is set: a comma inside a string never sets them, and the
  // quote that opens a string flushes them first.
  let pendingComma = false;
  let pendingSpace = "";

  const flush = (dropComma: boolean) => {
    if (pendingComma && !dropComma) out += ",";
    out += pendingSpace;
    pendingComma = false;
    pendingSpace = "";
  };

  const emit = (character: string) => {
    if (pendingComma) flush(character === "}" || character === "]");
    out += character;
  };

  for (const character of text) {
    if (pendingComma && !escaped && /\s/.test(character)) {
      pendingSpace += character;
      continue;
    }
    if (escaped) {
      emit(character);
      escaped = false;
      continue;
    }
    if (character === "\\") {
      emit(character);
      escaped = true;
      continue;
    }
    if (character === '"') {
      emit(character);
      inString = !inString;
      continue;
    }
    if (inString && character === "\n") {
      out += "\\n";
      continue;
    }
    if (inString && character === "\r") {
      out += "\\r";
      continue;
    }
    if (inString && character === "\t") {
      out += "\\t";
      continue;
    }
    if (!inString && character === ",") {
      // A second comma means the first one was real, whatever follows.
      flush(false);
      pendingComma = true;
      continue;
    }
    emit(character);
  }

  // A comma at the very end of the input closes nothing, so it is kept —
  // exactly what the old regex did with it.
  flush(false);
  return out;
}

/**
 * Parse a model reply into report data.
 *
 * Returns null only when the reply contains no usable JSON object at all —
 * that is the single condition the route treats as a failed generation.
 */
export function parseReportJson(content: string, generatedOn: string): ReportData | null {
  const unfenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) return null;

  const candidate = unfenced.slice(first, last + 1);
  let raw: Record<string, unknown>;
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = JSON.parse(repairJson(candidate));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const coreRaw = (raw.coreFinding ?? {}) as Record<string, unknown>;
  const sectionsRaw = normalizeSections(raw.sections);

  const sections: Partial<Record<SectionId, Block[]>> = {};
  for (const section of REPORT_SECTIONS) {
    const blocks = coerceBlocks(sectionsRaw[section.id]);
    if (blocks.length) sections[section.id] = blocks;
  }

  const ranked: RankedProblem[] = Array.isArray(raw.ranked)
    ? raw.ranked
        .map((entry, index) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          return {
            rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : index + 1,
            problem: str(item.problem, 400),
            likelihood: qualitative(item.likelihood),
            confidence: qualitative(item.confidence),
            variant: str(item.variant, 400),
            why: str(item.why, 1200),
            symptoms: str(item.symptoms, 1200),
            codes: str(item.codes, 1200),
            tests: str(item.tests, 1200),
            action: str(item.action, 1200),
            doNotReplaceUntil: str(item.doNotReplaceUntil, 800),
            sources: Array.isArray(item.sources)
              ? item.sources.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 8)
              : [],
          };
        })
        .filter((item) => item.problem)
        .slice(0, 20)
    : [];

  const sources: ReportSource[] = Array.isArray(raw.sources)
    ? raw.sources
        .map((entry) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          const url = str(item.url, 600).trim();
          return {
            title: str(item.title, 400),
            meta: str(item.meta, 1500),
            // Only http(s) survives; anything else would be a live scheme in an
            // anchor we are about to write into the document ourselves.
            url: /^https?:\/\//i.test(url) ? url : "",
          };
        })
        .filter((item) => item.title || item.meta)
        .slice(0, 40)
    : [];

  return {
    title: str(raw.title, 300) || "Diagnostic field report",
    lede: str(raw.lede, 1500),
    metaChips: strList(raw.metaChips, 10).map((chip) => chip.slice(0, 120)),
    coreFinding: {
      label: evidenceLabel(coreRaw.label) ?? "",
      statement: str(coreRaw.statement, 2000),
      likelihood: qualitative(coreRaw.likelihood),
      confidence: qualitative(coreRaw.confidence),
    },
    kpis: Array.isArray(raw.kpis)
      ? raw.kpis
          .map((entry) => {
            const item = (entry ?? {}) as Record<string, unknown>;
            const kpiTone = str(item.tone, 12).toLowerCase();
            return {
              label: str(item.label, 120),
              value: str(item.value, 300),
              tone: (kpiTone === "urgent" || kpiTone === "caution" ? kpiTone : "normal") as
                | "normal"
                | "caution"
                | "urgent",
            };
          })
          .filter((item) => item.label && item.value)
          .slice(0, 6)
      : [],
    safety: Array.isArray(raw.safety)
      ? raw.safety
          .map((entry) => {
            const item = (entry ?? {}) as Record<string, unknown>;
            return { tone: tone(item.tone), title: str(item.title, 300), detail: str(item.detail, 2000) };
          })
          .filter((item) => item.title || item.detail)
          .slice(0, 12)
      : [],
    ranked,
    sources,
    sections,
    disclaimer: str(raw.disclaimer, 1200),
    generatedOn,
  };
}

/**
 * The report contract expressed as JSON Schema, for providers that can
 * constrain decoding to a schema rather than merely to "some JSON object".
 *
 * Built from `REPORT_SECTIONS` and `EVIDENCE_LABELS` rather than hand-written,
 * so it cannot drift from them — adding a section still means editing
 * `REPORT_SECTIONS` and `prompts.ts` together, and this follows for free.
 *
 * Every property is `required` and every object is `additionalProperties:
 * false`, which is what strict structured-output decoding demands. "Optional"
 * therefore means "present but empty" — which is exactly what `parseReportJson`
 * already coerces away, so nothing downstream changes.
 */
const QUALITATIVE = { $ref: "#/$defs/qualitative" } as const;
const LABEL = { $ref: "#/$defs/label" } as const;

/**
 * Accept both section shapes.
 *
 * `[{ id, blocks }]` is what the prompt now asks for and what the JSON Schema
 * constrains. `{ "<id>": [...] }` is the original object form — still produced
 * by any model answering the older prompt, and still the shape of every report
 * already stored in `app.db`. Normalizing here rather than at the call site
 * keeps one parser for both, so old rows keep rendering.
 */
function normalizeSections(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const byId: Record<string, unknown> = {};
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const { id, blocks } = entry as { id?: unknown; blocks?: unknown };
      if (typeof id === "string") byId[id] = blocks;
    }
    return byId;
  }
  return (value ?? {}) as Record<string, unknown>;
}

/**
 * Blocks are one object discriminated by `type`, not a five-way `anyOf`.
 *
 * That is a grammar-budget decision, established against the live API on
 * 2026-08-04, not a modelling preference. Anthropic compiles the schema to a
 * grammar and refuses anything too large; four shapes were tried:
 *
 *   twelve sections x five-way anyOf ....... "compiled grammar is too large"
 *   the same via $defs/$ref ................ "schema is too complex" (refs are
 *                                            expanded, not shared)
 *   sections as unconstrained arrays ....... "too large" — an unconstrained
 *                                            array means arbitrary JSON, which
 *                                            is a BIGGER grammar, not smaller
 *   twelve sections x one unified object ... "too large"
 *
 * What fits is `sections` as a flat ARRAY of `{ id, blocks }`, because the
 * block schema is then instantiated once instead of twelve times. 4,023 chars,
 * accepted by both Opus 5 and Haiku 4.5.
 *
 * The union collapses into a single object whose irrelevant fields are present
 * but empty. `coerceBlock` switches on `type` and reads only that variant's
 * fields, so the extra empties cost tokens and nothing else — and
 * `normalizeSections` above still accepts the original object form, so stored
 * reports and any non-schema provider keep working.
 */
const BLOCK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "type", "text", "label", "items", "style",
    "columns", "rows", "caption", "tone", "title", "cards",
  ],
  properties: {
    type: { type: "string", enum: ["paragraph", "list", "table", "callout", "cards"] },
    text: { type: "string" },
    label: LABEL,
    items: { type: "array", items: { type: "string" } },
    style: { type: "string", enum: ["bullet", "checklist", "steps", ""] },
    columns: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    caption: { type: "string" },
    tone: { type: "string", enum: ["info", "warning", "danger", ""] },
    title: { type: "string" },
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text", "label"],
        properties: { title: { type: "string" }, text: { type: "string" }, label: LABEL },
      },
    },
  },
} as const;

const SECTIONS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "blocks"],
    properties: {
      id: { type: "string", enum: REPORT_SECTIONS.map((section) => section.id) },
      blocks: { type: "array", items: BLOCK_SCHEMA },
    },
  },
} as const;

export const REPORT_JSON_SCHEMA = {
  type: "object",
  $defs: {
    qualitative: { type: "string", enum: ["High", "Medium", "Low", ""] },
    label: { type: "string", enum: [...Object.keys(EVIDENCE_LABELS), ""] },
  },
  additionalProperties: false,
  required: [
    "title", "lede", "metaChips", "coreFinding", "kpis",
    "safety", "ranked", "sources", "sections", "disclaimer",
  ],
  properties: {
    title: { type: "string" },
    lede: { type: "string" },
    metaChips: { type: "array", items: { type: "string" } },
    coreFinding: {
      type: "object",
      additionalProperties: false,
      required: ["label", "statement", "likelihood", "confidence"],
      properties: {
        label: LABEL,
        statement: { type: "string" },
        likelihood: QUALITATIVE,
        confidence: QUALITATIVE,
      },
    },
    kpis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "tone"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          tone: { type: "string", enum: ["normal", "caution", "urgent"] },
        },
      },
    },
    safety: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "title", "detail"],
        properties: {
          tone: { type: "string", enum: ["danger", "warning", "info"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rank", "problem", "likelihood", "confidence", "variant",
          "why", "symptoms", "codes", "tests", "action", "doNotReplaceUntil", "sources",
        ],
        properties: {
          rank: { type: "integer" },
          problem: { type: "string" },
          likelihood: QUALITATIVE,
          confidence: QUALITATIVE,
          variant: { type: "string" },
          why: { type: "string" },
          symptoms: { type: "string" },
          codes: { type: "string" },
          tests: { type: "string" },
          action: { type: "string" },
          doNotReplaceUntil: { type: "string" },
          sources: { type: "array", items: { type: "integer" } },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "meta", "url"],
        properties: { title: { type: "string" }, meta: { type: "string" }, url: { type: "string" } },
      },
    },
    sections: SECTIONS_SCHEMA,
    disclaimer: { type: "string" },
  },
} as const;
