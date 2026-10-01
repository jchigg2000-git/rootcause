/**
 * Lets a plain `node --test` import server modules that only Vite can load.
 *
 * Two things in `app/` are Vite-isms rather than Node: `import schema from
 * "….sql?raw"` (the migrations ride in as strings) and extensionless relative
 * specifiers such as `./prompts` (the TypeScript resolver finds the `.ts`). The
 * pure modules stay free of both so the contract tests need no help — see
 * `app/lib/request-guard.ts`. The route handlers and the storage modules cannot,
 * and without this they have no coverage at all.
 *
 * Nothing here changes what the app does. It teaches Node the same two lookups
 * Vite performs, nothing more, and it is registered per test process.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

let registered = false;

export function registerAppLoader() {
  if (registered) return;
  registered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith("?raw")) {
        const target = nextResolve(specifier.slice(0, -"?raw".length), context);
        return { ...target, url: `${target.url}?raw`, shortCircuit: true };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        // Only a relative specifier that names no file is Vite's to complete.
        if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
        return nextResolve(`${specifier}.ts`, context);
      }
    },
    load(url, context, nextLoad) {
      if (!url.endsWith("?raw")) return nextLoad(url, context);
      const text = readFileSync(fileURLToPath(url.slice(0, -"?raw".length)), "utf8");
      return {
        format: "module",
        source: `export default ${JSON.stringify(text)};`,
        shortCircuit: true,
      };
    },
  });
}
