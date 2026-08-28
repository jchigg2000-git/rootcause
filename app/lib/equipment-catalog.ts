/**
 * Suggestions for the intake form's make / model / machine-type fields.
 *
 * A convenience, never a constraint. Every field stays a free-text input with
 * a combobox attached (app/components/combobox.tsx), so an unlisted make or a
 * model nobody thought of is typed straight in — which matters, because the
 * whole app is aimed at old and odd machines. Nothing here validates, and nothing reaches the server as an
 * enum: the model receives whatever the operator typed.
 *
 * Deliberately not exhaustive: the standard catalog of manufacturers, with
 * models only for the top three makes. Broad on makes, deep on three, shallow
 * everywhere else.
 */

/**
 * Country / market is pinned rather than a free field, for now — pinned to
 * the United States as of 2026-08-05. Revisit once non-US intake is actually
 * in scope.
 */
export const DEFAULT_MARKET = "United States";

/** Heavy-equipment manufacturers an operator is plausibly holding. */
export const MANUFACTURERS = [
  "Caterpillar",
  "John Deere",
  "Komatsu",
  "Volvo",
  "Hitachi",
  "Case",
  "New Holland",
  "JCB",
  "Kubota",
  "Bobcat",
  "Doosan",
  "Develon",
  "Hyundai",
  "Liebherr",
  "Takeuchi",
  "Kobelco",
  "Yanmar",
  "Sany",
  "XCMG",
  "Terex",
  "Genie",
  "JLG",
  "Wacker Neuson",
  "Vermeer",
  "Ditch Witch",
  "Gehl",
  "ASV",
  "Manitou",
  "Mustang",
  "Link-Belt",
] as const;

/** Common machine types, so the field is a pick rather than a guess. */
export const MACHINE_TYPES = [
  "Excavator",
  "Mini excavator",
  "Bulldozer",
  "Wheel loader",
  "Track loader",
  "Skid steer",
  "Compact track loader",
  "Backhoe loader",
  "Motor grader",
  "Articulated dump truck",
  "Rigid dump truck",
  "Telehandler",
  "Boom lift",
  "Scissor lift",
  "Compactor / roller",
  "Trencher",
  "Forestry mulcher",
  "Feller buncher",
  "Skidder",
  "Crane",
  "Paver",
  "Scraper",
  "Agricultural tractor",
  "Combine harvester",
] as const;

type MachineType = (typeof MACHINE_TYPES)[number];

/**
 * `from` is the model name's approximate market-introduction year; `to` is
 * its last production year, omitted when the name is still current. These
 * are generation-launch approximations pulled from general public spec
 * sheets, not a serial-number-accurate build book — same "reasonable
 * approximation, not a guarantee" spirit as the type-per-family split below.
 * Where our catalog only carries the bare current-generation name (Caterpillar's
 * suffixless "D1"–"D11" dozers, which replaced the "D6T"/"D8T"-style names we
 * don't carry), `from` is that generation's launch year rather than the
 * decades-older name it replaced — a mechanic on an old D6T wouldn't type
 * "D6" anyway. Where a base number has carried through many generations under
 * one name (Caterpillar's "320", Komatsu's "PC300"), `from` is generous —
 * the original launch — so an older machine isn't wrongly excluded.
 */
type ModelEntry = {
  name: string;
  from: number;
  to?: number;
};

type ModelFamily = {
  type: MachineType;
  models: ModelEntry[];
};

const model = (name: string, from: number, to?: number): ModelEntry => ({ name, from, to });

/**
 * Models for the three largest makers only, grouped by machine type so a
 * chosen model can autopopulate the machine-type field.
 *
 * Grouped rather than exhaustively enumerated — enough that a test session
 * does not require knowing the lineup, and short enough that the dropdown
 * stays usable. Everyone else falls back to free text by design. The
 * type-per-family split is a reasonable approximation of each maker's real
 * lineup, not a guarantee — a handful of models near a size boundary (e.g. a
 * skid steer vs. its compact-track-loader sibling) may land in the coarser
 * bucket. That's fine: this only ever prefills a free-text field.
 */
const MODEL_FAMILIES_BY_MAKE: Record<string, ModelFamily[]> = {
  Caterpillar: [
    {
      type: "Mini excavator",
      models: [model("301.7", 1998), model("303.5", 1998), model("305", 1998), model("308", 1996)],
    },
    {
      type: "Excavator",
      models: [
        model("310", 2019),
        model("313", 1996),
        model("315", 1996),
        model("320", 1994),
        model("323", 2018),
        model("326", 2018),
        model("330", 1994),
        model("336", 2004),
        model("340", 2018),
        model("349", 2011),
        model("352", 2019),
        model("374", 2011),
        model("395", 2021),
      ],
    },
    {
      type: "Bulldozer",
      models: [
        model("D1", 2018),
        model("D2", 2018),
        model("D3", 2018),
        model("D4", 2018),
        model("D5", 2018),
        model("D6", 2019),
        model("D7", 2019),
        model("D8", 2019),
        model("D9", 2019),
        model("D10", 2019),
        model("D11", 2017),
      ],
    },
    {
      type: "Wheel loader",
      models: [
        model("926M", 2013),
        model("930M", 2013),
        model("938M", 2013),
        model("950M", 2013),
        model("962M", 2013),
        model("966M", 2013),
        model("972M", 2013),
        model("980M", 2013),
        model("982M", 2013),
        model("988K", 2013, 2022),
      ],
    },
    {
      type: "Backhoe loader",
      models: [model("416", 1994), model("420", 1994), model("430", 1994), model("440", 1994), model("450", 1994)],
    },
    {
      type: "Skid steer",
      models: [model("226D", 2015), model("232D", 2015), model("236D", 2015), model("242D", 2015), model("246D", 2015)],
    },
    {
      type: "Compact track loader",
      models: [model("262D", 2015), model("272D", 2015), model("279D", 2015), model("289D", 2015), model("299D", 2015)],
    },
    { type: "Telehandler", models: [model("TL943", 2018), model("TH357", 1998), model("TH408", 1998)] },
    {
      type: "Articulated dump truck",
      models: [model("725", 2011), model("730", 2011), model("735", 2011), model("740", 2011), model("745", 2011)],
    },
    {
      type: "Motor grader",
      models: [
        model("120", 1963),
        model("12M", 2011),
        model("140", 1963),
        model("14M", 2011),
        model("150", 1963),
        model("160", 1963),
        model("16M", 2011),
      ],
    },
  ],
  "John Deere": [
    {
      type: "Mini excavator",
      models: [
        model("17G", 2012),
        model("26G", 2012),
        model("30G", 2012),
        model("35G", 2012),
        model("50G", 2012),
        model("60G", 2012),
        model("75G", 2012),
        model("85G", 2012),
      ],
    },
    {
      type: "Excavator",
      models: [
        model("130G", 2012),
        model("135G", 2012),
        model("160G", 2012),
        model("180G", 2012),
        model("210G", 2012),
        model("245G", 2012),
        model("250G", 2012),
        model("300G", 2012),
        model("350G", 2012),
        model("380G", 2012),
        model("470G", 2012),
        model("670G", 2012),
      ],
    },
    {
      type: "Bulldozer",
      models: [
        model("450K", 2010),
        model("550K", 2010),
        model("650K", 2010),
        model("700K", 2010),
        model("750K", 2010),
        model("850K", 2010),
        model("950K", 2010),
        model("1050K", 2010),
      ],
    },
    {
      type: "Wheel loader",
      models: [
        model("244L", 2013),
        model("324L", 2013),
        model("344L", 2013),
        model("444L", 2013),
        model("524L", 2013),
        model("544L", 2013),
        model("624L", 2013),
        model("644L", 2013),
        model("724L", 2013),
        model("744L", 2013),
        model("824L", 2013),
        model("844L", 2013),
      ],
    },
    {
      type: "Backhoe loader",
      models: [
        model("310L", 2013),
        model("310SL", 2013),
        model("315SL", 2013),
        model("320P", 2013),
        model("410L", 1990),
        model("710L", 1990),
      ],
    },
    {
      type: "Skid steer",
      models: [
        model("312GR", 2016),
        model("314G", 2016),
        model("316GR", 2016),
        model("317G", 2016),
        model("318G", 2016),
        model("320G", 2016),
      ],
    },
    {
      type: "Compact track loader",
      models: [model("324G", 2016), model("325G", 2016), model("330G", 2016), model("332G", 2016)],
    },
    {
      type: "Articulated dump truck",
      models: [model("260E", 2012), model("310E", 2012), model("410E", 2012), model("460E", 2012)],
    },
    {
      type: "Motor grader",
      models: [
        model("620G", 2012),
        model("622G", 2012),
        model("670G", 2012),
        model("672G", 2012),
        model("770G", 2012),
        model("772G", 2012),
        model("870G", 2012),
        model("872G", 2012),
      ],
    },
  ],
  Komatsu: [
    {
      type: "Mini excavator",
      models: [
        model("PC30", 1998),
        model("PC35", 1998),
        model("PC45", 1998),
        model("PC55", 1998),
        model("PC78", 1998),
        model("PC88", 1998),
      ],
    },
    {
      type: "Excavator",
      models: [
        model("PC130", 1998),
        model("PC138", 1998),
        model("PC170", 1998),
        model("PC210", 1998),
        model("PC238", 1998),
        model("PC290", 1998),
        model("PC300", 1998),
        model("PC360", 1998),
        model("PC390", 1998),
        model("PC490", 1998),
        model("PC650", 1998),
        model("PC800", 1998),
        model("PC1250", 1998),
      ],
    },
    {
      type: "Bulldozer",
      models: [
        model("D31", 1991),
        model("D37", 1991),
        model("D39", 1991),
        model("D51", 1991),
        model("D61", 1991),
        model("D65", 1991),
        model("D71", 1991),
        model("D85", 1991),
        model("D155", 1991),
        model("D275", 1991),
        model("D375", 1991),
      ],
    },
    {
      type: "Wheel loader",
      models: [
        model("WA100", 1995),
        model("WA200", 1995),
        model("WA270", 1995),
        model("WA320", 1995),
        model("WA380", 1995),
        model("WA470", 1995),
        model("WA480", 1995),
        model("WA500", 1995),
        model("WA600", 1995),
        model("WA800", 1995),
      ],
    },
    { type: "Backhoe loader", models: [model("WB93", 2000), model("WB97", 2000)] },
    { type: "Skid steer", models: [model("SK510", 2005), model("SK815", 2005)] },
    { type: "Articulated dump truck", models: [model("HM300", 2004), model("HM400", 2004)] },
    { type: "Motor grader", models: [model("GD555", 1998), model("GD655", 1998), model("GD675", 1998)] },
  ],
};

// A model number can legitimately repeat across families for the same make
// (John Deere's "670G" is both an excavator and a motor grader), so this is a
// real Set, not a defensive one — without it the model suggestion list renders
// the same value twice under the same `key={model}`.
export const MODELS_BY_MAKE: Record<string, string[]> = Object.fromEntries(
  Object.entries(MODEL_FAMILIES_BY_MAKE).map(([make, families]) => [
    make,
    Array.from(new Set(families.flatMap((family) => family.models.map((entry) => entry.name)))),
  ]),
);

/**
 * Model suggestions for a typed make, optionally narrowed to a model year.
 *
 * Matching is case- and punctuation-insensitive because the field is free
 * text: "john deere", "John Deere" and "JOHN  DEERE" all resolve. An unknown
 * make returns nothing, which renders as no datalist rather than a wrong one.
 *
 * `year`, when given, keeps only models whose `[from, to]` range covers it —
 * a name that appears in more than one family (John Deere's "670G") is kept
 * if it fits in *any* of them. An unrecognized or out-of-range year yields an
 * empty list rather than a guess, same as an unrecognized make; the field
 * stays free text either way, so this only ever narrows a suggestion list,
 * never blocks what the operator can type.
 */
export function modelsForMake(make: string, year?: number): string[] {
  const normalized = normalize(make);
  if (!normalized) return [];
  const makeKey = Object.keys(MODEL_FAMILIES_BY_MAKE).find((name) => normalize(name) === normalized);
  if (!makeKey) return [];
  const entries = MODEL_FAMILIES_BY_MAKE[makeKey].flatMap((family) => family.models);
  const matching =
    year === undefined ? entries : entries.filter((entry) => entry.from <= year && (entry.to === undefined || year <= entry.to));
  return Array.from(new Set(matching.map((entry) => entry.name)));
}

/**
 * The machine type a catalogued make + model implies, for autopopulating the
 * machine-type field. Returns undefined for an unrecognized make or model —
 * the caller leaves the field as the operator left it rather than guessing.
 */
export function machineTypeForModel(make: string, model: string): MachineType | undefined {
  const normalizedMake = normalize(make);
  const normalizedModel = normalize(model);
  if (!normalizedMake || !normalizedModel) return undefined;
  const makeKey = Object.keys(MODEL_FAMILIES_BY_MAKE).find((name) => normalize(name) === normalizedMake);
  if (!makeKey) return undefined;
  const family = MODEL_FAMILIES_BY_MAKE[makeKey].find((candidate) =>
    candidate.models.some((entry) => normalize(entry.name) === normalizedModel),
  );
  return family?.type;
}

/**
 * A random, internally-consistent machine — a catalogued make, a model that
 * make actually built, and a year within that model's production window —
 * for exercising the intake form without hand-picking one. Draws only from
 * the three makes carrying a model catalog (`MODEL_FAMILIES_BY_MAKE`), so the
 * result always comes with a real model and machine type rather than a blank
 * or invented one.
 */
export function randomMachine(): { year: string; make: string; model: string; machineType: string } {
  const makes = Object.keys(MODEL_FAMILIES_BY_MAKE);
  const make = pick(makes);
  const family = pick(MODEL_FAMILIES_BY_MAKE[make]);
  const entry = pick(family.models);
  const lastYear = entry.to ?? new Date().getFullYear();
  const year = entry.from + Math.floor(Math.random() * (lastYear - entry.from + 1));
  return { year: String(year), make, model: entry.name, machineType: family.type };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * The year to narrow model suggestions by, or undefined for "don't narrow".
 *
 * Only a complete, plausible 4-digit year counts: a half-typed "201" falls
 * through to every catalogued model rather than emptying the list mid-
 * keystroke. Lives here rather than in a view because all four suggestion
 * call sites need it and three of them used to pass a raw `Number(year)`.
 */
export function parseModelYear(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return undefined;
  const year = Number(trimmed);
  return year >= 1950 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

/**
 * Rank a suggestion list against what the operator has typed so far.
 *
 * Substring, not prefix, because the catalog demands it: MACHINE_TYPES is full
 * of compounds whose distinguishing word comes last ("Mini excavator", "Wheel
 * loader", "Backhoe loader") — an operator types "loader" — and MANUFACTURERS
 * carries "New Holland", "Link-Belt" and "Wacker Neuson", where the memorable
 * token is the second one. Models are alphanumeric fragments, so typing "44"
 * to reach "344K" is the natural motion.
 *
 * Two tiers. The first reuses `normalize`, so "link belt" / "Link-Belt" /
 * "LINK_BELT" are equivalent exactly as they are for `modelsForMake`. When
 * that finds nothing, a squashed retry strips every non-alphanumeric from both
 * sides, which is what lets "350glc" reach "350G LC".
 *
 * Ranking is prefix, then word-start, then interior, stable within each band
 * so catalog order survives. There is no result cap: the popup claims to show
 * the full list, and truncating ~60 Caterpillar models would make that a lie.
 */
export function filterSuggestions(options: readonly string[], query: string): string[] {
  const needle = normalize(query);
  if (!needle) return [...options];

  const ranked = rankBySubstring(options, needle, (option) => normalize(option));
  if (ranked.length) return ranked;

  const squashed = squash(query);
  if (!squashed) return [];
  return rankBySubstring(options, squashed, squash);
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Prefix (0) beats word-start (1) beats interior (2); non-matches drop out. */
function rankBySubstring(
  options: readonly string[],
  needle: string,
  project: (option: string) => string,
): string[] {
  const scored: { option: string; band: number; order: number }[] = [];
  options.forEach((option, order) => {
    const haystack = project(option);
    const at = haystack.indexOf(needle);
    if (at < 0) return;
    const band = at === 0 ? 0 : haystack[at - 1] === " " ? 1 : 2;
    scored.push({ option, band, order });
  });
  return scored
    .sort((a, b) => a.band - b.band || a.order - b.order)
    .map((entry) => entry.option);
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s._-]+/g, " ");
