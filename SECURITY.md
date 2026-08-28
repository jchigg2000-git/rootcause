# Security

## Reporting a vulnerability

Please report security issues privately, through GitHub's
[private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository, rather than opening a public issue.

This is a small project maintained by one person. There is no bounty and no
guaranteed response window, but reports are read and taken seriously.

## Scope

RootCause is a self-hosted application: you run it, on your own machine or your
own host, against your own provider key. There is no service operated by the
maintainer, so there is nothing to attack but your own deployment.

The parts most worth scrutiny:

- `middleware.ts` — the single request gate. Every API route is protected by
  default; a route becomes public only by being listed in `PUBLIC_API` in
  `app/lib/auth/paths.ts`.
- `app/lib/auth/` — session tokens and access codes, both stored only as
  SHA-256 hashes, and the skeleton key.
- `app/lib/access-policy.ts` — the spend limits that stand between an access
  code and your provider bill.
- `app/lib/library.ts` and `app/lib/inventory.ts` — per-user ownership, enforced
  in the `WHERE` clause rather than in the UI.

## Operational notes

- **The skeleton key is a bearer secret.** It is written to
  `$DB_DIR/skeleton.key` at mode `0600` on first boot and printed to the log
  exactly once, on that boot. Anyone who can read the file or that log line is
  an admin. Rotate it by deleting the file and restarting.
- **Set `DB_DIR` to a persistent path in any deployment.** On a container host
  the default `./db` is replaced on every deploy, which silently discards your
  data and regenerates the key.
- **Provider keys are read server-side only**, in `app/lib/server-env.ts`. Never
  expose one through a `NEXT_PUBLIC_*` or `VITE_*` variable — they are billable.
- **Serve it over HTTPS.** `COOKIE_SECURE=false` exists for plain-HTTP local
  development and should not be used anywhere else.

## A known advisory that is expected

`npm audit` reports a production HIGH for `image-size`, reached through the
`vinext` framework. Both advisories cover `<= 2.0.2`, and 2.0.2 is the newest
published version, so there is no fixed release to move to. It was traced and is
not reachable at runtime: its only importers are build-path modules, and the
image endpoint never decodes image bytes.

Note that `npm audit` offers a `vinext` upgrade as the remedy and it is not one
— that release bundles `image-size` into its own `dist` rather than patching or
dropping it, so the advisory leaves the dependency graph while the same parser
code still ships. See `CLAUDE.md` for the full trace.
