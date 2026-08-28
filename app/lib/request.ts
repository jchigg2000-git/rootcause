/**
 * Every way a JSON request can fail, collapsed into one value.
 *
 * The Settings page used to `await fetch(...)` bare. A throw out of the network
 * layer — offline, DNS, connection reset — or out of `response.json()` on a
 * proxy's HTML error page became an unhandled rejection: nothing set the error
 * line, so a failed save read as *"my click didn't register"*. The model
 * `<select>` is controlled by the value the server still held, so it snapped
 * back to the old model with no message anywhere on the page.
 *
 * The fix moves the concern out of React rather than teaching each call site to
 * catch. `requestJson` never throws and never rejects; four different failure
 * modes — the fetch throwing, a non-OK status, a body that will not parse, and
 * a body that parses but names no reason — all arrive as `{ ok: false, message }`.
 * A caller is then one `if` and one `return`, with no `try` anywhere and one
 * unconditional place to drop its busy flag.
 *
 * Framework-free on purpose: no React, no import of anything in this repo, and
 * no DOM beyond `fetch` itself, so `tests/request-contract.test.mjs` can pin it
 * under a plain `node --test` run with a stubbed `globalThis.fetch`.
 */

/**
 * The one shape. `data` on success, a sentence to show the operator on failure.
 *
 * There is deliberately no third arm and no error code: a caller that can only
 * render one string should only be handed one string.
 */
export type Fetched<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * What the operator reads when the request never reached the server.
 *
 * The difference between *"the server refused"* and *"I could not reach the
 * server"* is kept HERE, in the wording, and deliberately not in the type: it
 * changes what to say, never what to do. Promoting it to a second failure arm
 * would hand six call sites a branch to take, and the one that forgot to take
 * it would be silent in exactly the way this module exists to prevent.
 */
export const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

/** Last resort: the server refused, named no reason, and the caller supplied none. */
export const GENERIC_FAILURE_MESSAGE = "That request could not be completed.";

/**
 * The server's own `{ error }` sentence, when it sent one worth showing.
 *
 * Every route in this app answers a refusal with `{ error }` (`jsonError`), and
 * those strings are written for the operator — "Reports must be a whole number
 * (0 for unlimited)." beats any wording the client could invent. A blank or
 * non-string `error` counts as absent so the caller's fallback takes over.
 */
function serverMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const { error } = body as { error?: unknown };
  return typeof error === "string" && error.trim() ? error : "";
}

/**
 * Perform a request and return its JSON body, or a message explaining why not.
 *
 * `input` and `init` are passed to `fetch` untouched — this changes how failures
 * are reported, never what goes on the wire.
 *
 * `fallbackMessage` is what the operator sees when the server refused without
 * saying why, or answered with something that is not JSON at all. Write it as a
 * full sentence about the specific thing that failed ("Could not load
 * settings."), because it is the only wording available on those paths.
 */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackMessage: string = GENERIC_FAILURE_MESSAGE,
): Promise<Fetched<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    // No status and no body: the server was never asked, so it said nothing.
    return { ok: false, message: UNREACHABLE_MESSAGE };
  }

  // One read, and it is allowed to fail. A gateway's HTML, a login page served
  // for an expired session, and an empty body all arrive here having promised
  // otherwise in their Content-Type.
  let body: unknown;
  let parsed = true;
  try {
    body = await response.json();
  } catch {
    parsed = false;
  }

  if (!response.ok) {
    return { ok: false, message: serverMessage(body) || fallbackMessage };
  }
  if (!parsed) {
    // A 200 whose body will not parse is still a failure: there is no `T` to
    // hand back, and handing back `undefined` as one is how a page ends up
    // rendering "Loading…" forever.
    return { ok: false, message: fallbackMessage };
  }
  return { ok: true, data: body as T };
}
