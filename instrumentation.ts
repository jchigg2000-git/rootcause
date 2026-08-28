/**
 * vinext's `register()` hook — the Node-process equivalent of what used to
 * happen implicitly inside a Workers isolate.
 *
 * Opens the two SQLite files (`db/auth.db`, `db/app.db`), wires them onto
 * `server-env.ts`'s `env` object as `AUTH_DB`/`APP_DB` so every existing call
 * site keeps working unchanged, runs both schemas up front, and seeds the
 * admin account. This runs once per process, before any request is served —
 * see `node_modules/vinext/dist/server/instrumentation.js` for App Router
 * baking this in as a top-level await in the generated RSC entry, and its
 * `INSTRUMENTATION_LOCATIONS = ["", "src/"]` for why the project root is a
 * valid place for this file.
 */
import path from "node:path";
import { openDatabase, closeDatabases } from "./app/lib/db.ts";
import { env } from "./app/lib/server-env.ts";
import { ensureAuthSchema, ensureOwner } from "./app/lib/auth/store.ts";
import { ensureSettingsSchema } from "./app/lib/settings.ts";
import { ensureUsageLedgerSchema } from "./app/lib/budget.ts";
import { ensureTokenGrantSchema } from "./app/lib/access.ts";
import { ensureAccessTokenSchema } from "./app/lib/auth/access-tokens.ts";
import { ensureSkeletonKey } from "./app/lib/auth/skeleton-key.ts";
import { ensureCaseOutcomeSchema } from "./app/lib/library.ts";
import { ensureDiagnosticCaseSchema, ensureReportSchema } from "./app/lib/cases.ts";
import { ensureMachineSchema, ensureMachineServiceSchema } from "./app/lib/inventory.ts";
import { ensureObservabilitySchema } from "./app/lib/observability.ts";

export async function register(): Promise<void> {
  // `DB_DIR` is what makes this deployable: on any container host the two
  // files must land on a mounted volume, because the container filesystem is
  // replaced on every deploy and a relative `./db` would silently start empty
  // each time — losing the users, the case corpus and the reports without
  // erroring.
  const dbDir = env.DB_DIR?.trim() || path.join(process.cwd(), "db");
  const authDb = openDatabase(path.join(dbDir, "auth.db"));
  const appDb = openDatabase(path.join(dbDir, "app.db"));
  // Metrics-only store, deliberately its own file: prunable exhaust, kept
  // apart from the corpora so retention deletes can only ever touch metrics.
  const obsDb = openDatabase(path.join(dbDir, "observability.db"));

  env.AUTH_DB = authDb;
  env.APP_DB = appDb;
  env.OBS_DB = obsDb;

  await ensureAuthSchema(authDb);
  await ensureSettingsSchema(appDb);
  await ensureDiagnosticCaseSchema(appDb);
  await ensureReportSchema(appDb);
  await ensureMachineSchema(appDb);
  // After the two above: 0007 indexes a guard-added diagnostic_case column.
  await ensureMachineServiceSchema(appDb);
  await ensureCaseOutcomeSchema(appDb);
  await ensureUsageLedgerSchema(appDb);
  await ensureTokenGrantSchema(appDb);
  await ensureAccessTokenSchema(authDb);
  await ensureObservabilitySchema(obsDb);
  await ensureOwner(authDb);
  announceSkeletonKey();

  installShutdownHook();
  warnOnUnsafeProductionConfig(dbDir);
}

/**
 * Checkpoint the WAL files before the process goes away.
 *
 * A container host SIGTERMs the old container on every deploy, and that is
 * typically the ONLY way this process ever ends in production. Node's default
 * SIGTERM disposition
 * exits without running any JS, so better-sqlite3 never closed and never
 * checkpointed; see the note on `closeDatabases`.
 *
 * Three things are load-bearing here:
 *
 * - **This only runs at all because `npm start` execs.** Without the leading
 *   `exec`, npm's `sh` wrapper is what gets signalled and node dies by SIGKILL
 *   with no JS run — the hook shipped and sat dead for weeks that way. Pinned
 *   by `tests/deploy-contract.test.mjs`; both directions measured 2026-08-08.
 * - **`process.on`, never `process.once`.** Adding a listener replaces Node's
 *   default disposition — but `once` deregisters it *before* invoking it, which
 *   restores that default, so a second signal arriving during the checkpoint
 *   would kill the process mid-fold at the kernel default. `shuttingDown` is
 *   what makes re-entry a no-op; the listener has to stay installed for it to
 *   have anything to guard.
 * - **It must exit itself**, with code 0, or the container hangs until the
 *   host escalates to SIGKILL and a deploy replacement is recorded as a crash.
 */
let shutdownHookInstalled = false;
function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // This line is the only production evidence the hook ran, so it reports
    // what actually happened rather than asserting success: a contended
    // checkpoint leaves a WAL behind without throwing, and an unconditional
    // "checkpointed and closed" would read as healthy on exactly the deploy
    // that regressed. It keeps that phrase on the clean path so an existing
    // log grep still matches.
    try {
      const { handles, checkpointed, incomplete } = closeDatabases();
      console.error(
        incomplete > 0
          ? `[shutdown] ${signal}: ${checkpointed}/${handles} databases checkpointed and closed, ` +
              `${incomplete} closed with a WAL still on disk`
          : `[shutdown] ${signal}: ${checkpointed}/${handles} databases checkpointed and closed`,
      );
    } catch (closeError) {
      console.error(
        `[shutdown] ${signal}: closing databases failed: ${(closeError as Error).message}`,
      );
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Loud, non-fatal checks for the three ways a production deploy silently goes
 * wrong. Non-fatal on purpose: refusing to boot turns a misconfiguration into
 * an outage, and every one of these is visible in the deploy log instead.
 */
function warnOnUnsafeProductionConfig(dbDir: string): void {
  if (env.ENVIRONMENT !== "production") return;
  const warn = (message: string) => console.error(`[startup] ${message}`);

  if (env.COOKIE_SECURE?.trim().toLowerCase() === "false") {
    warn("COOKIE_SECURE=false in production — the session cookie will omit Secure.");
  }
  // A relative path means the container filesystem, which is replaced on every
  // deploy: users, cases and reports would vanish without ever erroring.
  if (!env.DB_DIR?.trim()) {
    warn(
      `DB_DIR is unset, so SQLite lives at ${dbDir} — set it to a mounted ` +
        "volume or every deploy starts with an empty database.",
    );
  }
}

/**
 * Ensure the owner's skeleton key exists, and print it exactly once — the boot
 * where it is created.
 *
 * There is no password and no account recovery in this app, so this log line is
 * the only time the key is ever displayed. It is also why an existing key is
 * never reprinted: repeating it on every restart would smear the one credential
 * that grants admin across the whole deploy history.
 *
 * Deployed, the file lands on the mounted volume ($DB_DIR), so it survives a
 * redeploy. Read it back any time by catting `$DB_DIR/skeleton.key` on the
 * host.
 */
function announceSkeletonKey(): void {
  try {
    const { key, created, keyPath } = ensureSkeletonKey();
    if (created) {
      console.error(
        `[auth] skeleton key created at ${keyPath}\n` +
          `[auth] ---> ${key}\n` +
          "[auth] This is the only time it is printed. Save it now; sign in with it as the key.",
      );
    } else {
      console.error(`[auth] skeleton key loaded from ${keyPath}`);
    }
  } catch (keyError) {
    console.error(`[auth] skeleton key unavailable: ${(keyError as Error).message}`);
  }
}
