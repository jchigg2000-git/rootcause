/**
 * RootCause tokens — the single source of truth.
 *
 * Both consumers read from here so the app shell and the generated report
 * cannot drift:
 *
 *   app/globals.css .............. the SPA shell (values mirrored into :root)
 *   app/api/diagnose/report-template.ts ... the downloadable document
 *
 * **The shell and the reports are deliberately different colours.** The shell
 * is blue/orange (see `globals.css`) regardless of make, while each report
 * wears its machine's livery (`THEMES` below); only an unrecognised make
 * falls back to the shell's colours.
 *
 * This supersedes the 2026-08-05 brand-board application, which put near-black
 * + amber + Rajdhani across both surfaces. It was rejected because a condensed
 * display face set as body prose made the reports read as posters rather than
 * field documents.
 * The board's mark and icon set survive; its palette and typeface do not.
 */

/**
 * Document neutrals, taken verbatim from the reference renderings in `docs/`.
 *
 * These are the greys the field report is built on. They are deliberately NOT
 * the shell's greys — the report is a print artefact and matches the reference
 * samples in `docs/`; the shell is an app.
 */
export const BRAND = {
  /** Primary type on the document's light panels. */
  ink: "#181b18",
  /** The shell's accent, and the pulse in the mark. */
  accent: "#e07a1f",
  /** Secondary type and hairline rules. */
  grey: "#535b53",
  /** Page surface behind the document panels. */
  paper: "#e9eae5",
  /** The document's panel surfaces and rules. */
  panel: "#ffffff",
  panel2: "#f4f4f0",
  line: "#c6c9c1",
  lineHeavy: "#8f958a",
} as const;

/**
 * The reference documents in `docs/` set prose in the system sans and every
 * label, eyebrow, badge and table header in mono. That pairing is what makes
 * them read as instruments; matching it is the point.
 *
 * Rajdhani was dropped on 2026-08-05 — it is a condensed display face and was
 * being used for body prose, which is most of why the reports read as a poster
 * rather than a field document.
 */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const MONO_STACK =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace';

/**
 * Evidence-tone semantics.
 *
 * **These never vary by manufacturer.** A report where "stop work" reads
 * differently on a Deere than on a Cat is a safety regression dressed up as
 * branding. Decided 2026-08-04.
 */
export const SEMANTIC = {
  danger: "#a3271d",
  dangerBg: "#f6e9e7",
  warn: "#7c5c00",
  warnBg: "#f4eeda",
  ok: "#245c3c",
  okBg: "#e9efe9",
  info: "#2a566b",
  infoBg: "#e8eef1",
} as const;

/**
 * Per-manufacturer report chrome.
 *
 * A report wears the livery of the machine it diagnoses, so a Deere report is
 * distinguishable from a Cat report at a glance across a cab.
 * Only the chrome moves — masthead, hazard stripe, rails, chips. Body surface,
 * type and every semantic above stay fixed, so two reports are comparable at a
 * glance and only their livery differs.
 *
 * `chrome` is the masthead ground and `accent` the stripe and rail. Both are
 * chosen dark/saturated enough to carry white and near-black respectively;
 * anything lighter breaks the masthead's contrast.
 */
export type ManufacturerTheme = { chrome: string; chromeDeep: string; accent: string };

/**
 * The house livery, used when the make is unrecognised. This is the one theme
 * that follows the shell, so an unbadged report still looks like the app that
 * produced it.
 */
export const DEFAULT_THEME: ManufacturerTheme = {
  chrome: "#10243a",
  chromeDeep: "#0b1a2b",
  accent: BRAND.accent,
};

const THEMES: Record<string, ManufacturerTheme> = {
  // Construction yellow + near-black.
  caterpillar: { chrome: "#1c1c1a", chromeDeep: "#0f0f0e", accent: "#ffcd11" },
  // Deere green + wheat.
  "john deere": { chrome: "#1c231d", chromeDeep: "#12170f", accent: "#dfa900" },
  // Komatsu blue.
  komatsu: { chrome: "#10243a", chromeDeep: "#0a1725", accent: "#1e9ad6" },
  // Volvo grey-blue.
  volvo: { chrome: "#1b2733", chromeDeep: "#101820", accent: "#8fa4b8" },
  // Hitachi orange.
  hitachi: { chrome: "#2a1c14", chromeDeep: "#1a110b", accent: "#e8730a" },
  // Case construction orange.
  case: { chrome: "#2a1a12", chromeDeep: "#190f0a", accent: "#eb6209" },
  "case ih": { chrome: "#2a1210", chromeDeep: "#190a09", accent: "#c8102e" },
  // New Holland blue.
  "new holland": { chrome: "#10243a", chromeDeep: "#0a1725", accent: "#0067b1" },
  // JCB yellow.
  jcb: { chrome: "#2a2410", chromeDeep: "#19150a", accent: "#fcb316" },
  // Kubota orange.
  kubota: { chrome: "#2a1712", chromeDeep: "#190d0a", accent: "#f04e23" },
  // Bobcat white/orange — chrome stays dark so the masthead still carries type.
  bobcat: { chrome: "#2a1c10", chromeDeep: "#19110a", accent: "#f47100" },
  // Doosan / Develon blue.
  doosan: { chrome: "#101f33", chromeDeep: "#0a1420", accent: "#00a0df" },
  develon: { chrome: "#101f33", chromeDeep: "#0a1420", accent: "#00a0df" },
  hyundai: { chrome: "#122030", chromeDeep: "#0b141e", accent: "#00aad2" },
  liebherr: { chrome: "#2a1a10", chromeDeep: "#190f0a", accent: "#f5a800" },
  takeuchi: { chrome: "#1d2733", chromeDeep: "#121820", accent: "#005eb8" },
  kobelco: { chrome: "#2a1a10", chromeDeep: "#190f0a", accent: "#e8790a" },
  yanmar: { chrome: "#2a1210", chromeDeep: "#190a09", accent: "#c8102e" },
  sany: { chrome: "#2a1210", chromeDeep: "#190a09", accent: "#e60012" },
  terex: { chrome: "#2a2410", chromeDeep: "#19150a", accent: "#f2a900" },
  genie: { chrome: "#122a1c", chromeDeep: "#0b1911", accent: "#00953b" },
  jlg: { chrome: "#2a2410", chromeDeep: "#19150a", accent: "#f5a800" },
  vermeer: { chrome: "#2a2410", chromeDeep: "#19150a", accent: "#f2c100" },
};

/**
 * Resolve a theme from whatever the operator typed into the Make field.
 *
 * Free text, so matching is normalized the same way `equipment-catalog.ts`
 * does, and an unrecognised make falls back to house livery rather than
 * guessing. **Derived server-side and never model-supplied** — this is
 * document chrome, like section numbering.
 */
export function themeForMake(make: string | undefined): ManufacturerTheme {
  const normalized = (make ?? "").trim().toLowerCase().replace(/[\s._-]+/g, " ");
  if (!normalized) return DEFAULT_THEME;
  if (THEMES[normalized]) return THEMES[normalized];
  // "John Deere 350G" or "CAT" typed into the make field.
  const hit = Object.keys(THEMES).find(
    (name) => normalized.startsWith(name) || normalized.includes(name),
  );
  if (hit) return THEMES[hit];
  if (/^cat\b/.test(normalized)) return THEMES.caterpillar;
  if (/^deere\b/.test(normalized)) return THEMES["john deere"];
  return DEFAULT_THEME;
}
