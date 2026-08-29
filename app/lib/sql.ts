/**
 * Split a .sql migration file into executable statements.
 *
 * Comment lines are stripped BEFORE splitting on `;`. Splitting first and then
 * discarding chunks that begin with `--` silently drops every statement that
 * has a comment above it, which is most of them in a documented schema.
 */
import type { Database } from "./db.ts";

export function sqlStatements(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Run a schema file once per isolate, retrying on the next request if it fails
 * rather than caching a rejected promise forever.
 */
export function createSchemaRunner(source: string) {
  let ready: Promise<void> | null = null;
  return (db: Database): Promise<void> => {
    if (!ready) {
      ready = db
        .batch(sqlStatements(source).map((statement) => db.prepare(statement)))
        .then(() => undefined);
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };
}

/**
 * Add a column to an existing table, once, safely on every boot.
 *
 * The migration files re-run in full on every process start, so a bare
 * `ALTER TABLE … ADD COLUMN` in a .sql file works exactly once and then fails
 * every boot after it (SQLite has no ADD COLUMN IF NOT EXISTS). New columns
 * therefore live in the table's CREATE statement — which covers fresh
 * databases, where CREATE IF NOT EXISTS actually runs — and grown databases
 * get them from this guard: PRAGMA the live table, ALTER only when the column
 * is genuinely missing. Same memoize-with-retry shape as `createSchemaRunner`.
 *
 * `table` / `column` / `ddl` are code literals from the calling module, never
 * request input — they are interpolated, not bound, because SQLite cannot
 * parameterize identifiers.
 */
export function createColumnGuard(table: string, column: string, ddl: string) {
  let ready: Promise<void> | null = null;
  return (db: Database): Promise<void> => {
    if (!ready) {
      ready = (async () => {
        const { results } = await db
          .prepare(`PRAGMA table_info(${table})`)
          .all<{ name: string }>();
        if (!results.some((row) => row.name === column)) {
          await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
        }
      })();
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };
}

/**
 * Remove a column from an existing table, once, safely on every boot.
 *
 * The mirror of `createColumnGuard`, and needed for the same reason: the
 * migration files re-run in full on every process start, so a bare
 * `ALTER TABLE … DROP COLUMN` in a .sql file works exactly once and then fails
 * every boot after it. A column dropped from a table's CREATE covers fresh
 * databases; a database that already grew the column gets it removed here.
 *
 * This is not cosmetic tidying. The columns this exists for were `NOT NULL`,
 * so a database still carrying one would reject every INSERT the new code
 * writes — the failure is total, not gradual.
 *
 * Any index over the column has to be gone first, or SQLite refuses the drop.
 * Those live as `DROP INDEX IF EXISTS` in the .sql file, which is idempotent
 * and runs ahead of this guard.
 *
 * `table` / `column` are code literals from the calling module, never request
 * input — they are interpolated, not bound, because SQLite cannot parameterize
 * identifiers.
 */
export function createColumnDropper(table: string, column: string) {
  let ready: Promise<void> | null = null;
  return (db: Database): Promise<void> => {
    if (!ready) {
      ready = (async () => {
        const { results } = await db
          .prepare(`PRAGMA table_info(${table})`)
          .all<{ name: string }>();
        if (results.some((row) => row.name === column)) {
          await db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column}`).run();
        }
      })();
      ready.catch(() => {
        ready = null;
      });
    }
    return ready;
  };
}
