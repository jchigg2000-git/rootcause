/**
 * The spec-lookup data contract.
 *
 * Same discipline as `app/api/diagnose/report-schema.ts`: the model supplies
 * content only, section identity/order/numbering lives here and in
 * `spec-lookup-view.tsx`, and every field is coerced defensively so a model
 * that omits or mistypes something degrades to a readable page rather than a
 * 502. The shapes are kept independent of the diagnose route's on purpose —
 * only `repairJson` is shared, so the two contracts can move separately.
 */
import { repairJson } from "../diagnose/report-schema.ts";

/** Fixed section list. Order and numbering come from this array, not the model. */
export const SPEC_SECTIONS = [
  { id: "identity", title: "Identity and confidence" },
  { id: "engine", title: "Engine" },
  { id: "drivetrain", title: "Drivetrain and undercarriage" },
  { id: "hydraulics", title: "Hydraulic system" },
  { id: "electrical", title: "Electrical and controls" },
  { id: "capacities", title: "Capacities and fluids" },
  { id: "dimensions", title: "Dimensions and weights" },
  { id: "gaps", title: "Evidence gaps and sources" },
] as const;

export type SpecSectionId = (typeof SPEC_SECTIONS)[number]["id"];

/** Same vocabulary as the field report, duplicated rather than imported so the
 * two features stay independently editable. */
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

export type MachineIdentity = {
  year: string;
  make: string;
  model: string;
  machineType: string;
  confidence: Qualitative;
};

export type SpecData = {
  title: string;
  lede: string;
  metaChips: string[];
  machine: MachineIdentity;
  sections: Partial<Record<SpecSectionId, Block[]>>;
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
        ? { type: "list", items, style: style === "checklist" || style === "steps" ? style : "bullet" }
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
              return { title: str(item.title, 200), text: str(item.text), label: evidenceLabel(item.label) };
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

/** `[{ id, blocks }]`, matching the array form the prompt and schema ask for. */
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
 * Parse a model reply into spec data.
 *
 * Returns null only when the reply contains no usable JSON object at all —
 * the single condition the route treats as a failed lookup.
 */
export function parseSpecJson(content: string, generatedOn: string): SpecData | null {
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

  const machineRaw = (raw.machine ?? {}) as Record<string, unknown>;
  const sectionsRaw = normalizeSections(raw.sections);

  const sections: Partial<Record<SpecSectionId, Block[]>> = {};
  for (const section of SPEC_SECTIONS) {
    const blocks = coerceBlocks(sectionsRaw[section.id]);
    if (blocks.length) sections[section.id] = blocks;
  }

  return {
    title: str(raw.title, 300) || "System specifications",
    lede: str(raw.lede, 1500),
    metaChips: strList(raw.metaChips, 10).map((chip) => chip.slice(0, 120)),
    machine: {
      year: str(machineRaw.year, 20),
      make: str(machineRaw.make, 120),
      model: str(machineRaw.model, 120),
      machineType: str(machineRaw.machineType, 120),
      confidence: qualitative(machineRaw.confidence),
    },
    sections,
    disclaimer: str(raw.disclaimer, 1200),
    generatedOn,
  };
}

/**
 * The spec contract expressed as JSON Schema, for providers that constrain
 * decoding. Same "flat array of {id, blocks}" shape as `REPORT_JSON_SCHEMA`
 * for the same reason: a 5-way block union instantiated per-section blows the
 * grammar budget, instantiated once does not (see report-schema.ts for the
 * measured failure modes).
 */
const QUALITATIVE = { $ref: "#/$defs/qualitative" } as const;
const LABEL = { $ref: "#/$defs/label" } as const;

const BLOCK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "text", "label", "items", "style", "columns", "rows", "caption", "tone", "title", "cards"],
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
      id: { type: "string", enum: SPEC_SECTIONS.map((section) => section.id) },
      blocks: { type: "array", items: BLOCK_SCHEMA },
    },
  },
} as const;

export const SPEC_JSON_SCHEMA = {
  type: "object",
  $defs: {
    qualitative: { type: "string", enum: ["High", "Medium", "Low", ""] },
    label: { type: "string", enum: [...Object.keys(EVIDENCE_LABELS), ""] },
  },
  additionalProperties: false,
  required: ["title", "lede", "metaChips", "machine", "sections", "disclaimer"],
  properties: {
    title: { type: "string" },
    lede: { type: "string" },
    metaChips: { type: "array", items: { type: "string" } },
    machine: {
      type: "object",
      additionalProperties: false,
      required: ["year", "make", "model", "machineType", "confidence"],
      properties: {
        year: { type: "string" },
        make: { type: "string" },
        model: { type: "string" },
        machineType: { type: "string" },
        confidence: QUALITATIVE,
      },
    },
    sections: SECTIONS_SCHEMA,
    disclaimer: { type: "string" },
  },
} as const;
