# Security

## RootCause has no authentication

There is no sign-in, no account, and no API key of its own. Every page and every
API route answers whoever asks. Anyone who can reach the port can:

- run diagnoses, spec lookups, parts lookups and the "Randomize machine" scenario
  writer, **all of which spend your provider key**;
- read every case and report the install has stored;
- add, edit and delete machines in the inventory;
- change the server settings, including which model is used.

This is deliberate — RootCause is a tool one operator runs for themselves — but it
decides how you are allowed to deploy it.

**`npm run dev` binds to localhost only. `npm start` binds `0.0.0.0`**, which means
every host on the network it is attached to can reach it. If you run the production
server, put it behind something:

- keep it on `localhost` and reach it over an SSH tunnel;
- or put a reverse proxy in front and make the proxy do the authentication (set
  `VINEXT_TRUST_PROXY=1` so the server reads `X-Forwarded-Proto` and stops building
  redirects back to plain HTTP);
- or keep it on a private network — a VPN, a tailnet — and nothing else.

Do not put it on the public internet. The first thing that finds it will spend your
inference budget, and there is nothing in the application to stop it.

## Reporting a vulnerability

Please report security issues privately, through GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository, rather than opening a public issue.

This is a small project maintained by one person. There is no bounty and no
guaranteed response window, but reports are read and taken seriously.

Given the section above, "there is no authentication" is a known property rather than
a finding. What is worth reporting is anything that makes the damage worse than the
model described here — for example a way to reach the provider key itself, to make
the server fetch a URL of your choosing, or to get script into a generated report.

## What is worth scrutiny

- `middleware.ts` and `app/lib/request-guard.ts` — the security headers, and the
  same-origin check on state-changing API calls. That check is not CSRF defence;
  there is no session to ride. It stops a page you happen to be visiting from
  POSTing to your own `localhost` in the background and spending your key.
- `app/api/diagnose/report-template.ts` — the server, not the model, writes the
  report HTML. Every model-supplied string goes through `escapeHtml`, source URLs
  are restricted to `http(s)`, and the document carries its own CSP `<meta>`,
  which is the only layer that survives being downloaded and opened from `file://`.
- `app/lib/settings.ts` — `activeModel` is validated against a fixed catalog on
  write, so a settings row can never point paid inference at an arbitrary model id.
- `app/api/diagnose/providers.ts` — where the provider key is used, and the one
  place an upstream error body could leak account detail into a response. It goes
  to the log instead.

## Operational notes

- **Provider keys are read server-side only**, in `app/lib/server-env.ts`. Never
  expose one through a `NEXT_PUBLIC_*` or `VITE_*` variable — they are billable.
- **Set `DB_DIR` to a persistent path in any deployment.** On a container host the
  default `./db` is replaced on every deploy, which silently discards your data.
- **The per-diagnosis token ceiling is the only spend limit in the app, and it covers one
  route.** It lives in Settings, defaults to 400,000 tokens, counts per diagnostic case,
  and is checked in `/api/diagnose` only. Spec lookup, parts lookup and the "Randomize
  machine" button all place billable calls with no ceiling at all — a single parts lookup
  was measured at 115,628 + 5,339 tokens. Setting the ceiling to 0 removes even that one.
- **Photos and field text go to your inference provider** as part of the request.
  Whatever their retention policy is, is the retention policy for that data.

## A known advisory that is expected

`npm audit` reports a production HIGH for `image-size`, reached through the `vinext`
framework. Both advisories cover `<= 2.0.2`, and 2.0.2 is the newest published
version, so there is no fixed release to move to. It was traced and is not reachable
at runtime: its only importers are build-path modules, and the image endpoint never
decodes image bytes.

Note that `npm audit` offers a `vinext` upgrade as the remedy and it is not one —
that release bundles `image-size` into its own `dist` rather than patching or
dropping it, so the advisory leaves the dependency graph while the same parser code
still ships. Taking it would trade a truthful audit line for a silent one. See
[`CLAUDE.md`](CLAUDE.md) for the full trace.
