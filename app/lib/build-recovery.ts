/**
 * Recognising the browser's "that chunk is gone" errors.
 *
 * The client is code-split into content-hashed chunks (`/assets/library-view-
 * <hash>.js`) served `immutable`, while the HTML shell is `no-store`. A deploy
 * replaces the container filesystem, so every hash from the previous build
 * 404s — verified against production: old hashes answer 404, current ones 200.
 * A tab that was open across a deploy keeps running the old build, and the
 * first navigation to a route whose chunk it had not already downloaded asks
 * for a URL that no longer exists.
 *
 * Nothing about that reaches the server as an error — it is a plain 404 for a
 * static file — which is why a day of these left no trace in the deploy logs.
 *
 * The failure text is not standardised, so this matches all four engines'
 * wording rather than one. Kept pure and separate from the component so the
 * matching is testable without a DOM; see `tests/build-recovery.test.mjs`.
 */

/** Substrings each engine uses for a failed dynamic `import()`. Lowercased. */
const MODULE_LOAD_SIGNATURES = [
  "failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "importing a module script failed", // Safari / WebKit
  "unable to preload css", // Vite's CSS preload helper
  "chunkloaderror", // webpack-era name, still thrown by some loaders
  "loading chunk", // "Loading chunk 42 failed"
  "failed to load module script", // strict-MIME 404 fallthrough
  "'text/html' is not a valid javascript mime type", // 404 page served for a .js URL
];

/**
 * The text to match against, from whatever the event actually carried.
 *
 * A rejection's `reason` is an Error for a failed `import()`, but engines also
 * reject with a bare string, and an `ErrorEvent` may hand over only `message`.
 * Anything without usable text returns "" and therefore never matches — the
 * safe direction, since matching triggers a reload.
 */
function messageOf(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (reason && typeof reason === "object") {
    const { message, name } = reason as { message?: unknown; name?: unknown };
    if (typeof message === "string") {
      return typeof name === "string" ? `${name}: ${message}` : message;
    }
  }
  return "";
}

/**
 * Whether this error means "the build this tab is running no longer exists".
 *
 * Deliberately narrow. Anything matched here triggers a reload, so a false
 * positive on an ordinary application error would reload the page out from
 * under the operator mid-interview. A genuine bug in our own code must fall
 * through to the error boundary instead.
 */
export function isStaleBuildError(reason: unknown): boolean {
  const text = messageOf(reason);
  if (!text) return false;
  const haystack = text.toLowerCase();
  return MODULE_LOAD_SIGNATURES.some((signature) => haystack.includes(signature));
}

/**
 * Whether a resource-load `error` event is one of our own build artifacts
 * failing to load — a `<script>` or `<link>` under `/assets/` that 404s.
 *
 * These arrive as an `error` event on the element rather than as a thrown
 * exception, so they carry no message to match on: the element's URL is the
 * only signal available.
 */
export function isStaleBuildAsset(tagName: unknown, url: unknown): boolean {
  if (typeof tagName !== "string" || typeof url !== "string") return false;
  const tag = tagName.toLowerCase();
  if (tag !== "script" && tag !== "link") return false;
  // Same-origin build output only. A third-party script failing is not our
  // deploy, and must not reload the page.
  return url.startsWith("/assets/") || url.includes("/assets/");
}

/** How long after a recovery reload another one is refused. */
export const RELOAD_COOLDOWN_MS = 20_000;

/**
 * Whether to reload now, given when the last recovery reload happened.
 *
 * The cooldown is what stops a reload loop: if the new build is itself broken
 * the same error fires immediately on the reloaded page, and reloading again
 * would spin forever. Outside the window a reload is allowed again, because a
 * tab left open across two deploys in one session should recover from both.
 *
 * `lastReloadAt` is whatever was stored last — `null` when nothing was, and
 * NaN-safe because it comes back from sessionStorage as a string.
 */
export function shouldReload(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true;
  return now - lastReloadAt >= RELOAD_COOLDOWN_MS;
}
