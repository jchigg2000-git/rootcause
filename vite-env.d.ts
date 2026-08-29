/**
 * Migration files are imported as raw SQL so the .sql stays the single source
 * of truth (see `app/lib/sql.ts` and its callers). Vite's `?raw` suffix
 * resolves to the file's text content, and this ambient declaration is what
 * makes that typecheck.
 *
 * It is also why a module importing a schema cannot be exercised under a plain
 * `node --test` run — only Vite resolves the suffix. Anything worth pinning is
 * kept in a sibling module free of it.
 */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
