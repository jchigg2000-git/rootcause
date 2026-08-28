#!/usr/bin/env node
// Offline layout instrument for the UXT report-layout experiments.
//
// Every UXT pass criterion that is stated in pixels ("within the first 660px",
// "~915px below the card top", "#jump matches at 12/12 anchors") needs a real
// layout engine and a real 390x660 viewport. It does NOT need the model: every
// eval run dir stores the verbatim `fullReport` ReportData per case, so we can
// re-render the same ten fixtures through `renderReport` as many times as we
// like for free. That is what makes these A/Bs cheap enough to iterate on.
//
//   node evals/measure-report.mjs --label baseline
//   node evals/measure-report.mjs --label uxt-1 --run 2026-08-07-03-50
//
// Writes evals/measurements/<label>.json and prints a summary table. Compare
// two labels with --against <label>.
//
// Chromium comes from the puppeteer download cache that md-to-pdf/mermaid-cli
// already populated (~/.cache/puppeteer); nothing is added to this repo's
// dependencies for it — the instrument is a dev tool, not shipped code.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPORT_SECTIONS } from "../app/api/diagnose/report-schema.ts";
import { renderReport } from "../app/api/diagnose/report-template.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RUNS = path.join(HERE, "runs");
const OUT_DIR = path.join(HERE, "measurements");

// The baselines were taken at 390x660 — an iPhone-class viewport with
// the browser chrome subtracted. "Above the fold" means y < FOLD.
const VIEWPORT = { width: 390, height: 660 };
const FOLD = VIEWPORT.height;

// Where a globally-installed puppeteer can be found; override when yours differs.
const GLOBAL_MODULES =
  process.env.GLOBAL_NODE_MODULES ??
  `${process.env.HOME}/.nvm/versions/node/v24.14.1/lib/node_modules`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function loadPuppeteer() {
  // puppeteer-core is not a dependency of this repo and must not become one.
  // Reach into whichever globally-installed package already ships it.
  const require = createRequire(import.meta.url);
  for (const owner of ["md-to-pdf", "@mermaid-js/mermaid-cli"]) {
    try {
      return require(path.join(GLOBAL_MODULES, owner, "node_modules", "puppeteer-core", "lib", "cjs", "puppeteer", "puppeteer-core.js"));
    } catch {
      /* try the next owner */
    }
  }
  throw new Error("puppeteer-core not found in the global module tree");
}

function findChrome() {
  const base = path.join(process.env.HOME, ".cache", "puppeteer", "chrome");
  const builds = readdirSync(base).filter((d) => d.startsWith("mac_arm")).sort();
  const build = builds[builds.length - 1];
  return path.join(base, build, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
}

function loadScenarios() {
  const raw = JSON.parse(readFileSync(path.join(HERE, "scenarios.json"), "utf8"));
  const byId = new Map();
  for (const s of raw.scenarios) byId.set(s.id, s);
  return byId;
}

function loadCases(runId) {
  const dir = path.join(RUNS, runId);
  const files = readdirSync(dir).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort();
  return files.map((f) => {
    const data = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    return { file: f, id: data.scenarioId, report: data.fullReport };
  });
}

// ---------------------------------------------------------------------------
// In-page probes. Everything here runs inside the rendered report document.
// ---------------------------------------------------------------------------

const PROBE = function probe(input) {
  const { fold, needle, sectionIds, rankedFirstProblem } = input;
  const out = {};

  const topOf = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
  const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  out.documentHeight = document.documentElement.scrollHeight;
  out.screens = +(document.documentElement.scrollHeight / fold).toFixed(1);

  // --- UXT-1: where does the #1 problem's NAME first appear? -----------------
  // Must be a TEXT-NODE search measured through a Range. An element search
  // matches any ancestor whose subtree contains the phrase — `div.layout`
  // wraps the whole document, so it "matches" at y=425 while the words are
  // 3000px further down. That false positive is the difference between
  // "baseline 0/10" and "baseline 10/10".
  const target = normalize(rankedFirstProblem);
  let firstY = null;
  let firstWhere = null;
  if (target) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!normalize(node.nodeValue).includes(target)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue; // hidden thead etc.
      firstY = Math.round(rect.top + window.scrollY);
      const host = node.parentElement;
      firstWhere = host
        ? `${host.tagName.toLowerCase()}${host.className ? "." + host.className : ""}${
            host.closest("section") ? " @#" + host.closest("section").id : ""
          }`
        : null;
      break;
    }
  }
  out.firstRankedProblemY = firstY;
  out.firstRankedProblemAboveFold = firstY !== null && firstY < fold;
  out.firstRankedProblemTag = firstWhere;

  // A first-screen shortlist, if one exists at all (UXT-1's deliverable).
  const shortlist = document.querySelector(".priority-list, #field-action, [data-shortlist]");
  out.shortlistPresent = Boolean(shortlist);
  out.shortlistY = topOf(shortlist);

  // Evidence legend location (UXT-1 moves it into §1).
  const legend = document.querySelector(".evidence-legend, [data-evidence-legend]");
  out.legendY = topOf(legend);
  out.legendSection = legend ? (legend.closest("section")?.id ?? null) : null;

  // --- UXT-2: stop-work strip ------------------------------------------------
  const strip = document.querySelector(".stopwork, [data-stopwork]");
  out.stopWorkPresent = Boolean(strip);
  out.stopWorkY = topOf(strip);
  out.stopWorkAboveFold = strip ? topOf(strip) < fold : false;
  out.stopWorkHasText = strip ? normalize(strip.textContent).length > 0 : false;

  // Rendered order of the safety items, by severity class, as the DOM has them.
  // renderSafety emits `class="callout ${tone === 'info' ? '' : tone}"`, so an
  // info item carries no modifier token at all — absence IS the info case.
  const sevOf = (el) => {
    const cls = el.className || "";
    if (/\bdanger\b/.test(cls)) return "danger";
    if (/\bwarning\b/.test(cls)) return "warning";
    return "info";
  };
  const safetySection = document.querySelector("#safety");
  out.safetyOrder = safetySection ? Array.from(safetySection.querySelectorAll(".callout")).map(sevOf) : [];

  // --- UXT-7: field order inside the rank-1 card -----------------------------
  const card = document.querySelector("#ranked tbody tr, #ranked .ranked-card, #ranked .rank-card");
  if (card) {
    const cardTop = topOf(card);
    out.rank1CardTop = cardTop;
    out.rank1CardHeight = Math.round(card.getBoundingClientRect().height);
    const cells = Array.from(card.querySelectorAll("[data-label]"));
    out.rank1Fields = cells.map((c) => ({
      label: c.getAttribute("data-label"),
      offset: topOf(c) - cardTop,
    }));
    const action = cells.find((c) => /corrective action/i.test(c.getAttribute("data-label") || ""));
    out.correctiveActionOffset = action ? topOf(action) - cardTop : null;
  } else {
    out.rank1CardTop = null;
    out.rank1Fields = [];
    out.correctiveActionOffset = null;
  }

  // Every data-label present anywhere in the ranked table (the reflow contract).
  out.rankedLabels = Array.from(
    new Set(Array.from(document.querySelectorAll("#ranked [data-label]")).map((c) => c.getAttribute("data-label"))),
  );

  // --- UXT-9: sort defaults --------------------------------------------------
  out.sortButtons = Array.from(document.querySelectorAll("[data-sort-col]")).map((b) => ({
    text: normalize(b.textContent),
    col: b.getAttribute("data-sort-col"),
    defaultDir: b.getAttribute("data-default-dir"),
    pressed: b.getAttribute("aria-pressed"),
  }));

  // --- UXT-12 / general: where every section starts --------------------------
  out.sectionTops = {};
  for (const id of sectionIds) {
    out.sectionTops[id] = topOf(document.getElementById(id));
  }

  // Presence of the mobile controls (UXT-8's "Top" button lands here).
  const controls = document.querySelector(".mobile-controls");
  // Buttons and links only — the #jump <select>'s option text contains "Top
  // operation-..." and "Top documented...", which reads as a return-to-top
  // control to any substring check.
  out.mobileControlButtons = controls
    ? Array.from(controls.querySelectorAll("button, a")).map((b) => normalize(b.textContent) || b.id || b.tagName.toLowerCase())
    : [];

  void needle;
  return out;
};

// --- UXT-8: does #jump track scroll position? -------------------------------
const JUMP_PROBE = async function jumpProbe(sectionIds) {
  const jump = document.querySelector("#jump");
  if (!jump) return { present: false, matches: 0, total: sectionIds.length, detail: [] };
  const detail = [];
  for (const id of sectionIds) {
    const el = document.getElementById(id);
    if (!el) {
      detail.push({ id, value: null, ok: false });
      continue;
    }
    // NOT scrollIntoView(): the stylesheet sets `html{scroll-behavior:smooth}`
    // (report-template.ts:81), and headless Chrome has no compositor to advance
    // that animation — the scroll silently never happens and every anchor reads
    // as section 1. An explicit instant scroll is also the honest emulation:
    // land where a TOC jump settles, 64px down per `section{scroll-margin-top}`.
    const target = Math.round(el.getBoundingClientRect().top + window.scrollY) - 60;
    window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
    await new Promise((r) => setTimeout(r, 80));
    detail.push({ id, value: jump.value, ok: jump.value === id, scrollY: Math.round(window.scrollY) });
  }
  return { present: true, matches: detail.filter((d) => d.ok).length, total: sectionIds.length, detail };
};

// --- UXT-9: what does ONE press of a severity sort actually do? -------------
const SORT_PROBE = async function sortProbe(labelPattern) {
  const buttons = Array.from(document.querySelectorAll("[data-sort-col]"));
  const btn = buttons.find((b) => new RegExp(labelPattern, "i").test(b.textContent || ""));
  if (!btn) return { present: false };
  const col = Number(btn.getAttribute("data-sort-col"));
  const readCol = () =>
    Array.from(document.querySelectorAll("#ranked tbody tr")).map((row) => {
      const cells = row.querySelectorAll("td");
      return (cells[col]?.textContent || "").replace(/\s+/g, " ").trim();
    });
  // What column does this button actually address? Read the data-label of the
  // cell it indexes into — that is the claim UXT-7's reorder can silently break.
  const firstRow = document.querySelector("#ranked tbody tr");
  const targetLabel = firstRow ? firstRow.querySelectorAll("td")[col]?.getAttribute("data-label") ?? null : null;
  const before = readCol();
  btn.click();
  await new Promise((r) => setTimeout(r, 60));
  const afterOne = readCol();
  btn.click();
  await new Promise((r) => setTimeout(r, 60));
  const afterTwo = readCol();
  return { present: true, col, targetLabel, before, afterOne, afterTwo, pressed: btn.getAttribute("aria-pressed") };
};

// ---------------------------------------------------------------------------

async function main() {
  const label = arg("label", "unlabelled");
  const runId = arg("run", "2026-08-07-03-50");
  const against = arg("against", null);

  const scenarios = loadScenarios();
  const cases = loadCases(runId);
  const sectionIds = REPORT_SECTIONS.map((s) => s.id);

  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--allow-file-access-from-files", "--no-sandbox"],
  });

  const scratch = path.join(tmpdir(), `rootcause-measure-${process.pid}`);
  mkdirSync(scratch, { recursive: true });

  const results = [];
  for (const c of cases) {
    const scenario = scenarios.get(c.id);
    const make = scenario?.machine?.make;
    const html = renderReport(c.report, make);
    const file = path.join(scratch, `${c.id}.html`);
    writeFileSync(file, html);

    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

    const rankedFirstProblem = c.report?.ranked?.[0]?.problem ?? "";
    const measured = await page.evaluate(PROBE, {
      fold: FOLD,
      needle: null,
      sectionIds,
      rankedFirstProblem,
    });
    measured.jump = await page.evaluate(JUMP_PROBE, sectionIds);
    await page.evaluate((ids) => {
      void ids;
      window.scrollTo(0, 0);
    }, sectionIds);
    measured.sortLikelihood = await page.evaluate(SORT_PROBE, "likelihood");
    measured.sortConfidence = await page.evaluate(SORT_PROBE, "confidence");
    measured.sortRank = await page.evaluate(SORT_PROBE, "^\\s*rank");

    // Source-side facts that need no layout engine.
    measured.safetyModelOrder = (c.report?.safety ?? []).map((s) => s.tone ?? "info");
    measured.rankedFirstProblem = rankedFirstProblem;
    measured.htmlBytes = html.length;

    results.push({ id: c.id, make, ...measured });
    await page.close();
  }

  await browser.close();

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = { label, runId, viewport: VIEWPORT, measuredAt: new Date().toISOString(), results };
  const outPath = path.join(OUT_DIR, `${label}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  summarize(payload, against ? JSON.parse(readFileSync(path.join(OUT_DIR, `${against}.json`), "utf8")) : null);
  console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
}

const SEV_RANK = { danger: 0, warning: 1, info: 2 };
const QUAL = { high: 3, medium: 2, low: 1 };

const qualSeq = (rows) => (rows ?? []).map((v) => QUAL[String(v).trim().toLowerCase()] ?? 0);
const descendingSeverity = (rows) => {
  const s = qualSeq(rows);
  return s.length > 1 && s.every((v, i) => i === 0 || s[i - 1] >= v);
};
const ascendingSeverity = (rows) => {
  const s = qualSeq(rows);
  return s.length > 1 && s.every((v, i) => i === 0 || s[i - 1] <= v);
};
const ascendingRank = (rows) => {
  const s = (rows ?? []).map(Number);
  return s.length > 1 && s.every((v, i) => i === 0 || s[i - 1] <= v);
};

/**
 * UXT-7's real hazard: `RANKED_SORTS` indices reach the client as
 * `data-sort-col` and are read as `row.cells[n]`. Reorder the columns without
 * moving them and each button silently sorts a different column than its
 * label. Verified by reading the `data-label` of the cell each button targets.
 */
const sortColumnsMatchLabels = (c) => {
  const pairs = [
    [c.sortRank, "Rank"],
    [c.sortLikelihood, "Likelihood"],
    [c.sortConfidence, "Confidence"],
  ];
  return pairs.every(([probe, label]) => probe?.present && probe.targetLabel === label);
};

function rollup(p) {
  const r = p.results;
  const n = r.length;
  const median = (xs) => {
    const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const sorted = (list) => {
    const ranks = list.map((s) => SEV_RANK[s] ?? 9);
    return ranks.every((v, i) => i === 0 || ranks[i - 1] <= v);
  };
  const withDanger = r.filter((c) => c.safetyModelOrder.includes("danger"));
  return {
    n,
    "UXT-1 rank1 problem above 660px": `${r.filter((c) => c.firstRankedProblemAboveFold).length}/${n}`,
    "UXT-1 median y of rank1 problem": median(r.map((c) => c.firstRankedProblemY)),
    "UXT-1 shortlist present": `${r.filter((c) => c.shortlistPresent).length}/${n}`,
    "UXT-2 fixtures with a danger item": `${withDanger.length}/${n}`,
    "UXT-2 severity-ordered": `${r.filter((c) => sorted(c.safetyOrder.length ? c.safetyOrder : c.safetyModelOrder)).length}/${n}`,
    "UXT-2 stop-work strip above fold (danger fixtures)": `${withDanger.filter((c) => c.stopWorkAboveFold).length}/${withDanger.length}`,
    "UXT-2 false strip on no-danger fixtures": `${r.filter((c) => !c.safetyModelOrder.includes("danger") && c.stopWorkPresent).length}/${n - withDanger.length}`,
    "UXT-7 median corrective-action offset in rank1 card": median(r.map((c) => c.correctiveActionOffset)),
    "UXT-7 within 400px of card top": `${r.filter((c) => typeof c.correctiveActionOffset === "number" && c.correctiveActionOffset <= 400).length}/${n}`,
    "UXT-7 ranked data-labels present": median(r.map((c) => c.rankedLabels.length)),
    "UXT-8 #jump matches position": `${r.filter((c) => c.jump.matches === c.jump.total).length}/${n} full · median ${median(r.map((c) => c.jump.matches))}/${r[0]?.jump.total ?? 0} anchors`,
    "UXT-8 return-to-top control": `${r.filter((c) => c.mobileControlButtons.some((b) => /^top$|back to top|return to top/.test(b))).length}/${n}`,
    // "High first" is the wrong assertion: several fixtures have no High at all
    // on a given axis, so the criterion is that ONE tap yields severity
    // descending (and a second tap reverses it), not the literal word.
    "UXT-9 one tap on Likelihood sorts High→Low": `${r.filter((c) => descendingSeverity(c.sortLikelihood?.afterOne)).length}/${n}`,
    "UXT-9 one tap on Confidence sorts High→Low": `${r.filter((c) => descendingSeverity(c.sortConfidence?.afterOne)).length}/${n}`,
    "UXT-9 second tap reverses (both axes)": `${r.filter((c) => ascendingSeverity(c.sortLikelihood?.afterTwo) && ascendingSeverity(c.sortConfidence?.afterTwo)).length}/${n}`,
    "UXT-9 one tap on Rank sorts 1→N": `${r.filter((c) => ascendingRank(c.sortRank?.afterOne)).length}/${n}`,
    "UXT-9 sort buttons address the column they name": `${r.filter((c) => sortColumnsMatchLabels(c)).length}/${n}`,
    "UXT-12 median #ranked y": median(r.map((c) => c.sectionTops.ranked)),
    "UXT-12 median #priority y": median(r.map((c) => c.sectionTops.priority)),
    "doc height median (px)": median(r.map((c) => c.documentHeight)),
    "doc screens median": median(r.map((c) => c.screens)),
  };
}

function summarize(payload, priorPayload) {
  const now = rollup(payload);
  const before = priorPayload ? rollup(priorPayload) : null;
  console.log(`\n=== ${payload.label} (fixtures from ${payload.runId}, ${payload.viewport.width}x${payload.viewport.height}) ===\n`);
  const width = Math.max(...Object.keys(now).map((k) => k.length));
  for (const [k, v] of Object.entries(now)) {
    const prev = before ? `   (was ${before[k]})` : "";
    console.log(`${k.padEnd(width)}  ${v}${prev}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
