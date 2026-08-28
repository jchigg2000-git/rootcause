#!/usr/bin/env node
// Run ONLY a variant's precall() over a scenario file and print what it says.
//
// Exists so the code-triage hypothesis can be inspected for a few cents before
// a full arm is billed: the precall is one short call per scenario, while the
// arm it feeds is an interview plus a report per scenario.
//
//   node evals/try-precall.mjs --prompt-variant codes-triage \
//        --scenarios evals/scenarios-codes-intake.json
//
// Deliberately standalone. Importing run-eval.mjs to reach its internals would
// START A BILLED RUN — it has no main() guard.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 2 });
const MODEL = arg("model", "claude-sonnet-5");

const variantName = arg("prompt-variant", "codes-triage");
const variant = (await import(pathToFileURL(join(ROOT, "evals/prompt-variants", `${variantName}.mjs`)).href)).default;
if (!variant?.precall) throw new Error(`variant "${variantName}" defines no precall()`);

const scenariosPath = arg("scenarios", join(ROOT, "evals/scenarios-codes-intake.json"));
const { scenarios } = JSON.parse(readFileSync(scenariosPath, "utf8"));

const ask = async ({ system, user, maxTokens = 700 }) => {
  const message = await client.messages.create(
    { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
    { timeout: 90_000 },
  );
  return {
    text: message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim(),
    usage: { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null },
  };
};

let inTok = 0;
let outTok = 0;
for (const scenario of scenarios) {
  const result = await variant.precall(scenario, ask);
  console.log("\n" + "=".repeat(78));
  console.log(scenario.id);
  console.log("entered: " + (scenario.intake?.faultCodes ?? "(none)"));
  console.log("-".repeat(78));
  if (!result) {
    console.log("(precall returned null — no append, context stays byte-identical to control)");
    continue;
  }
  console.log(result.append);
  inTok += result.usage?.inputTokens ?? 0;
  outTok += result.usage?.outputTokens ?? 0;
}
console.log("\n" + "=".repeat(78));
console.log(`precall cost across ${scenarios.length} scenarios: ${inTok} in / ${outTok} out`);
