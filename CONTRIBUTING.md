# Contributing to RootCause

Issues, bug reports and pull requests are welcome.

## Licensing of contributions

RootCause is released under the [Apache License 2.0](LICENSE).

Under section 5 of that license, a contribution you deliberately submit for inclusion is
licensed under the same terms as the rest of the software, unless you explicitly say
otherwise. There is no separate contributor license agreement to sign and no copyright
assignment.

**By opening a pull request you confirm that:**

1. You wrote the contribution yourself, or you otherwise have the right to submit it under
   the Apache License 2.0.
2. You retain your own copyright in your contribution — nothing here is an assignment, and
   you may continue to use your own work however you like.

## Sign your commits

Add a `Signed-off-by` line to each commit as a record of the two points above:

```bash
git commit -s -m "your message"
```

## Before you open a PR

```bash
npm run lint
npm run typecheck
npm test
```

All three should be clean. `npm test` runs pure contract and logic tests — no network, no
database, no build step.

The Node floor is **22.18**, and it is set by the tests rather than by the app: they
import the TypeScript sources directly, and Node only strips types without a flag from
22.18 onward. On anything older `npm test` dies with `ERR_UNKNOWN_FILE_EXTENSION` for
`.ts` while the app itself runs fine. Do not lower it without adding
`--experimental-strip-types` to the `test` script.

## Getting it running

See the Quickstart in [README.md](README.md). Short version: Node 22.18+, `cp .env.example
.env`, `npm install`, `npm run dev`, then `http://localhost:5211`.

You need one provider key to run a diagnosis, but not to start the app or to work on
anything that isn't the model call — the UI, the report template, the storage layer and
the whole test suite run fine without one.

## Orientation

A few things about this codebase are deliberate and will look like bugs if you don't know
them.

[`CLAUDE.md`](CLAUDE.md) is the long form of this list — every constraint in the
codebase with the reason attached, including the `npm audit` finding that is expected
and why the offered fix is not one.

**The port is 5211 and it is pinned.** `vite.config.ts` sets `strictPort: true`, and the
`dev` and `start` scripts both name the port. If 5211 is busy the app fails to start
rather than quietly moving — that is the intended behaviour. Changing it means changing
`vite.config.ts`, both npm scripts, and the metadata fallback in `app/layout.tsx`
together.

**There is no authentication, and that is a design decision rather than a gap.**
Every route answers whoever asks. It changes what a change to this repo can assume:
there is no caller identity to filter on, no role to check, and no session to attach
anything to. If a feature seems to need one, that is a conversation before it is a pull
request. [`SECURITY.md`](SECURITY.md) states the consequences for deployment.

**Two SQLite files.** `db/app.db` holds everything that matters — settings, the case
and report corpus, the machine inventory, the usage ledger. `db/observability.db` is
disposable model-call telemetry, kept in its own file so a retention bug can only ever
eat metrics; delete it any time. `db/` is gitignored and both are created on first run.

**Migrations are the schema, and they re-run in full on every boot.** `migrations/*.sql`
are imported with `?raw` and executed at startup, so there is no migration step in
development. The consequence that catches people: a bare `ALTER TABLE` works on boot #1
and fails on boot #2. Adding a column means putting it in that table's `CREATE` *and*
adding a `createColumnGuard` in the table's ensure function — see `machine.label`.
Removing one is the mirror image, `createColumnDropper`, and any index over the column
has to be dropped in the `.sql` first.

The files are numbered 0002–0009, and the gaps are not a mistake to tidy. 0001 held the
auth schema, 0010 a payments integration, and 0011/0012 the access codes and allowances
that went with the auth removal. All four are burned — reusing one makes an old reference
ambiguous about which schema it meant. The next migration is 0013.

**The model returns JSON; the server renders the HTML.** Three files move together —
`app/api/diagnose/report-schema.ts` (the contract), `report-template.ts` (the document and
its stylesheet), and `prompts.ts` (what the model is told). Adding a report section means
editing the section list and the prompt's section-id list in the same change, or the model
emits content for an id that never renders.

**Changes to prompts or the interview loop want a measurement.** The harness in `evals/`
replays known-answer equipment scenarios through the real pipeline. `evals/README.md`
documents how to run an arm honestly — read it before quoting a number, because at least
one obvious experiment improves its own score by construction.

## Scope

RootCause is a diagnostic intake tool for heavy equipment. Changes that make the report contract
or the interview loop measurably better are the most useful. If a change affects the report
structure or the interview behaviour, say what you measured and how.
