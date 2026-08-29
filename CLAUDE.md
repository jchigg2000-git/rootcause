# RootCause — repo guide

Notes for anyone (human or agent) changing this codebase. Everything here is a constraint
that something else depends on, with the reason attached. If a rule looks arbitrary, the
reason is the part to read — several of these were regressions once.

## What this is

A heavy-equipment diagnostic intake app. An operator describes a machine and a symptom,
optionally attaches photos, answers a short model-led interview, and downloads a standalone
HTML field report.

## Stack

- vinext (Next.js App Router on Vite) + React 19, TypeScript
- Plain Node.js — one process, vinext's own server. No edge runtime, no worker entry.
- **better-sqlite3** over two files: `db/app.db` (everything that matters) and
  `db/observability.db` (disposable telemetry). Both gitignored.
- Model calls go out through `app/api/diagnose/providers.ts`; server config is read only in
  `app/lib/server-env.ts`, over `process.env`
- Plain CSS (`app/globals.css`). No UI framework, no Tailwind.

## Port 5211

Pinned in three places that must stay in sync: `vite.config.ts` (`port` + `strictPort: true`),
the `dev` and `start` scripts in `package.json`, and the `localhost:5211` metadata fallback in
`app/layout.tsx`.

## `npm start` must keep its leading `exec`

```
"start": "exec vinext start --port ${PORT:-5211}"
```

The `exec` is not symmetry with `dev` — it is what makes node npm's *direct* child, which is
the only reason SIGTERM reaches node at all. `instrumentation.ts` installs a shutdown hook that
checkpoints the SQLite WAL and closes every handle; without `exec`, npm's `sh` wrapper is what
gets signalled, node dies by SIGKILL, and **every shutdown handler in the app is silently
dead** — with no error anywhere, because SQLite recovers the WAL on next open. Pinned by
`tests/deploy-contract.test.mjs`.

Three further properties of that hook are load-bearing:

- It must **keep exiting itself.** Adding a listener replaces Node's default disposition; not
  exiting means hanging until SIGKILL.
- It uses **`process.on`, not `process.once`.** `once` deregisters before invoking, restoring
  the default disposition, so a second signal during the checkpoint kills the process
  mid-fold. The `shuttingDown` flag is the re-entry guard and needs the listener installed.
- It is **best-effort but reports honestly.** A failed checkpoint can never block the exit, so
  `closeDatabases()` returns a per-handle tally and the log line prints it — a contended
  `wal_checkpoint(TRUNCATE)` answers "busy" rather than throwing, and an unconditional success
  line would read as healthy on exactly the deploy that regressed.

## Data layer

`app/lib/db.ts` wraps better-sqlite3 in an async-shaped adapter. Two things in it were
verified by experiment and are easy to break:

- **`batch()` is a real `raw.transaction()`**, never `Promise.all`.
- **`prepare()` is lazy.** The schema runner prepares every statement in a migration before
  any of them executes, so eager preparation fails on a `CREATE INDEX` against a table the
  same batch has not created yet.

### Migrations re-run in full on every boot

`migrations/*.sql` is the single source of schema. Files are imported with `?raw` and executed
by `createSchemaRunner`, so local development needs no migration step — but it also means a
bare `ALTER TABLE` in a `.sql` file **fails on boot #2**.

Adding a column means doing both: put it in the table's `CREATE` (for fresh databases) *and*
add a `createColumnGuard` in that table's ensure function (for existing ones). See
`machine.label` and `diagnostic_case.machine_id` for the shape.

**Strip comments before splitting on `;`** — see `app/lib/sql.ts`. Doing it the other way
silently drops commented-out statements.

Removing a column is the mirror image — `createColumnDropper` in the same file — and any
index over the column has to go first, as a `DROP INDEX IF EXISTS` in the `.sql`, because
SQLite refuses `DROP COLUMN` while one stands. This is not tidying: the `user_id` columns
it exists for were `NOT NULL`, so a database that still carries one rejects every insert
the current code makes.

Migration numbering runs **0002–0009**, and the two gaps are deliberate. 0001 held the
auth schema and 0010 held a payments integration; both features are gone. Do not renumber
to close either gap — reusing a number makes an old reference ambiguous about which schema
it meant.

## There is no authentication

No sign-in, no accounts, no sessions, no API key of the app's own. Every page and every
API route answers whoever asks. Whoever can reach the port is the operator.

This replaced a real auth system — skeleton key, access codes, sessions, roles, per-code
report allowances — which is why the shape of the code still shows where it used to be.
Two things follow, and both matter more than they look:

- **The consequences belong in the docs, not just here.** `README.md` and `SECURITY.md`
  state plainly that anyone reachable can spend the provider key and read the corpus, and
  that `npm start` binds `0.0.0.0` while `npm run dev` binds localhost. Publishing an app
  that spends money on inference without saying that would be the actual defect. If the
  deployment story changes, those two files change with it.
- **Do not reintroduce a caller identity halfway.** There is no `user_id` on any table and
  no ownership predicate in any query — `tests/request-guard.test.mjs` pins that a
  migration cannot quietly declare one again. Half-restored multi-tenancy that nothing
  enforces reads as a security control and is not one.

### `middleware.ts` is not a gate any more

It does two things to every request, both in `app/lib/request-guard.ts`:

- **Security headers on every response**, refused or not. `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, plus HSTS when `ENVIRONMENT=production`. HSTS is
  production-only on purpose: sending it from a plain-HTTP dev server pins `localhost` to
  HTTPS in the browser for a year and breaks every other project on the machine.
- **A same-origin check on state-changing API calls.** This is *not* CSRF defence — there
  is no session cookie left to ride. It is a spend guard: `/api/diagnose`,
  `/api/spec-lookup` and `/api/parts-lookup` all reach a billable key, and without it a
  page the operator happens to be visiting can `fetch("http://localhost:5211/…")` in the
  background and run up their bill.

  Two signals, because either alone fails open. `Origin` is absent on some browser
  requests and on every `curl`; `Sec-Fetch-Site` is always sent by browsers and cannot be
  set from page script. A request carrying **neither** is not a browser — it is a script
  the operator ran themselves — so it passes rather than being blocked.

`request-guard.ts` stays free of the database and of the `?raw` schema imports so it runs
under a plain `node --test`. Keep it that way.

⚠ **The dev server's 403 is not this code.** Vite's own origin check intercepts a
cross-origin write first and answers `text/plain` "Forbidden" with none of these headers.
Verify this middleware against a production build (`npm run build && npm start`), where
the refusal is `{"error":"Cross-origin request rejected."}` in JSON with the headers on it.

### Spend has exactly one limit

`perCaseTokenCeiling` in Settings, checked in `app/api/diagnose/route.ts` against
`diagnostic_case.tokens_spent`. Default 400,000 tokens; 0 disables it.

- **It is not decoration and it is not a leftover.** It is what ends an interview that
  never converges. Nothing else in the app is watching the spend.
- **It fails OPEN.** An unreadable case row is a storage problem, not evidence of a
  runaway, and refusing a diagnosis over it would break the app for an unrelated fault.
  There is no entitlement to protect any more, so there is nothing left that has to fail
  closed.
- The refusal is a **429** and names the case, not the account.

`app/lib/budget.ts` records; it never enforces. The `usage_ledger` it writes is the
durable record of what the install has cost — 13-month retention, deliberately not the
14-day observability store — and `/api/usage` reads it for the month-to-date figure on
the Settings page. Nothing refuses a request over that number.

## Report contract

**The model returns JSON, never HTML.** Three files move together:

- `report-schema.ts` — `REPORT_SECTIONS` (id, title, order), `EVIDENCE_LABELS`, the block union,
  and `parseReportJson`'s defensive coercion
- `report-template.ts` — owns the document and the stylesheet; section numbering comes from the
  array index, never from the model
- `prompts.ts` — `REPORT_SYSTEM_PROMPT` describes the JSON shape; `REPORT_HANDOFF_PROMPT` is the
  final user turn that closes the interview

Adding a section means editing `REPORT_SECTIONS` and the prompt's section-id list together, or
the model emits content for an id the template never renders.

Report requests use `response_format: { type: "json_object" }` with a fallback to an
unconstrained call on HTTP 400. **Do not remove the constraint** — unconstrained generation of a
report-sized JSON object fails intermittently on unescaped quotes.

Two stylesheet rules, both asserted by `tests/diagnose-contract.test.mjs`:

- **No `min-width` on a table, ever**, and every `<td>` emits `data-label`. Together those let
  wide tables reflow into labelled cards instead of scrolling sideways.
- **The ranked section renders as cards, not a grid**, at every width. Twelve columns of free
  prose is unreadable as a table. Its `<thead>` is hidden, so sorting lives in real buttons.

**Report colour is per equipment manufacturer**, derived server-side from the intake `make` and
interpolated into the stylesheet's `:root`. It is document chrome, like section numbering —
never model-supplied. Semantic tokens (`--danger` / `--warn` / `--ok` / `--info`) never vary by
make. The app shell and the reports are deliberately different colour systems: the shell is
fixed, each report wears its machine's livery (`app/lib/brand.ts`).

**No webfonts.** Prose is the system sans; every label, eyebrow, badge and table header is
`--mono`. A downloaded report opens from `file://` under a CSP with no `font-src`.

## The interview asks one question at a time

State lives in `app/lib/interview-machine.ts`; the panel is the `.ask-block` in
`app/diagnostic-app.tsx`.

- **The walk is client-side and the wire protocol is unchanged.** The model asks up to three
  questions per turn (`parseInterview` slices there) and receives ONE combined user turn back
  via `composeReply`. Making the walk send per question would triple the model calls for what
  is a rendering decision.
- **The transcript is both the wire payload and the bubble's source**, so anything the model
  must see and the operator must not needs a shape the display path can peel off.
  `stripComposedQuestions` does this by **exact whole-line match**, never fuzzily, so a numbered
  line the model wrote inside its own prose is not eaten. Keep the private reasoning line
  collapsed to one line — only one leading line is peeled.
- **`InterviewResult.reasoning` is wire-only and must not be rendered.** It exists because the
  ready message is forbidden verdict-shaped claims; banning those without giving the model
  somewhere else to put them measurably deleted the eliminations the report carried forward.
- **The walk stops at 11 transcript messages, and 11 is not a typo for 12.** A round appends the
  operator's message out and the model's back, so the count is only ever odd. `validateRequest`
  rejects anything over `MAX_TRANSCRIPT_MESSAGES` for **both** actions, so a transcript that
  reached 13 could produce no document at all. `atTranscriptCap` therefore refuses the send once
  the transcript reaches `MAX - 1`, which keeps every report request inside the limit.
- **Retraction is free until the turn sends and impossible after.** Nothing has left the browser
  mid-turn, so reopening a settled question is just a cursor move.
- **`QUESTION_ANSWERED` commits *and* advances** — that is the tap-to-submit gesture. An omitted
  `option`/`text` means "keep what is stored". Chips never toggle off; **Skip** is how a question
  is settled empty.
- **`nextCursor` returns the lowest outstanding question, not `index + 1`**, so re-answering a
  reopened question returns to review rather than to one already answered.
- **Focus between turns goes to the open question, never the compose box.** Focusing a textarea
  opens the soft keyboard over the unread question. The question `<p>` is keyed by index so React
  mounts a fresh node and the focus event actually fires.
- **No `position: sticky` on the ask block and no viewport-height chat pane.** Both were tried at
  390×760 and both fail; the transcript is bounded and scrolls to its newest turn instead.

### Chip rules

- **Every chip set carries an escape, and a value question carries no chips at all.** A chip set
  that omits the machine's true state does not merely fail to help — the operator takes the
  nearest chip and the report recommends the opposite repair.
- **A chip may never say "I haven't checked."** `isUncheckedOption` in
  `app/api/diagnose/contract.ts` strips them in `coerceQuestion`. The narrowness is the design:
  *"I have not gone and looked"* (`Not checked`, `Haven't tried`) is actionable and gets
  stripped; *"I looked and I cannot tell"* (`Not sure`, `Don't know`) is epistemic and **stays**.
  Stripping the second family would leave an operator who genuinely cannot tell with no true
  option. Audit any change against the eval corpus before shipping it.
- **Stripping that leaves fewer than 2 chips drops the whole set**, so the question stands as
  free text. One surviving chip is not a choice — it reads as the expected answer.
- **"None of these — type it"** is the last cell of the `.ask-options` grid and dispatches
  nothing; it only focuses the composer. Because it sits in that grid unnumbered, the digit
  shortcut is scoped to `.ask-chip`, not `.ask-options`.
- **`seeksExactValue()` strips `options` from any ask for a fault code, serial/PIN, part number
  or metered reading.** It is enforced in `coerceQuestion` — the one place options are cleaned —
  and deliberately **not** in the prompt, which states the rule and is ignored. Keep the pattern
  list narrow; widening it is a measured change. Lowercase `pin` is excluded on purpose (bucket
  pin, king pin, wrist pin).
- **`asksForCodeStatus()` appends the active-vs-stored clause to a code ask.** This is the only
  place the server authors question text rather than cleaning it — keep it to one appended
  sentence. The "already draws the distinction" guard requires **both** sides to be named.
- **`CODE_REQUEST_PATTERNS` uses verb stems, not whole words**, so "pulled" and "scanned" match.
  `list` and `display` stay whole words on purpose: `list\w*` would match "is **listed** as",
  which is a question about a code already in hand.
- **`raisesCodes()` measures; it does not enforce.** It reads question text only.

## Machine suggestions

Make / model / machine-type suggestions come from one shared component,
`app/components/combobox.tsx` (`Combobox` + `ComboField`), used by intake, spec lookup,
inventory and settings. **Do not reintroduce `<datalist>` or `list=`.**

- **Free text always wins.** Only two gestures commit: Enter on a highlighted option, and
  clicking one. Typing never auto-highlights, Escape never reverts, blur never coerces. An
  unlisted make or model is typed straight in — that is what the app is for.
- **Two structural properties are load-bearing.** `ComboField` **owns** the `.field` wrapper —
  nesting a listbox inside a labelling `<label>` poisons the input's accessible name and
  re-opens the soft keyboard on option click. And the popup is **portalled to `document.body`,
  positioned `fixed`**, because three ancestors clip an absolute one while two other forms do
  not; removing the portal breaks two pages of four, and only near the bottom of a scrolled form.
- `parseModelYear` and `filterSuggestions` live in `app/lib/equipment-catalog.ts` because all
  four call sites need them. Matching is **substring, prefix-ranked**, with a squashed fallback —
  the catalog is full of compounds whose distinguishing word comes last (`Wheel loader`) and of
  run-together queries (`350glc` → `350G LC`).

`/?machine=<id>` is read **once on mount** against the caller's own fetched list. An id not in
the list is silently ignored. A picked machine sends `machineId` to `/api/diagnose`, and the
route trusts it only after `refreshMachineFromIntake` proves ownership *inside its own UPDATE*;
a foreign or unknown id changes zero rows and falls through to a fuzzy match, so **a diagnosis
never fails over a bad machine id.**

## Fetches on the Settings page never use `try`

`app/lib/request.ts` owns this. `requestJson<T>()` never throws and never rejects: the fetch
throwing, a non-OK status, a body that will not parse, and a body that parses but names no
reason all arrive as one shape — `{ ok: true; data }` | `{ ok: false; message }`.

- **The bug it closes was silence, not a crash.** A failed PUT became an unhandled rejection and
  the error was never set; because the `<select>`s are controlled by the value the server still
  holds, a failed save made the dropdown snap back with no message.
- **Prefer the server's sentence.** Routes answer refusals with `{ error }` via `jsonError`, and
  those strings are written for the operator. `fallbackMessage` is only for a refusal that named
  no reason, or a body that is not JSON at all.
- **A 200 whose body will not parse is a failure.** Handing back `undefined` as `T` is how a card
  renders `Loading…` forever.

⚠ This describes the **Settings page only**. Six other views still fetch inside their own
`try` / `.catch(() => null)`, 17 call sites between them. Converting them is a separate change.

## A deploy must not break the tab it deployed into

The client is code-split into content-hashed chunks served `immutable` while the HTML shell is
`no-store`, so **every chunk hash from the previous build 404s the moment a deploy replaces the
filesystem.** A tab open across a deploy dies on its next navigation, and none of it reaches the
server as an error.

- `app/lib/build-recovery.ts` is the pure matcher; `app/components/build-recovery.tsx` is the
  client component mounted in the root layout. **Keep them split** — the matcher is pinned in
  both directions, and the negative direction is the important one: the reload it triggers
  **discards unsent interview answers**, so an ordinary application error must fall through to
  the boundary rather than reload the page under the operator.
- **The 20s `sessionStorage` cooldown is the loop guard.** Without it a genuinely broken build
  reload-spins forever. Do not make it once-per-session either — a tab open across two deploys
  should recover from both.
- **`app/global-error.tsx` is the only error boundary.** It is styled inline, not from
  `globals.css`, because it must render when the stylesheet is the asset that failed.

## Observability

Three rules keep it safe to ignore:

- **One-way data flow, enforced by import direction.** `app/lib/observability.ts` imports nothing
  from providers or the data layer. Emitters call it; it never calls them. That is what makes the
  subsystem rippable — delete the file, the store and one `runChat` emit, and nothing else
  notices.
- **Emits are fire-and-forget and can never throw.** The single telemetry emit lives in `runChat`,
  keyed by the required `ChatRequest.operation` tag, so a new billable call site gets telemetry by
  existing — it just has to name its operation.
- **The store is disposable.** Its own SQLite file, prune-on-read retention. No cost column; the
  model catalog has no pricing and inventing rates would be worse than nothing.

`GET /api/observability` must always answer 200 with a zeroed payload over a broken or empty
store, never 500. The panel must not go down over exhaust that is designed to be deletable.

`GET /api/health` probes `app.db` with `SELECT 1` — a static 200 would report healthy on a volume
that never mounted, which is the failure it exists for. It deliberately does **not** probe
`observability.db`: that file rides the same directory, so it proves nothing app.db has not
already proved, and failing a healthcheck over a disposable store would take the service down for
nothing. The reason for a `degraded` / 503 goes to the logs, never the body.

## Settings

`activeModel` is validated against `MODEL_CATALOG` on write. It reaches a billable call, so an
arbitrary id must never be persistable.

`PARTS_MODEL` in `app/api/parts-lookup/route.ts` and `SCENARIO_MODEL` in
`app/api/random-scenario/route.ts` are pinned deliberately and do **not** follow
`settings.activeModel` — a per-click billable surface must not silently follow the report model
up to a more expensive tier. A parts lookup is genuinely expensive: one measured run was 115,628
tokens for research plus 5,339 to format, returning three priced listings.

## Tests

`npm test` is `node --test "tests/*.test.mjs"`. It does **not** build first and there is no
`pretest`. `npm run lint` is ESLint only. `npm run typecheck` (`tsc --noEmit`) exists but is
deliberately not wired into `test` or `build` — CI runs all three.

All ten files are pure contract/logic tests: no HTTP handler, no database. They cover the
schema files and the request guard (`request-guard.test.mjs` — security headers, the
cross-origin rule in both directions, statement idempotency, and that no migration declares an
owner column again), request/report/spec/inventory validation and coercion, the interview reducer
and transcript cap, the suggestion catalog and combobox helpers, the observability rollup math,
the stale-build matcher, the `requestJson` failure shape, and the three `package.json` script
invariants whose regression is silent.

⚠ **`evals/run-eval.mjs` is a script, not a module — importing it starts a billed run.** It has
no `main()` guard, so `import("./evals/run-eval.mjs")` immediately begins calling the model API
against every scenario. To check the harness without spending anything, read it as text, or run
it with `--only` and a scenario you mean to spend on. The same applies to anything that sweeps
`evals/runs/*`: an aborted run leaves a partial directory.

## Known issues

**`npm audit` reports a production HIGH and it is expected.** `image-size` reaches production via
`vinext`. Both advisories cover `<=2.0.2`, and 2.0.2 is the newest published version, so it is
unpatched upstream. It was traced and is **not reachable at runtime**: its only two importers are
build-path modules, and the image endpoint never decodes image bytes (verified — remote,
protocol-relative and traversal URLs all 400).

Do not "fix" it with an `overrides` entry (there is no fixed version to point at) or an images
allowlist. ⚠ Note that `npm audit` offers a `vinext` bump as the fix and **it is not one**: that
release *bundles* `image-size` into its own `dist` rather than patching or dropping it, so the
upgrade removes the advisory from the graph `npm audit` walks while the same parser code still
ships. Taking it would trade a truthful audit line for a silent one.

**Runtime dependencies must stay in `dependencies`.** `vinext`, `vite` and
`react-server-dom-webpack` are required by `npm start`, not just by the build. Verify with
`npm ci --omit=dev` in a scratch copy rather than by reading.
