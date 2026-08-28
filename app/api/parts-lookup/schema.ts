/**
 * The parts-lookup data contract.
 *
 * Same discipline as `app/api/spec-lookup/schema.ts`: the model supplies
 * content only, and every field is coerced defensively so a model that omits
 * or mistypes something degrades to a readable page rather than a 502. Flat —
 * one options list plus cautions — because a parts answer is a single table,
 * not an eight-section document.
 *
 * The one rule with teeth here: `url` is kept only when it parses as
 * http/https. These are model-supplied strings rendered as links, and a
 * javascript: URL must die in this file, not in the view.
 */
import { repairJson } from "../diagnose/report-schema.ts";

export type Qualitative = "High" | "Medium" | "Low" | "";

export type PartOption = {
  name: string;
  partNumber: string;
  condition: string;
  price: string;
  vendor: string;
  url: string;
  fitment: string;
  confidence: Qualitative;
  notes: string;
};

export type PartsData = {
  title: string;
  lede: string;
  options: PartOption[];
  cautions: string[];
  disclaimer: string;
  generatedOn: string;
};

export const MAX_PART_OPTIONS = 12;

const str = (value: unknown, max = 2000): string =>
  typeof value === "string" ? value.slice(0, max) : typeof value === "number" ? String(value) : "";

const strList = (value: unknown, max = 20): string[] =>
  Array.isArray(value) ? value.map((item) => str(item, 500)).filter(Boolean).slice(0, max) : [];

const qualitative = (value: unknown): Qualitative => {
  const normalized = str(value, 20).trim().toLowerCase();
  if (normalized.startsWith("high")) return "High";
  if (normalized.startsWith("med")) return "Medium";
  if (normalized.startsWith("low")) return "Low";
  return "";
};

/** http(s) or nothing — a link the page can safely render, or no link at all. */
export const safeUrl = (value: unknown): string => {
  const candidate = str(value, 600).trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
};

function coerceOption(value: unknown): PartOption | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const option: PartOption = {
    name: str(raw.name, 200),
    partNumber: str(raw.partNumber, 100),
    condition: str(raw.condition, 60),
    // A display string ("$45.99", "≈$120 used"), never parsed as currency.
    price: str(raw.price, 60),
    vendor: str(raw.vendor, 120),
    url: safeUrl(raw.url),
    fitment: str(raw.fitment, 400),
    confidence: qualitative(raw.confidence),
    notes: str(raw.notes, 400),
  };
  return option.name || option.partNumber ? option : null;
}

/**
 * Parse a model reply into parts data. Returns null only when the reply
 * contains no usable JSON object at all.
 */
export function parsePartsJson(content: string, generatedOn: string): PartsData | null {
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

  const options = Array.isArray(raw.options)
    ? raw.options
        .map(coerceOption)
        .filter((option): option is PartOption => option !== null)
        .slice(0, MAX_PART_OPTIONS)
    : [];

  return {
    title: str(raw.title, 300) || "Parts lookup",
    lede: str(raw.lede, 1500),
    options,
    cautions: strList(raw.cautions),
    disclaimer: str(raw.disclaimer, 1200),
    generatedOn,
  };
}

/** The parts contract as JSON Schema, for providers that constrain decoding. */
export const PARTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "lede", "options", "cautions", "disclaimer"],
  properties: {
    title: { type: "string" },
    lede: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "partNumber",
          "condition",
          "price",
          "vendor",
          "url",
          "fitment",
          "confidence",
          "notes",
        ],
        properties: {
          name: { type: "string" },
          partNumber: { type: "string" },
          condition: { type: "string" },
          price: { type: "string" },
          vendor: { type: "string" },
          url: { type: "string" },
          fitment: { type: "string" },
          confidence: { type: "string", enum: ["High", "Medium", "Low", ""] },
          notes: { type: "string" },
        },
      },
    },
    cautions: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
} as const;
