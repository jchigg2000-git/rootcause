/**
 * The inference seam.
 *
 * Two providers, two wire protocols. This is deliberately not a base-URL
 * switch: the Anthropic Messages API differs from an OpenAI-compatible router
 * on every axis this route uses — endpoint, auth header, where the system
 * prompt lives, how images are carried, how JSON is enforced, and whether
 * `temperature` is even accepted. Decided 2026-08-04: the catalog carries the
 * provider, so a model id resolves to its own client.
 *
 * Callers build one provider-neutral `ChatRequest` and never learn which
 * client ran it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../lib/server-env.ts";
import { providerFor, type ProviderId } from "../../lib/settings.ts";
import { recordLlmTelemetry } from "../../lib/observability.ts";

/** Default OpenAI-compatible base URL; override with HF_BASE_URL. */
export const DEFAULT_HF_BASE_URL = "https://router.huggingface.co/v1";

export type ChatImage = { mediaType: string; base64: string };
export type ChatTurn = { role: "assistant" | "user"; content: string };

export type SearchBudget = { maxSearches: number; maxFetches: number };

/**
 * `schema` and `search` are mutually exclusive **by type**, not by convention.
 *
 * Measured 2026-08-05: with `output_config.format` in force, every assistant
 * text segment must satisfy the schema, so a model that wants to interleave
 * reasoning with tool calls emits an empty schema instance and ends the turn.
 * Both failure modes were observed — several concatenated objects in one
 * response, and a single wholly empty one — and neither raises an error, so a
 * grounded-and-constrained call fails silently at runtime. Grounded callers run
 * two calls instead: research with `search`, then format with `schema`. See
 * `app/api/spec-lookup/route.ts` and `app/api/spec-lookup/prompts.ts`.
 */
export type ChatRequest = ChatRequestBase &
  (
    | { schema: Record<string, unknown>; search?: undefined }
    | { search: SearchBudget; schema?: undefined }
    | { schema?: undefined; search?: undefined }
  );

type ChatRequestBase = {
  model: string;
  /**
   * Telemetry label — which billable pathway this call is. Today: `interview`,
   * `report`, `spec-research`, `spec-format`, `parts-research`, `parts-format`,
   * `random-scenario`. Required rather than optional so a new call site shows
   * up named on the observability page instead of as a blank.
   */
  operation: string;
  /** Provider-neutral: becomes a system message or a top-level field. */
  system: string;
  /** The machine-context block that opens the first user turn. */
  context: string;
  images: ChatImage[];
  transcript: ChatTurn[];
  /** Appended as a final user turn when present (the report handoff). */
  handoff?: string;
  maxTokens: number;
  timeoutMs: number;
  /**
   * Anthropic only; ignored by the HF path.
   *
   * Load-bearing for latency, not a nicety: at the default effort a 12-section
   * report measured 5m29s end to end, because thinking is on by default and
   * scales with it. Measured 2026-08-04.
   */
  effort: "low" | "medium" | "high";
};

/** Only Anthropic carries the server-side search tools. */
export function groundingSupported(provider: ProviderId): boolean {
  return provider === "anthropic";
}

/** Haiku-family models reject `output_config.effort` with a 400. */
function supportsEffort(model: string): boolean {
  return !model.startsWith("claude-haiku");
}

export type ChatOutcome =
  | {
      ok: true;
      content: string;
      truncated: boolean;
      /** Provider-reported token counts; null when the response carried none. */
      usage?: { inputTokens: number | null; outputTokens: number | null };
    }
  | {
      ok: false;
      status: number;
      /** Safe to show a caller. Never carries provider detail. */
      message: string;
      /** Server-log only — may carry account, routing or quota detail. */
      detail: string;
      /** The failure is consistent with the model not accepting images. */
      imageHint: boolean;
    };

/** Whether a provider has the credentials it needs, without revealing them. */
export function providerConfigured(provider: ProviderId): boolean {
  return provider === "anthropic"
    ? Boolean(env.ANTHROPIC_API_KEY?.trim())
    : Boolean(env.HF_TOKEN?.trim());
}

export async function runChat(request: ChatRequest): Promise<ChatOutcome> {
  const provider = providerFor(request.model);
  const started = Date.now();
  const outcome =
    provider === "anthropic" ? await runAnthropic(request) : await runHuggingFace(request);

  // Every billable call crosses this seam, so this one emit is the entire
  // telemetry instrumentation. Fire-and-forget: `recordLlmTelemetry` never
  // throws, and nothing awaits it — a broken observability store cannot slow
  // or fail the diagnostic request that produced the event.
  void recordLlmTelemetry(env.OBS_DB, {
    operation: request.operation,
    provider,
    model: request.model,
    durationMs: Date.now() - started,
    inputTokens: outcome.ok ? (outcome.usage?.inputTokens ?? null) : null,
    outputTokens: outcome.ok ? (outcome.usage?.outputTokens ?? null) : null,
    ok: outcome.ok,
    status: outcome.ok ? null : outcome.status,
    truncated: outcome.ok ? outcome.truncated : false,
  });

  return outcome;
}

/* ------------------------------------------------------------------ *
 * Anthropic — POST /v1/messages via the official SDK
 * ------------------------------------------------------------------ */

async function runAnthropic(request: ChatRequest): Promise<ChatOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return fail(500, "Anthropic is not configured. Set ANTHROPIC_API_KEY on the server.", "");
  }

  const client = new Anthropic({ apiKey, timeout: request.timeoutMs, maxRetries: 1 });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: request.context },
        // Anthropic carries images as base64 source blocks, not data URLs.
        ...request.images.map(
          (image): Anthropic.ImageBlockParam => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType as Anthropic.Base64ImageSource["media_type"],
              data: image.base64,
            },
          }),
        ),
      ],
    },
    ...request.transcript.map((turn): Anthropic.MessageParam => ({
      role: turn.role,
      content: turn.content,
    })),
  ];
  if (request.handoff) messages.push({ role: "user", content: request.handoff });

  try {
    // Streaming is not optional above ~16k output: thinking is on by default on
    // the current models and `max_tokens` caps thinking *plus* answer, so a
    // report-sized budget will otherwise hit the SDK's HTTP timeout.
    const stream = client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      // The system prompt is a top-level field here, never a message.
      system: request.system,
      messages,
      // Server-side retrieval. Mutually exclusive with the schema below — see
      // the `search` field's comment for the measured reason.
      ...(request.search
        ? {
            tools: [
              {
                type: "web_search_20260318" as const,
                name: "web_search" as const,
                max_uses: request.search.maxSearches,
              },
              {
                type: "web_fetch_20260318" as const,
                name: "web_fetch" as const,
                max_uses: request.search.maxFetches,
              },
            ],
          }
        : {}),
      // Schema-constrained decoding, the Anthropic analogue of the HF router's
      // `response_format: { type: "json_object" }`. Strictly stronger: it
      // constrains the shape, not merely the syntax.
      //
      // `effort` only for models that take it: Haiku 4.5 400s on the parameter
      // ("This model does not support the effort parameter", measured
      // 2026-08-06), so it is keyed off the model family here rather than
      // making every Haiku call site carry the exception.
      ...(request.schema
        ? {
            output_config: {
              format: { type: "json_schema" as const, schema: request.schema },
              ...(supportsEffort(request.model) ? { effort: request.effort } : {}),
            },
          }
        : supportsEffort(request.model)
          ? { output_config: { effort: request.effort } }
          : {}),
      // No `temperature` / `top_p` / `top_k` — the current models reject them
      // with a 400. Determinism comes from the prompt and from effort.
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return fail(502, "The diagnostic model declined this request.", "stop_reason=refusal", false);
    }

    const content = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!content) return fail(502, "The diagnostic model returned an empty response.", "");
    return {
      ok: true,
      content,
      truncated: message.stop_reason === "max_tokens",
      usage: {
        inputTokens: message.usage?.input_tokens ?? null,
        outputTokens: message.usage?.output_tokens ?? null,
      },
    };
  } catch (error) {
    return anthropicFailure(error, request.images.length > 0);
  }
}

function anthropicFailure(error: unknown, hasImages: boolean): ChatOutcome {
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 502;
    return fail(
      status >= 400 && status < 600 ? status : 502,
      "The diagnostic model rejected the request.",
      `${status} ${String(error.message).replace(/\s+/g, " ").slice(0, 240)}`,
      hasImages && status === 400,
    );
  }
  const timedOut =
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return fail(
    502,
    timedOut
      ? "The diagnostic model took too long to respond. Please try again."
      : "The diagnostic model could not be reached. Please try again.",
    "",
  );
}

/* ------------------------------------------------------------------ *
 * Hugging Face — an OpenAI-compatible /chat/completions base
 * ------------------------------------------------------------------ */

type HfMessage = {
  role: "assistant" | "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

async function runHuggingFace(request: ChatRequest): Promise<ChatOutcome> {
  const token = env.HF_TOKEN?.trim();
  if (!token) {
    return fail(500, "Hugging Face is not configured. Set HF_TOKEN on the server.", "");
  }

  const baseUrl = (env.HF_BASE_URL?.trim() || DEFAULT_HF_BASE_URL).replace(/\/+$/, "");
  const chatUrl = `${baseUrl}/chat/completions`;

  const messages: HfMessage[] = [
    { role: "system", content: request.system },
    {
      role: "user",
      content: [
        { type: "text", text: request.context },
        ...request.images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
        })),
      ],
    },
    ...request.transcript.map((turn) => ({ role: turn.role, content: turn.content })),
  ];
  if (request.handoff) messages.push({ role: "user", content: request.handoff });

  const call = (constrained: boolean) =>
    fetch(chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: 0.2,
        // Both actions return JSON. Constrained decoding is what makes that
        // reliable: free-form generation of a 10KB report object intermittently
        // emits an unescaped quote — inch marks alone guarantee it — and no
        // amount of repair can recover a document whose string boundaries moved.
        ...(constrained ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });

  // A schema-less request is a prose call (the grounded research phase), so
  // there is no JSON to constrain. The HF path has no search tools, so such a
  // call answers from recall — `groundingSupported()` is how callers avoid it.
  const wantsJson = Boolean(request.schema);

  let upstream: Response;
  try {
    upstream = await call(wantsJson);
    // Not every model behind an OpenAI-compatible base accepts response_format.
    if (wantsJson && upstream.status === 400) upstream = await call(false);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return fail(
      502,
      timedOut
        ? "The diagnostic model took too long to respond. Please try again."
        : "The diagnostic model could not be reached. Please try again.",
      "",
    );
  }

  if (!upstream.ok) {
    return fail(
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      "The diagnostic model rejected the request.",
      `${upstream.status} ${await safeUpstreamError(upstream)}`,
      request.images.length > 0 && upstream.status === 400,
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return fail(502, "The diagnostic model returned an unreadable response.", "");
  }

  const content = getAssistantContent(payload);
  if (!content) return fail(502, "The diagnostic model returned an empty response.", "");

  return {
    ok: true,
    content,
    truncated: getFinishReason(payload) === "length",
    usage: getUsage(payload),
  };
}

/** OpenAI-compatible usage block; absent on some routed models. */
function getUsage(payload: unknown): { inputTokens: number | null; outputTokens: number | null } {
  const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
    .usage;
  return {
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

function getAssistantContent(payload: unknown): string | null {
  const response = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("\n").trim() || null;
  }
  return null;
}

function getFinishReason(payload: unknown): string | null {
  const response = payload as { choices?: Array<{ finish_reason?: string }> };
  return response.choices?.[0]?.finish_reason ?? null;
}

/** The provider's error body can carry account, routing and quota detail. */
async function safeUpstreamError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? payload.message ?? "";
    return message.replace(/\s+/g, " ").slice(0, 240);
  } catch {
    return "";
  }
}

function fail(status: number, message: string, detail: string, imageHint = false): ChatOutcome {
  return { ok: false, status, message, detail, imageHint };
}

/**
 * Split a `data:` URL into the parts a provider needs.
 *
 * Returns null rather than throwing on a malformed value; `validateRequest`
 * has already checked the shape, so null here means a caller bypassed it.
 */
export function splitDataUrl(dataUrl: string): ChatImage | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  return match ? { mediaType: match[1].toLowerCase(), base64: match[2] } : null;
}
