import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vinext/**",
    "dist/**",
    "out/**",
    "next-env.d.ts",
    // Local tooling scratch space. It can hold whole nested checkouts with
    // their own `dist/`, which the root-relative `dist/**` above does not
    // reach — left unignored those contribute thousands of findings from built
    // bundles and make `npm run lint` useless as a gate.
    ".claude/**",
  ]),
]);

export default eslintConfig;
