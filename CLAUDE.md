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
- **better-sqlite3** over two files, `db/auth.db` and `db/app.db` (both gitignored)
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

Migration numbering runs 0001–0009, 0011, 0012. **0010 is deliberately skipped** — it held a
payments integration that was removed. Do not renumber to close the gap.

## Auth

There are no passwords and no signup. Two credentials exist, both bearer secrets typed into a
single field on `/login`:

- **The skeleton key** — `$DB_DIR/skeleton.key`, generated on first boot, mode `0600`, printed
  to the log **only** on the boot that creates it. It signs in as the single `owner` account
  (role admin, fixed id `"owner"`). Rotate by deleting the file and restarting; the account and
  everything it owns survive, because the id is fixed rather than a UUID.
- **An access code** (`RC-XXXXX-XXXXX-XXXXX-XXXXX`) issued from Settings → Access codes. First
  use mints a viewer account and its allowance; later uses resume that same account.

Rules that keep this safe:

- **The login route answers every failure with one string and one status**, so it cannot be
  used as an oracle for whether a code exists or which kind of secret was guessed.
- **"One-time" refers to the allowance, not the number of sign-ins.** There is no email in this
  app and so no reset to send; a code that died after one session would strand its holder. The
  code stays valid until its allowance is spent, it expires, or it is revoked.
- **Revocation must kill sessions too.** `DELETE /api/tokens/:id` marks the row *and* calls
  `deleteSessionsForUser`. Marking alone leaves a signed-in holder working for up to 30 days.
- **The code alphabet excludes I, L, O, U, 0 and 1** so a code survives being read down a phone
  line. `generateCode` / `normalizeCode` live in `app/lib/auth/access-code.ts`.
- **Only the SHA-256 of a code is stored**, as for session tokens. The plaintext is returned
  once by `POST /api/tokens` and is unrecoverable; reissue is the only recovery.
- `users.email` and `users.password_hash` still exist as columns and are dead weight — dropping
  them means rebuilding the table on a live volume. Email is a synthetic display label and
  `password_hash` is the sentinel `"!"`. Nothing reads either for auth.
- scrypt keeps its explicit `maxmem`. It pins the parameters so existing hashes stay valid.

### The gate is `middleware.ts`

It sits at the repo root, ahead of the app router, so **a new route is protected by default**.
To make one public, edit `PUBLIC_API` in `app/lib/auth/paths.ts` — never decorate the route.
`/api/tokens` is admin-gated by prefix, because a token holder who reached it could mint
themselves an unlimited allowance against the owner's provider key.

Pages are **not** gated: `gate()` passes non-API paths through so `/login` can render, and each
page calls `pageUser()` and redirects itself.

Path predicates live in `paths.ts` with no database and no `?raw` imports, precisely so the
allowlist stays unit-testable. Keep them there.

### Ownership is a `WHERE` clause, never a UI check

Route handlers do not re-check role, so `app/lib/library.ts` and `app/lib/inventory.ts` are the
only place ownership can live. Updates and deletes carry the owner in their own `WHERE` rather
than doing a check-then-write, and a row that is not yours answers with the same 404 as one
that does not exist, so ids cannot be enumerated.

### Entitlement does not fail open

An access code buys **N generated reports**, with two ceilings behind it. The decision table is
`decideAccess` in `app/lib/access-policy.ts`, pinned by `tests/auth-contract.test.mjs`.

| Limit | Column / setting | Role |
|---|---|---|
| Reports | `token_grant.run_cap` / `runs_used` | The headline — what a holder is sold and told |
| Lifetime tokens | `token_grant.token_cap` / `tokens_used` | Silent backstop on total spend |
| Per-diagnosis tokens | `perCaseTokenCeiling` vs `diagnostic_case.tokens_spent` | Ends one runaway interview |

- **`0` means unlimited on every axis**, independently.
- **Runs are checked first**, so when both are spent the refusal names the number the holder
  actually bought.
- **The per-case ceiling is not decoration.** A run is charged only on delivery, so without it
  an interview that never converges spends without bound and is never counted.
- **The grant check fails CLOSED; the per-case ceiling fails OPEN.** An unreadable grant is the
  only thing authorising spend against the owner's key, so it refuses. An unreadable case row
  is a storage problem, not evidence of a runaway.
- The refusal lives at the three billable call sites (`/api/diagnose`, `/api/spec-lookup`,
  `/api/parts-lookup`), which return **503** for an unverifiable store — not the **429** a
  genuine quota refusal uses. An operator whose store is broken has not run out of anything,
  and telling them they have sends them asking for a code they do not need. Do not tidy these
  two statuses together.
- **`token_grant.tokens_used` is a counter, not a SUM over `usage_ledger`** — the ledger prunes
  at 13 months and would hand a long-lived code its allowance back.
- A grant predating these columns gets `run_cap = 0` (unlimited). That is the intended
  migration semantic: an existing holder must not lose access on deploy.
- Admins are exempt from all three.

`access-policy.ts` must stay free of the `?raw` schema import, as `paths.ts`, `access-code.ts`
and `request.ts` are — `access.ts` imports its schema with `?raw`, which only Vite resolves, so
importing it from a plain `node --test` run fails the whole file.

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

⚠ This describes the **Settings page only**. Seven other views still fetch inside their own
`try` / `.catch(() => null)`. Converting them is a separate change.

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
  from auth, providers, or the data layer. Emitters call it; it reads `auth_events` by raw SQL
  against a handle, never through `auth/store.ts`. That is what makes the subsystem rippable.
- **Emits are fire-and-forget and can never throw.** The single telemetry emit lives in `runChat`,
  keyed by the required `ChatRequest.operation` tag, so a new billable call site gets telemetry by
  existing — it just has to name its operation.
- **The store is disposable.** Its own SQLite file, prune-on-read retention. No cost column; the
  model catalog has no pricing and inventing rates would be worse than nothing.

`GET /api/observability` is admin-only and must always answer 200 with a zeroed payload over a
broken or empty store, never 500.

`GET /api/health` is public by allowlist and probes **both** SQLite handles with `SELECT 1` — a
static 200 would report healthy on a volume that never mounted, which is the failure it exists
for. It answers `degraded` / 503 when either handle is unreachable, and the reason goes to the
logs, never the body.

## Settings

`activeModel` is validated against `MODEL_CATALOG` on write. It reaches a billable call, so an
arbitrary id must never be persistable.

`PARTS_MODEL` in `app/api/parts-lookup/route.ts` is pinned deliberately and does **not** follow
`settings.activeModel` — a per-click paid surface must not silently follow an admin's report
model up to a more expensive tier. Note that a parts lookup is genuinely expensive: one measured
run was ~116k tokens for research plus ~5k to format.

## Tests

`npm test` is `node --test "tests/*.test.mjs"`. It does **not** build first and there is no
`pretest`. `npm run lint` is ESLint only. `npm run typecheck` (`tsc --noEmit`) exists but is
deliberately not wired into `test` or `build` — CI runs all three.

All ten files are pure contract/logic tests: no HTTP handler, no database. They cover the auth
schemas and access-code helpers, the path allowlist, request/report/spec/inventory validation
and coercion, the interview reducer and transcript cap, the suggestion catalog and combobox
helpers, the observability rollup math, the stale-build matcher, the `requestJson` failure
shape, and the three `package.json` script invariants whose regression is silent.

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
