/**
 * Migration files are imported as raw SQL so the .sql stays the single
 * source of truth (see `app/lib/sql.ts`, `app/lib/auth/store.ts`,
 * `app/lib/settings.ts`). Vite's `?raw` suffix resolves to the file's text
 * content; this ambient declaration is what makes that typecheck.
 *
 * Carried over from `worker-configuration.d.ts`, which is gone along with the
 * Cloudflare Workers runtime — this is the surviving home for the one
 * declaration from that file still needed.
 */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
