# Contributing to RootCause

Issues, bug reports and pull requests are welcome.

## Licensing of contributions

RootCause is released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), and
commercial licenses are sold separately by the copyright holder. For that to work, every
contribution has to be something the copyright holder is free to include in a commercially
licensed copy.

**By opening a pull request you agree that:**

1. You wrote the contribution yourself, or you have the right to submit it under these terms.
2. Your contribution is licensed to the project under the PolyForm Noncommercial License 1.0.0,
   the same terms as the rest of the software.
3. You additionally grant Justin Higgins a perpetual, worldwide, irrevocable, royalty-free,
   non-exclusive right to use, modify, sublicense and relicense your contribution — including
   under commercial license terms — without further permission or compensation.
4. You retain your own copyright in your contribution. This grant is not an assignment; you may
   continue to use your own work however you like.

If you cannot agree to point 3, open an issue describing the change instead of a pull request.

## Sign your commits

Add a `Signed-off-by` line to each commit as a record of the above:

    git commit -s -m "your message"

## Before you open a PR

    npm run lint
    npm run typecheck
    npm test

All three should be clean. `npm test` runs pure contract and logic tests — no network, no
database, no build step.

## Getting it running

See the Quickstart in [README.md](README.md). Short version: Node 22.13+, `cp .env.example
.env`, `npm install`, `npm run dev`, then `http://localhost:5211`.

You need one provider key to run a diagnosis, but not to start the app or to work on
anything that isn't the model call — the UI, the report template, the storage layer and
the whole test suite run fine without one.

## Orientation

A few things about this codebase are deliberate and will look like bugs if you don't know
them.

**The port is 5211 and it is pinned.** `vite.config.ts` sets `strictPort: true`, and the
`dev` and `start` scripts both name the port. If 5211 is busy the app fails to start
rather than quietly moving — that is the intended behaviour. Changing it means changing
`vite.config.ts`, both npm scripts, and the metadata fallback in `app/layout.tsx`
together.

**Two SQLite files, not one.** `db/auth.db` holds accounts and sessions; `db/app.db`
holds application data — settings, the case and report corpus, the machine inventory.
They are separate so that identity data and application data never share a transaction or
a migration. `db/` is gitignored and both files are created on first run. A third,
`db/observability.db`, is disposable telemetry: delete it any time.

**Migrations are the schema, and they re-run in full on every boot.** `migrations/*.sql`
are imported with `?raw` and executed at startup, so there is no migration step in
development. The consequence that catches people: a bare `ALTER TABLE` works on boot #1
and fails on boot #2. Adding a column means putting it in that table's `CREATE` *and*
adding a `createColumnGuard` in the table's ensure function. See `machine.label` for the
pattern.

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
