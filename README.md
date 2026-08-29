# RootCause

RootCause turns an operator's description of a broken machine into a structured
diagnostic field report.

You identify the machine, describe the symptom, optionally attach photos, and answer a
short interview the model drives one question at a time. When it has enough to work
with, it produces a standalone HTML report: a ranked list of probable causes with the
evidence for each, the checks that would confirm or eliminate them, and explicit
disclosure wherever service information was missing rather than a guess dressed up as a
figure.

**See what it produces before running anything** —
[`docs/2014-JD-344K-field-report.html`](docs/2014-JD-344K-field-report.html) is a real
rendered report. Download it and open it locally; it is one self-contained file with no
external assets.

The report follows a fixed 12-section contract covering safety, machine identity,
symptom evidence, ranked causes, diagnostic procedure, parts, and the limits of what
could be established. The full specification is in
[`sample-prompt.md`](sample-prompt.md).

## Stack

- TypeScript, React 19, and the Next.js App Router through vinext/Vite
- Plain Node.js server routes, with SQLite storage via better-sqlite3
- Two inference providers: the Anthropic Messages API, and any OpenAI-compatible
  endpoint (defaulting to the Hugging Face router)
- Plain CSS with no client UI framework

## Quickstart

Requires Node.js 22.13 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

Then open `http://localhost:5211`. The port is pinned with `strictPort`, so it is
either 5211 or a startup failure — never a silent reassignment.

You need **at least one** provider key in `.env` before a diagnosis will run. The app
starts and renders without one; only the model call fails, and it says so plainly.

> **There is no sign-in.** RootCause has no authentication at all, so anyone who can
> reach the port can run diagnoses against your provider key and read everything the
> install has stored. `npm run dev` binds to localhost; `npm start` binds `0.0.0.0`.
> Read [Running it safely](#running-it-safely) before you expose it to anything.

## Configuration

A model's provider comes from `MODEL_CATALOG` in `app/lib/settings.ts`, so only the key
for the provider you actually select is required.

| Variable | Provider | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | Messages API. Not reachable through `HF_BASE_URL` — different wire protocol. |
| `HF_TOKEN` | Hugging Face | Any OpenAI-compatible router. |
| `HF_MODEL` | Hugging Face | Must be vision-capable for the photo workflow. |
| `HF_BASE_URL` | Hugging Face | Optional. Any OpenAI-compatible base; `/chat/completions` is appended. Defaults to the HF router. |

Every key is read **server-side only**, by `app/lib/server-env.ts`. None is ever
exposed through a `NEXT_PUBLIC_*` or `VITE_*` variable — they are billable.

Two more, both optional: `DB_DIR` moves the SQLite files off the default `./db` — set
it to a persistent path in any deployment, or the database is lost on every restart —
and `ENVIRONMENT=production` turns on HSTS and nothing else.

## Running it safely

RootCause has **no authentication**. There is no sign-in, no account, and no key of its
own. Every page and every API route answers whoever asks — which means anyone who can
reach the port can run diagnoses that spend your provider key, read every case and
report stored on the install, edit the machine inventory, and change the model setting.

That is a deliberate shape for a tool one person runs for themselves. It is also the
whole of the threat model, so it decides how you may deploy it:

- `npm run dev` listens on **localhost only**. Nothing else on your network reaches it.
- `npm start` listens on **`0.0.0.0`** — every host on the network it is attached to can
  reach it.

For anything beyond your own machine, put something in front: a reverse proxy that does
the authentication, an SSH tunnel, or a private network. Do not put it on the public
internet.

[`SECURITY.md`](SECURITY.md) has the longer version, including what is still worth
reporting as a vulnerability given all of the above.

Application data lives in two local SQLite files, `db/app.db` (settings, the case and
report corpus, the machine inventory, the usage ledger) and `db/observability.db`
(disposable model-call telemetry). Both are created on first run, and `db/` is
gitignored, so each machine grows its own.

## Settings

`/settings` composes two sections:

- **Diagnostic engine** (server) — the active model, the photo cap, and the
  per-diagnosis token ceiling. The model is validated against an approved catalog on
  write, so a settings row can never point paid inference at an arbitrary model id.
  It also shows month-to-date token spend, read from the usage ledger.
- **Default machine** (this browser only) — prefills the intake form. Stored in
  localStorage and synced across tabs; never sent to the server.

The token ceiling is worth understanding, because it is the only spend limit in the
app. A diagnosis that stops converging keeps calling the model for as long as the tab
is open; the ceiling ends it. The default is 400,000 tokens per case, comfortably above
a normal one. Setting it to 0 turns the guard off, and nothing else is watching.

## Commands

- `npm run dev` — run the local application
- `npm run build` — create the production build
- `npm test` — run the contract and logic tests (no network, no database, no build)
- `npm run lint` — run ESLint
- `npm run typecheck` — run `tsc --noEmit`

`npm test`, `npm run lint` and `npm run typecheck` are independent of each other and of
the build. All three should be clean before a pull request.

## Diagnostic flow

The initial request contains machine details, the reported problem, and up to four JPEG, PNG, or WebP images. The server keeps the provider key private and asks the model whether additional information would materially improve safety, applicability, or cause ranking. Once the model marks the case ready, the user may generate and download the standalone report.

Photos are uploaded on the first interview turn and again with the report request. Follow-up replies carry only the file names, so a long interview does not re-send the same images on every turn.

The generated report follows the 12-section evidence and safety contract in `sample-prompt.md`. Missing service information, serial applicability, and unavailable normal values must be disclosed rather than guessed. A rendered example is in [`docs/`](docs/).

## The case corpus

Every diagnosis is recorded in `db/app.db` so the prompts in
`app/api/diagnose/prompts.ts` can be improved against real sessions — which
questions operators stall on, what turns a case ready, what never resolves.

- `diagnostic_case` — one row per diagnosis: the machine, the reported problem,
  the model actually used, turn count, tokens spent, and whether it reached
  `ready` and then `reported` or was abandoned mid-interview.
- `case_message` — one row per turn, not a JSON blob, so questions like "what
  was the last thing an operator said before they gave up" are a query rather
  than a parsing exercise.
- `report` — the report **JSON**, not the rendered HTML. The document is a pure
  function of that JSON via `renderReport`, so storing data keeps old reports
  re-renderable when the template changes.

Recording is strictly a by-product: every write is wrapped so that a storage
failure logs and the diagnosis continues. A broken corpus must never cost an
operator their report.

Inspect it with any SQLite tool — `sqlite3 db/app.db` works.

## How the report is built

The model never writes HTML. It returns report **data** as JSON, and the server renders the document:

- `app/api/diagnose/report-schema.ts` defines the contract — the fixed 12-section list, the evidence-label vocabulary, the allowed content blocks — and coerces the model's reply defensively, so a missing or malformed field degrades to a readable report instead of a failure.
- `app/api/diagnose/report-template.ts` owns the document: doctype, head, stylesheet, section identity, order and numbering, contents rail, sortable ranked table, print rules, and footer. Its styling is carried from the reference report in [`docs/`](docs/).
- The request uses `response_format: { type: "json_object" }`. Free-form generation of a ~10 KB JSON object intermittently emits an unescaped quote — inch marks alone guarantee it — and a document whose string boundaries have moved cannot be repaired. Models that reject `response_format` fall back to an unconstrained call.

Because the server authors the HTML, safety is escaping rather than sanitizing: every model-supplied string passes through `escapeHtml`, source URLs are restricted to `http(s)`, and unrecognized evidence labels are dropped. The document also carries a `Content-Security-Policy` `<meta>` — the only layer that survives the download, since a file opened from `file://` has no response headers and no iframe sandbox — and the preview iframe runs under `sandbox="allow-scripts allow-modals"`, with no same-origin, forms, or popups.

A section the model leaves empty renders as a disclosed evidence gap rather than being silently dropped.

## Evaluating changes

Changes to the prompts or the interview loop are measured, not argued about. The harness
in [`evals/`](evals/) replays scripted equipment scenarios through the real pipeline and
scores the result.

```bash
node evals/run-eval.mjs                 # the full set — bills your provider key
node evals/run-eval.mjs --only 03,07    # a subset
node evals/run-eval.mjs --sim-free-text # the chips-hidden control arm
```

- `evals/scenarios*.json` — the scenario sets. Each is a machine plus a fault whose
  correct diagnosis is known, written so that one variable decides the answer.
- `evals/prompt-variants/*.mjs` — prompt arms to compare against the shipped control.
- `evals/interview-metrics.mjs` — re-scores run directories you have already generated,
  without spending a single token, which is how a predicate change gets checked for
  false positives before it ships. Run output lives in `evals/runs/` and is a local
  artifact — it is not in this repository, so generate a run before scoring one.
- `evals/measure-report.mjs` — report-side measurements.

Read [`evals/README.md`](evals/README.md) first — it documents the rules that keep a
result honest. The sharpest one: the operator simulator takes an offered chip verbatim
96% of the time (`evals/run-eval.mjs:489`), so an arm that removes chips from the app
improves its own score by construction. That is what `--sim-free-text` is for.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

RootCause is licensed under the [Apache License 2.0](LICENSE) (`Apache-2.0`).

You may use, modify and redistribute it, including commercially, provided you keep the
copyright and license notices and state what you changed. The license also grants a patent
license from every contributor, and terminates that grant for anyone who brings a patent
suit over the software. It is provided as-is, with no warranty.

### Trademarks and brand assets

Apache-2.0 §6 expressly grants no trademark rights, and the *RootCause* and *RootCause HME* names and the wordmark are **reserved**. A modified or redistributed copy must not use them, or the brand assets in [`public/icons/`](public/icons/) and [`docs/brand-board.png`](docs/brand-board.png), to identify itself or to suggest endorsement.

To be exact about what that does and does not mean: those asset *files* sit inside the licensed Work and are covered by the same Apache-2.0 grant as the rest of the tree. What is reserved is their use — and the names' use — **as a mark**.

### Contributions

Under Apache-2.0 §5, a contribution you deliberately submit is licensed under these same terms unless you say otherwise. See [CONTRIBUTING.md](CONTRIBUTING.md).
