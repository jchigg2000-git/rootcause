/**
 * The report template.
 *
 * The server owns the document: doctype, head, CSP, stylesheet, section order,
 * numbering, table of contents, print rules and footer. The model contributes
 * only escaped text through `ReportData`.
 *
 * Styling is carried from the reference report in `docs/`, so generated reports
 * and that reference are the same document design rather than two designs the
 * model happened to invent on different days.
 */
import {
  BRAND,
  FONT_STACK,
  MONO_STACK,
  SEMANTIC,
  themeForMake,
  type ManufacturerTheme,
} from "../../lib/brand.ts";
import {
  EVIDENCE_LABELS,
  REPORT_SECTIONS,
  type Block,
  type ReportData,
  type SectionId,
  // Explicit extension: the test suite imports this module directly under
  // `node --test`, whose resolver has no extension inference.
} from "./report-schema.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Every model-supplied string passes through this before reaching the page. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  // The only script in the document is the one written below: table sorting,
  // print, and contents highlighting. No model text ever reaches it.
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * The document stylesheet, parameterised by manufacturer.
 *
 * Only the CHROME moves per make — masthead, hazard stripe, rails, chips. The
 * body surface, the type and every semantic colour are fixed, so two reports
 * are comparable at a glance and only their livery differs. Semantics
 * deliberately never vary: a report where "stop work" reads differently on a
 * Deere than on a Cat is a safety regression dressed up as branding.
 *
 * The theme is derived server-side from the intake `make` and is never
 * model-supplied — it is document chrome, like section numbering.
 */
const styles = (theme: ManufacturerTheme) => `
:root{
  --ink:${BRAND.ink};--muted:${BRAND.grey};--paper:${BRAND.paper};
  --panel:${BRAND.panel};--panel-2:${BRAND.panel2};
  --line:${BRAND.line};--line-heavy:${BRAND.lineHeavy};
  --chrome:${theme.chrome};--chrome-2:${theme.chromeDeep};--amber:${theme.accent};
  --danger:${SEMANTIC.danger};--danger-bg:${SEMANTIC.dangerBg};
  --warn:${SEMANTIC.warn};--warn-bg:${SEMANTIC.warnBg};
  --ok:${SEMANTIC.ok};--ok-bg:${SEMANTIC.okBg};
  --info:${SEMANTIC.info};--info-bg:${SEMANTIC.infoBg};
  --mono:${MONO_STACK};--sans:${FONT_STACK};
  --content:1180px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:64px;-webkit-text-size-adjust:100%}
body{margin:0;color:var(--ink);background:var(--paper);font-family:var(--sans);font-size:16px;line-height:1.5}
a{color:#1d4f6d;text-decoration-thickness:1px;text-underline-offset:2px}
a:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #0a66a8;outline-offset:2px;border-radius:2px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ---- masthead ---- */
.topbar{position:relative;background:var(--chrome);color:#fff}
.topbar::after{content:"";display:block;height:7px;background:repeating-linear-gradient(-45deg,var(--amber) 0 11px,var(--chrome-2) 11px 22px)}
.topbar-inner{max-width:var(--content);margin:auto;padding:18px 16px}
.eyebrow{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center;font:700 .68rem var(--mono);text-transform:uppercase;letter-spacing:.1em;color:#b9c0b6}
.report-mark{color:var(--amber);display:inline-flex;align-items:center;gap:.45rem}
.report-mark::before{content:"";width:.7rem;height:.7rem;border:2px solid var(--amber);display:inline-block}
h1{font-size:clamp(1.45rem,4.2vw,2.4rem);line-height:1.08;margin:.5rem 0;letter-spacing:-.01em}
.subtitle{max-width:900px;color:#cfd5cd;font-size:.95rem;margin:.2rem 0 .8rem}
.hero-meta{display:flex;flex-wrap:wrap;gap:6px}
.hero-chip{background:var(--chrome-2);border:1px solid rgba(255,255,255,.18);border-left:3px solid var(--amber);padding:5px 9px;border-radius:2px;font:600 .72rem var(--mono);color:#dfe3da}
.hero-chip strong{color:var(--amber);font-weight:700;margin-right:.35rem;text-transform:uppercase;letter-spacing:.04em;font-size:.66rem}

/* Stop-work strip. A light block on the dark chrome, so it reads without the
   semantic tokens fighting the livery; "STOP WORK" is spelled out because
   nothing may depend on colour alone. Emitted only when a danger item exists. */
.stopwork{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:.55rem 0 .1rem;padding:9px 11px;border-radius:2px;background:var(--danger-bg);border:1px solid var(--danger);border-left:5px solid var(--danger);color:var(--ink);text-decoration:none}
.stopwork-tag{font:800 .68rem var(--mono);text-transform:uppercase;letter-spacing:.09em;color:var(--danger);white-space:nowrap}
.stopwork-text{font-size:.86rem;font-weight:600}
.stopwork:hover{background:#fff}

/* ---- mobile controls (shared pattern) ---- */
.mobile-controls{display:none;position:sticky;top:0;z-index:30;background:var(--chrome);border-bottom:1px solid #000;padding:6px 8px;gap:8px;align-items:center}
.mobile-controls .small{color:#b9c0b6;font:700 .68rem var(--mono);text-transform:uppercase;letter-spacing:.06em}
.mobile-controls select{min-width:0;flex:1;min-height:44px;padding:0 10px;border:1px solid #4a534b;background:var(--chrome-2);color:#fff;border-radius:2px;font:700 .85rem var(--mono)}

/* ---- buttons (shared pattern) ---- */
.button{display:inline-block;border:1px solid #4a534b;background:var(--chrome-2);color:#fff;padding:0 14px;min-height:44px;line-height:42px;border-radius:2px;font:700 .78rem var(--mono);letter-spacing:.04em;text-transform:uppercase;cursor:pointer;text-decoration:none;text-align:center}
.button:hover{background:var(--chrome);border-color:var(--amber)}

/* ---- layout + sidebar TOC (shared pattern) ---- */
.layout{max-width:var(--content);margin:0 auto;display:grid;grid-template-columns:232px minmax(0,1fr);gap:18px;padding:18px 14px 60px}
.toc{position:sticky;top:12px;align-self:start;background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:8px;max-height:calc(100vh - 24px);overflow:auto}
.toc strong{display:block;margin:4px 8px 8px;color:var(--muted);font:700 .66rem var(--mono);text-transform:uppercase;letter-spacing:.1em}
.toc a{display:block;color:#39413a;text-decoration:none;border-left:3px solid transparent;padding:8px 9px;font-size:.84rem;font-weight:600}
.toc a:hover{background:var(--panel-2)}
.toc a.active{border-left-color:var(--amber);background:var(--panel-2);color:var(--ink);font-weight:800}
.toc-actions{display:grid;gap:6px;margin-top:10px;padding:0 4px 4px}
.toc-actions .button{line-height:normal;display:grid;place-items:center}
main{min-width:0}

/* ---- sections ---- */
section{scroll-margin-top:64px;margin-bottom:14px;background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:clamp(14px,2.5vw,24px)}
section > h2{margin:-2px 0 14px;color:var(--ink);font-size:clamp(1.12rem,2.4vw,1.5rem);line-height:1.2;border-bottom:1px solid var(--line);padding:0 0 9px 12px;border-left:4px solid var(--amber);letter-spacing:-.01em}
h3{color:var(--ink);margin:22px 0 8px;font-size:1.02rem}
h4{margin:16px 0 6px;color:var(--ink);font-size:.92rem}
p{margin:.5rem 0 .9rem}
.lede{font-size:1rem;color:#2c342d}
.small{font-size:.82rem;color:var(--muted)}
ul,ol{padding-left:1.2rem}
li{margin:.34rem 0}

/* ---- cards ---- */
.grid{display:grid;gap:10px}
.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:2px;padding:13px 14px}
.card h3,.card h4{margin-top:0}
.kpi{border-top:3px solid var(--line-heavy)}
.kpi.urgent{border-top-color:var(--danger)}
.kpi.caution{border-top-color:var(--warn)}
.kpi-label{font:700 .64rem var(--mono);text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.kpi-value{font:700 1.05rem var(--mono);color:var(--ink);margin:.25rem 0;letter-spacing:-.01em}
.core-finding{border-top:3px solid var(--amber);background:var(--panel-2)}

/* ---- callouts ---- */
.callout{border:1px solid var(--line);border-left:4px solid var(--info);background:var(--info-bg);padding:12px 14px;border-radius:2px;margin:14px 0;font-size:.93rem}
.callout.warning{border-left-color:var(--warn);background:var(--warn-bg)}
.callout.danger{border-left-color:var(--danger);background:var(--danger-bg)}
.callout strong{display:block;margin-bottom:.25rem}

/* ---- evidence labels ---- */
.badge{display:inline-block;border:1px solid currentColor;border-radius:2px;padding:1px 6px;font:700 .6rem var(--mono);letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;background:#fff}
.b-confirmed{color:var(--ok)}.b-component{color:var(--info)}.b-inference{color:var(--warn)}
.b-family{color:#4f4770}.b-field{color:#7c3f22}.b-gap{color:var(--danger)}.b-na{color:#5b5f5b}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:10px 0 2px}

/* First-screen shortlist. Deliberately terse -- rank, name, likelihood. Any
   more and it competes with the ranked section instead of pointing at it. */
.priority-list{margin:0 0 12px;border:1px solid var(--line-heavy);border-top:3px solid var(--amber);border-radius:2px;background:var(--panel);padding:9px 11px}
.priority-list .kpi-label{margin-bottom:.35rem}
.priority-list ol{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.priority-list li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.priority-list a{display:flex;gap:8px;align-items:baseline;color:var(--ink);text-decoration:none;flex:1;min-width:0}
.priority-list a:hover .shortlist-problem{text-decoration:underline}
.shortlist-rank{font:800 .72rem var(--mono);color:var(--amber);border:1px solid var(--line-heavy);border-radius:2px;padding:0 .38rem;background:#fff;flex:none}
.shortlist-problem{font-weight:650;font-size:.9rem;line-height:1.3}

/* ---- tables ----
   No min-width anywhere: a table that cannot fit reflows to labelled cards
   rather than scrolling sideways: horizontal scrolling on a phone was a
   reported defect, not a hypothetical. Every td carries data-label, which is
   what both the card reflow and the print layout read. */
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:2px;background:var(--panel);margin:12px 0 18px}
table{border-collapse:collapse;width:100%;font-size:.85rem}
caption{text-align:left;padding:9px 12px;font:700 .66rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
th,td{padding:8px 10px;border-bottom:1px solid #e3e5df;vertical-align:top;text-align:left}
th{background:var(--panel-2);color:var(--ink);font:700 .66rem var(--mono);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)}
tbody tr:nth-child(even){background:#fbfbf9}
tbody tr:hover{background:#f6f6f2}
td:first-child,th:first-child{padding-left:12px}
th.sortable{cursor:pointer}
th.sortable::after{content:"\\2195";font-size:.9em;color:#7d857c;margin-left:.3rem}
th.sortable[aria-sort="ascending"]::after{content:"\\2191";color:var(--ink)}
th.sortable[aria-sort="descending"]::after{content:"\\2193";color:var(--ink)}
.status{display:inline-block;border-radius:2px;padding:1px 6px;font:700 .68rem var(--mono);border:1px solid currentColor;text-transform:uppercase;letter-spacing:.03em;background:#fff}
.status.high{color:var(--danger)}.status.medium{color:var(--warn)}.status.low{color:var(--ok)}
.cite{font-family:var(--mono);font-weight:700;text-decoration:none;font-size:.76em;vertical-align:super}
code{font-family:var(--mono);font-size:.92em;background:var(--panel-2);padding:1px 5px;border-radius:2px}

/* ---- the ranked table is ALWAYS cards ----
   Twelve columns of free prose is unreadable as a grid at any width, and it
   is what "the top solutions/problems look like crap" referred to. The table
   markup is kept for semantics, sorting and print. */
.ranked-table,.ranked-table tbody{display:block;width:100%}
.ranked-table thead{display:none}
.ranked-table tbody tr{display:block;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line-heavy);border-radius:2px;margin:0 0 10px;padding:2px 0}
.ranked-table tbody tr:nth-child(even){background:var(--panel)}
.ranked-table tbody tr:hover{background:var(--panel)}
/* Label beside value, so a twelve-field card stays compact and scannable. It
   drops to a stack below 720px, where there is no room for two columns. */
.ranked-table td{display:grid;grid-template-columns:186px minmax(0,1fr);gap:14px;padding:8px 12px 7px;border-bottom:1px solid #ebece7;font-size:.88rem;overflow-wrap:anywhere}
.ranked-table td:last-child{border-bottom:0}
.ranked-table td::before{content:attr(data-label);font:700 .6rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-top:.2rem}
/* Grid children stretch by default, which would blow a status pill out to the
   full column width. */
.ranked-table td > .status{justify-self:start}
.ranked-table td[data-label="Rank"]{display:block;background:var(--chrome);color:#fff;padding:7px 12px;font:700 .8rem var(--mono);border-bottom:0}
.ranked-table td[data-label="Rank"]::before{color:rgba(255,255,255,.7);margin-right:.5rem;padding:0}
.ranked-table td[data-label="Problem"]{display:block;font-weight:700;font-size:1.02rem;line-height:1.3;background:var(--panel-2);border-bottom:1px solid var(--line)}
.ranked-table td[data-label="Problem"]::before{display:block;margin-bottom:.25rem;padding:0}
.ranked-sort{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0}
.ranked-sort .small{margin-right:.2rem}
.ranked-sort button{border:1px solid var(--line-heavy);background:#fff;color:var(--ink);border-radius:2px;min-height:34px;padding:0 10px;font:700 .68rem var(--mono);text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
.ranked-sort button[aria-pressed="true"]{background:var(--chrome);color:#fff;border-color:var(--chrome)}
/* Direction is carried by a glyph inside the button, not by the pressed fill
   alone -- the fill says "this is the active column", never which way it runs. */
.sort-dir{margin-left:.4rem;font-weight:800}

/* ---- lists ---- */
.checklist{list-style:none;padding:0}
.checklist li{position:relative;padding-left:26px;min-height:24px}
.checklist li::before{content:"\\2610";position:absolute;left:2px;top:-1px;font:800 1rem var(--mono);color:var(--line-heavy)}
.steps{counter-reset:step;list-style:none;padding:0;display:grid;gap:8px}
.steps li{counter-increment:step;display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;padding:10px 12px;background:var(--panel-2);border:1px solid var(--line);border-radius:2px;margin:0}
.steps li::before{content:counter(step,decimal-leading-zero);width:30px;height:24px;display:grid;place-items:center;background:var(--chrome);color:#fff;font:700 .74rem var(--mono);border-radius:2px;margin-top:2px}

/* ---- sources ---- */
.source-list{display:grid;gap:8px;list-style:none;padding:0;counter-reset:src}
.source-list li{counter-increment:src;border:1px solid var(--line);border-radius:2px;background:#fff;padding:11px 12px;overflow-wrap:anywhere;margin:0}
.source-title{display:block;font-weight:700;font-size:.92rem}
.source-title::before{content:"[" counter(src) "] ";font-family:var(--mono);color:var(--muted)}
.source-meta{font-size:.78rem;color:var(--muted)}
.url{font-family:var(--mono);font-size:.72rem;word-break:break-all}
.gap-note{font-size:.88rem;color:var(--muted);font-style:italic}
.footer-note{max-width:var(--content);margin:auto;padding:0 16px 34px;color:var(--muted);font-size:.78rem}

/* ---- responsive ---- */
@media (max-width:1100px){
  .layout{grid-template-columns:208px minmax(0,1fr)}
  .grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:800px){
  .mobile-controls{display:flex}
  .layout{grid-template-columns:1fr;padding:12px 8px 50px}
  .toc{display:none}
  .topbar-inner{padding:14px 12px}
  .grid-2,.grid-3{grid-template-columns:1fr}
}
@media (max-width:720px){
  section{padding:13px 12px;border-left:0;border-right:0;border-radius:0;margin-bottom:10px}
  /* Every remaining table becomes cards too. */
  .table-wrap{overflow:visible;border:0;background:none}
  .table-wrap table,.table-wrap tbody{display:block;width:100%}
  .table-wrap thead{display:none}
  .table-wrap tr{display:block;background:#fff;border:1px solid var(--line);border-left:3px solid var(--line-heavy);border-radius:2px;margin:0 0 10px;padding:2px 0}
  .table-wrap tbody tr:nth-child(even){background:#fff}
  .table-wrap td{display:block;padding:8px 10px 7px;border-bottom:1px solid #ebece7;font-size:.88rem;overflow-wrap:anywhere}
  .table-wrap td:last-child{border-bottom:0}
  .table-wrap td::before{content:attr(data-label);display:block;font:700 .6rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:2px}
  .steps li{grid-template-columns:1fr}
  .steps li::before{margin-bottom:4px}
  /* No room for a label column on a phone: stack label over value. */
  .ranked-table td{display:block}
  .ranked-table td::before{display:block;margin-bottom:2px;padding:0}
}
@media (max-width:430px){
  h1{font-size:1.35rem}
  .mobile-controls .small{display:none}
}

/* ---- print ---- */
@page{size:auto;margin:12mm}
@media print{
  body{background:#fff;font-size:9.5pt;color:#000}
  .topbar{background:#fff!important;color:#000}
  .topbar::after{display:none}
  .topbar-inner{padding:0 0 10px;border-bottom:2px solid #000}
  .eyebrow,.subtitle{color:#222}
  .report-mark{color:#000}.report-mark::before{border-color:#000}
  .hero-chip{border:1px solid #777;border-left:3px solid #000;background:#fff;color:#000}
  .mobile-controls,.toc,.no-print,.ranked-sort{display:none!important}
  .layout{display:block;max-width:none;padding:0}
  main{width:100%}
  section{border:0;border-radius:0;padding:10px 0;margin:0 0 12px}
  section > h2{break-after:avoid;border-left:0;padding-left:0;border-bottom:1px solid #000}
  h3,h4{break-after:avoid}
  .card,.callout,.source-list li{break-inside:avoid}
  .table-wrap{overflow:visible;border:0}
  table{width:100%;font-size:7.3pt}
  th,td{padding:4px 5px}
  th{background:#eee!important}
  table:not(.ranked-table) tr{break-inside:avoid}
  .ranked-table,.ranked-table tbody{display:block!important;width:100%!important;font-size:8pt!important}
  .ranked-table thead{display:none!important}
  .ranked-table tbody tr{display:block!important;border:1px solid #999;border-radius:2px;margin:0 0 8px;padding:3px 5px;break-inside:avoid;background:#fff}
  .ranked-table td{display:grid!important;grid-template-columns:112px minmax(0,1fr);gap:7px;width:100%!important;padding:3px 4px;border-bottom:1px solid #ddd;font-size:8pt;overflow-wrap:anywhere}
  .ranked-table td:last-child{border-bottom:0}
  .ranked-table td::before{content:attr(data-label);font-weight:800;text-transform:uppercase;color:#000;font-size:6.8pt;letter-spacing:.025em;margin:0}
  a[href^="http"]::after{content:" (" attr(href) ")";font-size:6.5pt;color:#333}
  a.cite::after,.url::after{content:none}
}
`.trim();

const SCRIPT = `
(function () {
  function print() { window.print(); }
  ["print-btn", "print-btn-mobile"].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", print);
  });

  // The SPA toolbar's own "Print / save as PDF" button lives in the parent
  // page, not this document. This frame is sandboxed without
  // allow-same-origin (deliberately — see diagnostic-app.tsx), so the parent
  // cannot reach contentWindow.print() directly; postMessage is the one
  // channel a cross-origin sandboxed frame still allows.
  window.addEventListener("message", function (event) {
    if (event.data === "rootcause:print") window.print();
  });

  // Hosted as the SPA preview's srcdoc, this document's base URL is the
  // parent page's URL — so a bare "#section" href resolves to the site URL
  // and navigates the frame into the app's own anti-framing refusal
  // (the browser's "refused to connect" frame error). Scroll in place
  // instead. A downloaded copy (file:/blob:) keeps native fragment navigation.
  if (location.href === "about:srcdoc") {
    document.addEventListener("click", function (event) {
      var anchor = event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!anchor) return;
      event.preventDefault();
      var target = document.getElementById(anchor.getAttribute("href").slice(1));
      if (target) target.scrollIntoView();
    });
  }

  var jump = document.getElementById("jump");
  if (jump) jump.addEventListener("change", function () {
    var target = document.getElementById(jump.value);
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });

  var toTop = document.getElementById("to-top");
  if (toTop) toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // The ranked table renders as cards at every width, so its header row is
  // never visible. Sorting is driven by the buttons above it instead.
  var ranked = document.querySelector("table.ranked-table");
  var sortButtons = Array.prototype.slice.call(document.querySelectorAll(".ranked-sort button"));
  sortButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      if (!ranked) return;
      var column = parseInt(button.getAttribute("data-sort-col"), 10);
      // A fresh press takes the column's own default direction; only a re-press
      // of the already-active column reverses. Severity columns default to
      // descending, because "High first" is the only useful first answer --
      // sorting Likelihood used to need two taps to stop showing Low first.
      var alreadyActive = button.getAttribute("aria-pressed") === "true";
      var descending = alreadyActive
        ? button.dataset.dir !== "desc"
        : button.getAttribute("data-default-dir") === "desc";
      sortButtons.forEach(function (other) {
        other.setAttribute("aria-pressed", String(other === button));
        if (other !== button) {
          delete other.dataset.dir;
          other.removeAttribute("data-active-dir");
        }
      });
      button.dataset.dir = descending ? "desc" : "asc";
      // Direction is announced in text, never by the pressed styling alone.
      button.setAttribute("data-active-dir", descending ? "desc" : "asc");
      var arrow = button.querySelector(".sort-dir");
      if (arrow) arrow.textContent = descending ? "↓" : "↑";
      sortButtons.forEach(function (other) {
        if (other === button) return;
        var otherArrow = other.querySelector(".sort-dir");
        if (otherArrow) otherArrow.textContent = "";
      });
      button.setAttribute(
        "aria-label",
        button.getAttribute("data-sort-label") + ", sorted " + (descending ? "high to low" : "low to high"),
      );
      var body = ranked.tBodies[0];
      Array.prototype.slice.call(body.rows).sort(function (a, b) {
        var x = a.cells[column], y = b.cells[column];
        var xv = x ? (x.getAttribute("data-sort") || x.textContent).trim() : "";
        var yv = y ? (y.getAttribute("data-sort") || y.textContent).trim() : "";
        var xn = parseFloat(xv), yn = parseFloat(yv);
        var result = !isNaN(xn) && !isNaN(yn) ? xn - yn : xv.localeCompare(yv);
        return descending ? -result : result;
      }).forEach(function (row) { body.appendChild(row); });
    });
  });

  // TOC highlight. Not an IntersectionObserver: inside the sandboxed srcdoc
  // preview this document is cross-origin, where the implicit root ignores
  // rootMargin — the observation band silently becomes the whole viewport and
  // the last section to clip an edge wins, highlighting the neighbour of the
  // section a TOC click actually landed on. Computing from scroll position
  // depends only on where the scroll settles. The 78px line sits just below
  // the 64px scroll-margin-top a jumped-to section settles at.
  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  var sections = Array.prototype.slice.call(document.querySelectorAll("main section"));
  var highlightQueued = false;
  function highlightCurrent() {
    highlightQueued = false;
    if (!sections.length) return;
    var current = sections[0];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top > 78) break;
      current = sections[i];
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = sections[sections.length - 1];
    }
    links.forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("href") === "#" + current.id);
    });
    // The mobile jump menu is the TOC's only counterpart below 720px, where the
    // rail is hidden -- leaving it pinned to section 1 for the whole document
    // made it a jump control that never told you where you were.
    if (jump && jump.value !== current.id) jump.value = current.id;
  }
  window.addEventListener("scroll", function () {
    if (highlightQueued) return;
    highlightQueued = true;
    requestAnimationFrame(highlightCurrent);
  }, { passive: true });
  highlightCurrent();
})();
`.trim();

function badge(label?: string): string {
  if (!label) return "";
  const className = EVIDENCE_LABELS[label] ?? "b-na";
  return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
}

/** High/Medium/Low sort ahead of each other, not alphabetically. */
const QUALITATIVE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Qualitative values become status pills, as in the reference. */
function statusPill(value: string): string {
  if (!value) return '<span class="small">Not stated</span>';
  const key = value.toLowerCase();
  return `<span class="status ${escapeHtml(key)}">${escapeHtml(value)}</span>`;
}

function qualitativeCell(label: string, value: string): string {
  if (!value) return `<td data-label="${escapeHtml(label)}" class="small">Not stated</td>`;
  const key = value.toLowerCase();
  return `<td data-label="${escapeHtml(label)}" data-sort="${QUALITATIVE_RANK[key] ?? 0}">${statusPill(value)}</td>`;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${block.label ? `${badge(block.label)} ` : ""}${escapeHtml(block.text)}</p>`;
    case "list": {
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      if (block.style === "steps") return `<ol class="steps">${items}</ol>`;
      if (block.style === "checklist") return `<ul class="checklist">${items}</ul>`;
      return `<ul>${items}</ul>`;
    }
    case "table": {
      const head = block.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("");
      // data-label is what the card reflow and the print layout read. Without
      // it a narrow viewport has no way to render this except sideways.
      const body = block.rows
        .map((row) => {
          const cells = block.columns
            .map(
              (column, index) =>
                `<td data-label="${escapeHtml(column)}">${escapeHtml(row[index] ?? "")}</td>`,
            )
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : "";
      return `<div class="table-wrap"><table>${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    case "callout":
      return `<div class="callout ${block.tone === "info" ? "" : block.tone}">${
        block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ""
      }${escapeHtml(block.text)}</div>`;
    case "cards": {
      const cards = block.cards
        .map(
          (card) =>
            `<div class="card"><h4>${escapeHtml(card.title)}</h4>${
              card.label ? `<p>${badge(card.label)}</p>` : ""
            }<p>${escapeHtml(card.text)}</p></div>`,
        )
        .join("");
      return `<div class="grid grid-2">${cards}</div>`;
    }
  }
}

const renderBlocks = (blocks: Block[] = []): string => blocks.map(renderBlock).join("\n");

const GAP_NOTE =
  '<p class="gap-note">The model supplied no content for this section. Treat it as an open evidence gap, not as a finding of "nothing to report."</p>';

/**
 * The evidence legend. Lives in §1 rather than beside the ranked table: the
 * labels are used from the core finding onward, and `sample-prompt.md:89` puts
 * the vocabulary before the first thing that speaks it.
 */
function renderLegend(): string {
  return `<div class="legend">${Object.keys(EVIDENCE_LABELS).map(badge).join("")}</div>`;
}

/**
 * The first-screen shortlist `sample-prompt.md:162` asks for and the reference
 * implements (§1 `.priority-list` + `#field-action`). Without it the report's
 * answer to "what is wrong" first appears in the ranked table, ~3800px down at
 * 390x660 -- past the fold in 10/10 frozen fixtures.
 *
 * It is a pointer, not a second ranked list: rank, problem, likelihood, each
 * anchored to `#ranked` where the full twelve fields live.
 */
function renderShortlist(data: ReportData): string {
  if (!data.ranked.length) return "";
  const items = data.ranked
    .slice(0, 3)
    .map(
      (item) =>
        `<li>
           <a href="#ranked">
             <span class="shortlist-rank">${escapeHtml(String(item.rank))}</span>
             <span class="shortlist-problem">${escapeHtml(item.problem)}</span>
           </a>
           ${statusPill(item.likelihood)}
         </li>`,
    )
    .join("");
  // The label stays one line at 390px on purpose. A wrapped second line costs
  // ~18px, which is the whole fold margin on a report that also carries a
  // stop-work strip — every entry links to §5, so the label need not say so.
  return `<nav class="priority-list" id="field-action" aria-label="Most likely problems — full detail in section 5">
    <div class="kpi-label">Most likely</div>
    <ol>${items}</ol>
  </nav>`;
}

function renderIdentity(data: ReportData): string {
  const core = data.coreFinding;
  const finding = core.statement
    ? `<div class="card core-finding">
         <div class="kpi-label">Core finding</div>
         <p>${badge(core.label)}</p>
         <p class="lede">${escapeHtml(core.statement)}</p>
         <p class="small">Likelihood: ${escapeHtml(core.likelihood || "not stated")} &middot; Confidence: ${escapeHtml(core.confidence || "not stated")}</p>
       </div>`
    : "";
  const kpis = data.kpis.length
    ? `<div class="grid grid-3">${data.kpis
        .map(
          (kpi) =>
            `<div class="card kpi ${kpi.tone === "normal" ? "" : kpi.tone}">
               <div class="kpi-label">${escapeHtml(kpi.label)}</div>
               <div class="kpi-value">${escapeHtml(kpi.value)}</div>
             </div>`,
        )
        .join("")}</div>`
    : "";
  const body = `${renderShortlist(data)}${finding}${renderLegend()}${kpis}${renderBlocks(data.sections.identity)}`;
  return body.trim() || GAP_NOTE;
}

/**
 * Severity order for safety callouts. The model emits them in whatever order it
 * wrote them, which put a `danger` behind a `warning` in the frozen fixtures.
 * Stable, so items of equal severity keep the model's ordering — it carries the
 * model's own sense of which warning matters most within a tier.
 */
const SAFETY_RANK: Record<string, number> = { danger: 0, warning: 1, info: 2 };

function orderedSafety(data: ReportData): ReportData["safety"] {
  return data.safety
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const delta = (SAFETY_RANK[a.item.tone] ?? 2) - (SAFETY_RANK[b.item.tone] ?? 2);
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * A stop-work signal in the masthead, so a `danger` item is not something the
 * operator finds twelve screens in. Emitted only when one exists — a strip on
 * every report is a strip nobody reads. It carries its own text label because
 * nothing may ride on colour alone, and the semantic `--danger` tokens never
 * vary by manufacturer (unlike the rest of the livery).
 */
function renderStopWork(data: ReportData): string {
  const danger = data.safety.find((item) => item.tone === "danger");
  if (!danger) return "";
  return `<a class="stopwork" data-stopwork href="#safety">
    <span class="stopwork-tag">Stop work</span>
    <span class="stopwork-text">${escapeHtml(danger.title)}</span>
  </a>`;
}

function renderSafety(data: ReportData): string {
  const callouts = orderedSafety(data)
    .map(
      (item) =>
        `<div class="callout ${item.tone === "info" ? "" : item.tone}">
           <strong>${escapeHtml(item.title)}</strong>${escapeHtml(item.detail)}
         </div>`,
    )
    .join("");
  const body = `${callouts}${renderBlocks(data.sections.safety)}`;
  return body.trim() || GAP_NOTE;
}

/**
 * Twelve columns. The set matches `sample-prompt.md` §5 — "Controller /
 * fault-code evidence" was missing until 2026-08-05 — but the ORDER
 * deliberately no longer matches the reference document's `<thead>`.
 *
 * Ratified 2026-08-19, measured: the card is read top-down, and "Corrective
 * action" used to sit 1144px below the card top, under six fields of prose.
 * Leading with what to do puts it at 219px median across the ten fixtures. The
 * reference is the design ancestor for this table, not a byte-order contract.
 *
 * ⚠ RANKED_SORTS below indexes into this array and reaches the client as
 * `data-sort-col`. Reorder one without the other and the buttons silently sort
 * a different column — pinned in both directions by the ranked-card test.
 */
const RANKED_COLUMNS = [
  "Rank",
  "Problem",
  "Likelihood",
  "Confidence",
  "Corrective action",
  "Confirmation tests",
  "Do not replace until",
  "Applicable variant",
  "Why it happens",
  "What the operator notices",
  "Controller / fault-code evidence",
  "Sources",
];

/**
 * Columns worth sorting by. Indexes are into RANKED_COLUMNS and reach the
 * client script as `data-sort-col` — reorder RANKED_COLUMNS and these indexes
 * MUST move with it or the buttons silently sort the wrong column.
 *
 * `defaultDir` is what a *fresh* press does. Severity reads High-first or it
 * reads backwards; rank reads 1-first.
 */
const RANKED_SORTS = [
  { index: 0, label: "Rank", defaultDir: "asc" },
  { index: 2, label: "Likelihood", defaultDir: "desc" },
  { index: 3, label: "Confidence", defaultDir: "desc" },
];

function renderRanked(data: ReportData): string {
  if (!data.ranked.length) return `${GAP_NOTE}${renderBlocks(data.sections.ranked)}`;

  const head = RANKED_COLUMNS.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("");

  // The header row is hidden at every width, so sorting is driven by explicit
  // buttons rather than by clicking a `th` nobody can see.
  const sorts = RANKED_SORTS.map(
    (sort, position) =>
      `<button type="button" data-sort-col="${sort.index}" data-default-dir="${sort.defaultDir}" data-sort-label="${escapeHtml(
        sort.label,
      )}" aria-pressed="${position === 0}"${position === 0 ? ' data-dir="asc" data-active-dir="asc"' : ""}>${escapeHtml(
        sort.label,
      )}<span class="sort-dir" aria-hidden="true">${position === 0 ? "↑" : ""}</span></button>`,
  ).join("");

  const cell = (label: string, value: string) =>
    `<td data-label="${escapeHtml(label)}">${escapeHtml(value)}</td>`;

  const rows = data.ranked
    .map((item) => {
      // One element, not several: each cell is a grid item, so a bare list of
      // anchors would spill onto its own row per anchor.
      const citations = item.sources.length
        ? `<span>${item.sources
            .map((id) => `<a class="cite" href="#src-${id}">[${id}]</a>`)
            .join(" ")}</span>`
        : '<span class="small">None cited</span>';
      return `<tr>
        <td data-label="Rank" data-sort="${item.rank}">${item.rank}</td>
        ${cell("Problem", item.problem)}
        ${qualitativeCell("Likelihood", item.likelihood)}
        ${qualitativeCell("Confidence", item.confidence)}
        ${cell("Corrective action", item.action)}
        ${cell("Confirmation tests", item.tests)}
        ${cell("Do not replace until", item.doNotReplaceUntil)}
        ${cell("Applicable variant", item.variant)}
        ${cell("Why it happens", item.why)}
        ${cell("What the operator notices", item.symptoms)}
        ${cell("Controller / fault-code evidence", item.codes)}
        <td data-label="Sources">${citations}</td>
      </tr>`;
    })
    .join("");

  return `<div class="ranked-sort no-print">
      <span class="small">Sort by</span>${sorts}
    </div>
    <table class="ranked-table">
      <caption class="sr-only">Ranked most likely problems</caption>
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${renderBlocks(data.sections.ranked)}`;
}

function renderSources(data: ReportData): string {
  if (!data.sources.length) return `${GAP_NOTE}${renderBlocks(data.sections.sources)}`;
  const items = data.sources
    .map(
      (source, index) =>
        `<li id="src-${index + 1}">
           <div class="source-title">${escapeHtml(source.title)}</div>
           <div class="source-meta">${escapeHtml(source.meta)}</div>
           ${
             source.url
               ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open source page</a>
                  <div class="url">${escapeHtml(source.url)}</div>`
               : '<div class="small">No durable public URL was verified for this source.</div>'
           }
         </li>`,
    )
    .join("");
  return `<ol class="source-list">${items}</ol>${renderBlocks(data.sections.sources)}`;
}

function renderSectionBody(id: SectionId, data: ReportData): string {
  if (id === "identity") return renderIdentity(data);
  if (id === "safety") return renderSafety(data);
  if (id === "ranked") return renderRanked(data);
  if (id === "sources") return renderSources(data);
  const blocks = renderBlocks(data.sections[id]);
  return blocks.trim() || GAP_NOTE;
}

/** Render report data into the complete standalone document. */
export function renderReport(data: ReportData, make?: string): string {
  // Livery follows the machine's manufacturer.
  const theme = themeForMake(make);
  const toc = REPORT_SECTIONS.map(
    (section, index) =>
      `<a href="#${section.id}">${index + 1}. ${escapeHtml(section.title)}</a>`,
  ).join("");

  const jumpOptions = REPORT_SECTIONS.map(
    (section, index) =>
      `<option value="${section.id}">${index + 1}. ${escapeHtml(section.title)}</option>`,
  ).join("");

  const sections = REPORT_SECTIONS.map(
    (section, index) =>
      `<section id="${section.id}" aria-labelledby="${section.id}-title">
         <h2 id="${section.id}-title">${index + 1}. ${escapeHtml(section.title)}</h2>
         ${renderSectionBody(section.id, data)}
       </section>`,
  ).join("\n");

  // "Label: value" splits into a mono label and its value, as in the reference.
  const chips = data.metaChips
    .map((chip) => {
      const split = chip.indexOf(":");
      if (split <= 0) return `<span class="hero-chip">${escapeHtml(chip)}</span>`;
      return `<span class="hero-chip"><strong>${escapeHtml(
        chip.slice(0, split),
      )}</strong>${escapeHtml(chip.slice(split + 1).trim())}</span>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(data.title)}</title>
<style>${styles(theme)}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <p class="eyebrow">
      <span class="report-mark">Independent technical field report</span>
      ${data.generatedOn ? `<span>Generated ${escapeHtml(data.generatedOn)}</span>` : ""}
    </p>
    ${renderStopWork(data)}
    <h1>${escapeHtml(data.title)}</h1>
    ${data.lede ? `<p class="subtitle">${escapeHtml(data.lede)}</p>` : ""}
    ${chips ? `<div class="hero-meta">${chips}</div>` : ""}
  </div>
</header>

<div class="mobile-controls no-print">
  <span class="small">Jump</span>
  <label class="sr-only" for="jump">Jump to section</label>
  <select id="jump">${jumpOptions}</select>
  <button class="button" id="to-top" type="button">Top</button>
  <button class="button" id="print-btn-mobile" type="button">Print</button>
</div>

<div class="layout">
  <nav class="toc no-print" aria-label="Contents">
    <strong>Field report</strong>
    ${toc}
    <div class="toc-actions">
      <button class="button" id="print-btn" type="button">Print / save as PDF</button>
    </div>
  </nav>
  <main id="main-content">
${sections}
  </main>
</div>

<footer class="footer-note">
  <p>Generated ${escapeHtml(data.generatedOn)}. ${escapeHtml(
    data.disclaimer ||
      "AI-assisted troubleshooting supports, but does not replace, manufacturer procedures, qualified inspection, or safe work practices.",
  )}</p>
</footer>

<script>${SCRIPT}</script>
</body>
</html>`;
}
