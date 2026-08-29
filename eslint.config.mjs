import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "next-env.d.ts",
    // Tooling scratch space, including agent worktrees, lives under `.claude/`.
    // Each worktree carries a full checkout plus its own `dist/`, which the root-relative
    // `dist/**` above does not reach — left unignored they contribute thousands
    // of findings from built bundles and make `npm run lint` useless as a gate.
    ".claude/**",
  ]),
]);

export default eslintConfig;
