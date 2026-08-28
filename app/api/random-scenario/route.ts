/**
 * A plausible operator complaint for the randomized demo machine.
 *
 * Admin-only via ADMIN_API_PREFIXES — the "Randomize machine" button is a
 * demo/testing affordance for admins, not an operator feature. Pinned to
 * Haiku: this is a
 * $-per-click surface that needs one short paragraph, not report-grade depth.
 */
import { env } from "../../lib/server-env.ts";
import { currentUser, jsonError, jsonResponse } from "../../lib/auth/current-user.ts";
import { recordGrantUsage } from "../../lib/access.ts";
import { providerFor } from "../../lib/settings.ts";
import { providerConfigured, runChat } from "../diagnose/providers.ts";

const SCENARIO_MODEL = "claude-haiku-4-5";

const SYSTEM =
  "You invent one realistic heavy-equipment fault scenario for a diagnostic " +
  "intake demo. Write the operator's complaint in first person, plain field " +
  "language: what the machine is doing, when it started, what makes it better " +
  "or worse, any codes on the display. 2-4 sentences. Pick one specific, " +
  "plausible fault for this machine class — vary the system involved " +
  "(hydraulic, electrical, engine, drivetrain, undercarriage, operator " +
  "station) rather than defaulting to the most common failure. Output only " +
  "the complaint text, no preamble and no quotes.";

const field = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 80) : "";

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return jsonError("Sign in to continue.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("The scenario request could not be read.", 400);
  }
  const year = field(body.year);
  const make = field(body.make);
  const model = field(body.model);
  const machineType = field(body.machineType);
  if (!make || !model) return jsonError("A make and model are required.", 400);

  if (!providerConfigured(providerFor(SCENARIO_MODEL))) {
    return jsonError("The scenario model's provider is not configured on the server.", 500);
  }

  const outcome = await runChat({
    model: SCENARIO_MODEL,
    operation: "random-scenario",
    system: SYSTEM,
    context: `Machine: ${[year, make, model].filter(Boolean).join(" ")}${machineType ? ` (${machineType})` : ""}`,
    images: [],
    transcript: [],
    maxTokens: 400,
    timeoutMs: 30_000,
    effort: "low",
  });

  if (env.APP_DB) {
    void recordGrantUsage(env.APP_DB, user, "random-scenario", outcome.ok ? outcome.usage : undefined);
  }

  if (!outcome.ok) {
    if (outcome.detail) console.error(`[random-scenario] upstream: ${outcome.detail}`);
    return jsonError(outcome.message, outcome.status);
  }

  const scenario = outcome.content.trim();
  if (!scenario) return jsonError("The model returned an empty scenario.", 502);
  return jsonResponse({ scenario });
}
