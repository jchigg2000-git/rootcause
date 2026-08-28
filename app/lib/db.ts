/**
 * SQLite storage, replacing the D1 bindings the app used under Workers.
 *
 * `openDatabase()` opens a real file with better-sqlite3 and wraps it in an
 * async-shaped adapter that presents the exact D1 subset the codebase already
 * calls (`prepare().bind().first/all/run()`, `batch()`) so the ~35 existing
 * call sites across `sql.ts`, `settings.ts`, and `auth/store.ts` did not have
 * to change. Only `server-env.ts` and the D1-typed call sites needed their
 * type annotation swapped from `D1Database` to `Database`.
 *
 * Pragmas: WAL journal mode, a 5s busy timeout so concurrent writers retry
 * instead of throwing, and foreign keys on.
 */
import BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** Shape returned by `.run()` — mirrors D1's `{ meta: { changes } }`. */
export interface RunResult {
  meta: {
    changes: number;
    lastRowId: number;
  };
}

/** The D1 prepared-statement subset this codebase calls. */
export interface PreparedStatement {
  bind(...args: unknown[]): PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<RunResult>;
}

/** The D1 database subset this codebase calls. Replaces the `D1Database` global type. */
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<RunResult[]>;
}

/**
 * A statement bound to one underlying better-sqlite3 connection.
 *
 * Preparation is deliberately lazy — `raw.prepare(sql)` runs inside
 * `runSync()`/`first()`/`all()`, not in the constructor. `db.prepare(sql)` is
 * called by `createSchemaRunner` (`app/lib/sql.ts`) for every statement in a
 * migration file up front, before any of them execute, so a later statement
 * that references an object an earlier statement creates in the same batch —
 * e.g. `CREATE INDEX ... ON sessions(...)` after `CREATE TABLE sessions` —
 * would fail to prepare against the not-yet-existing table if preparation ran
 * eagerly. D1's own `.prepare()` is lazy for the same reason; this mirrors it.
 *
 * `runSync()` is the synchronous core every other method funnels through —
 * `run()` just wraps it in a resolved promise, and `Database.batch()` calls it
 * directly from inside `better-sqlite3`'s synchronous transaction callback,
 * which is the only place a real atomic multi-statement write is possible.
 */
class Statement implements PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly raw: BetterSqlite3.Database,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): PreparedStatement {
    this.params = args;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.raw.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const rows = this.raw.prepare(this.sql).all(...this.params) as T[];
    return { results: rows };
  }

  async run(): Promise<RunResult> {
    return this.runSync();
  }

  runSync(): RunResult {
    const info = this.raw.prepare(this.sql).run(...this.params);
    return { meta: { changes: info.changes, lastRowId: Number(info.lastInsertRowid) } };
  }
}

class SqliteDatabase implements Database {
  constructor(private readonly raw: BetterSqlite3.Database) {}

  prepare(sql: string): PreparedStatement {
    return new Statement(this.raw, sql);
  }

  /**
   * A real transaction, not `Promise.all` of independent `run()` calls.
   *
   * `better-sqlite3`'s `.transaction()` wraps the callback in BEGIN/COMMIT
   * (and ROLLBACK on throw) using the same synchronous connection, so a
   * failure partway through — e.g. the schema runner hitting a bad statement,
   * or a password change whose session wipe fails — leaves no partial write.
   * `Promise.all` of separate `.run()`s would look identical on the happy
   * path and only diverge under partial failure.
   */
  async batch(statements: PreparedStatement[]): Promise<RunResult[]> {
    const asStatements = statements as Statement[];
    const runAll = this.raw.transaction((stmts: Statement[]) => stmts.map((s) => s.runSync()));
    return runAll(asStatements);
  }
}

/**
 * Every handle this process has opened, so shutdown can checkpoint them.
 *
 * In WAL mode a committed write lands in `<file>-wal`, not in `<file>`, until
 * something checkpoints. SQLite's auto-checkpoint only fires at 1000 pages, and
 * the last connection to `close()` cleanly is what folds the WAL back in and
 * removes it. This process is SIGTERM'd on every deploy and never closed
 * anything, so on the mounted volume `app.db` sat at 4096 bytes — one header
 * page — behind a 2.4 MB `app.db-wal` that had not been checkpointed since the
 * volume was created. Nothing was lost (the WAL is on the same volume and
 * SQLite recovers it on the next open), but it makes the main file alone a
 * useless artifact: any backup or copy that takes `app.db` without its `-wal`
 * silently restores an empty database.
 */
const openHandles = new Set<BetterSqlite3.Database>();

/**
 * Open a SQLite file, creating its parent directory if needed.
 *
 * `db/` is gitignored — each machine grows its own `auth.db` / `app.db` on
 * first run via `instrumentation.ts`.
 */
export function openDatabase(filePath: string): Database {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const raw = new BetterSqlite3(filePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("foreign_keys = ON");
  openHandles.add(raw);

  return new SqliteDatabase(raw);
}

/** What `closeDatabases` actually managed to do, so the caller can log the truth. */
export type ShutdownReport = {
  /** Handles that were still open when shutdown started. */
  handles: number;
  /** Handles whose WAL was fully folded back into the main file. */
  checkpointed: number;
  /** Handles that closed with a WAL left on disk (busy, or the pragma threw). */
  incomplete: number;
};

/**
 * Checkpoint and close every open handle. Safe to call more than once.
 *
 * TRUNCATE rather than a bare `close()`: it blocks until the WAL is fully
 * folded into the main file and then empties it, so the file left on the
 * volume is complete on its own. Both steps are per-handle best-effort — a
 * failure here must never stop the process from exiting, or the host escalates
 * SIGTERM to SIGKILL and we lose the clean shutdown entirely.
 *
 * Two things this deliberately does NOT do the obvious way:
 *
 * - **It lowers `busy_timeout` first.** The open-time 5s is tuned for request
 *   handlers. On this path it is a liability: the host overlaps containers, so
 *   the incoming one is already opening and writing these same files while the
 *   outgoing one is being signalled, and three handles waiting out 5s each
 *   would spend 15s inside a signal handler documented as non-blocking — long
 *   enough for the host to escalate to SIGKILL mid-checkpoint. One second is
 *   enough to win an uncontended checkpoint and cheap to lose a contended one.
 * - **It reports busy, not just throws.** `wal_checkpoint(TRUNCATE)` answers
 *   with a `busy` column rather than raising when another connection holds the
 *   lock, so a bare try/catch sees success on exactly the contended deploy
 *   where the WAL got left behind. The caller logs this report, so the one
 *   production signal we have can never claim a checkpoint that did not happen.
 */
export function closeDatabases(): ShutdownReport {
  const report: ShutdownReport = { handles: openHandles.size, checkpointed: 0, incomplete: 0 };

  for (const raw of openHandles) {
    try {
      raw.pragma("busy_timeout = 1000");
      const rows = raw.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy?: number }> | undefined;
      if (Number(rows?.[0]?.busy ?? 0) === 0) report.checkpointed += 1;
      else report.incomplete += 1;
    } catch {
      // A checkpoint can fail outright if another connection holds a read lock.
      // The close below still flushes; the WAL just survives to be recovered.
      report.incomplete += 1;
    }
    try {
      raw.close();
    } catch {
      // Already closed, or closing mid-statement. Nothing left to do.
    }
    openHandles.delete(raw);
  }

  return report;
}
