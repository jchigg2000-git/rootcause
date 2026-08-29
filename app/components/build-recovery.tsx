"use client";

import { useEffect } from "react";
import {
  RELOAD_COOLDOWN_MS,
  isStaleBuildAsset,
  isStaleBuildError,
  shouldReload,
} from "../lib/build-recovery.ts";

/** Where the last recovery reload's timestamp lives, so a loop can't form. */
const RELOAD_KEY = "rootcause:build-reload-at";

/**
 * Reload once when this tab's build has been deployed away.
 *
 * Mounted in the root layout, so it is listening on every page. Renders
 * nothing — it exists only for the two window listeners.
 *
 * This is the recovery, not a fix for the underlying condition: chunks really
 * are gone after a deploy and cannot be served again. Reloading picks up the
 * new build, which is the only way forward. It is deliberately a full reload
 * rather than a router retry because the whole module graph is stale, not one
 * route.
 *
 * The cost is real and worth naming: a reload discards in-progress client
 * state. Anything already sent is persisted server-side (the case, its
 * transcript, the report), but unsent interview answers are lost. That is
 * still strictly better than the alternative, which is a dead page — vinext's
 * own fallback for a failed RSC navigation is `location.href = currentHref`,
 * a hard navigation that loses the same state without explaining why.
 */
export function BuildRecovery() {
  useEffect(() => {
    const recover = () => {
      let lastReloadAt: number | null = null;
      try {
        const stored = window.sessionStorage.getItem(RELOAD_KEY);
        lastReloadAt = stored === null ? null : Number(stored);
      } catch {
        // Private mode or a blocked storage partition. Treated as "never
        // reloaded", which is the safe direction: recovery still happens, and
        // the browser's own repeated-reload protection is the remaining
        // backstop.
      }

      if (!shouldReload(lastReloadAt, Date.now())) {
        // Already tried within the cooldown, so the new build is failing too.
        // Stop reloading and let the error surface.
        console.error(
          `[build-recovery] asset still failing less than ${RELOAD_COOLDOWN_MS}ms after a recovery reload; not reloading again`,
        );
        return;
      }

      try {
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // See above — proceed without the guard rather than skip recovery.
      }
      window.location.reload();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (isStaleBuildError(event.reason)) recover();
    };

    // Capture phase: a failed `<script>`/`<link>` fires a non-bubbling `error`
    // event at the element, which never reaches a listener on `window` during
    // the bubble phase.
    const onError = (event: Event) => {
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null;
      if (
        target &&
        isStaleBuildAsset(target.tagName, target.src ?? target.href ?? "", window.location.origin)
      ) {
        recover();
        return;
      }
      if (event instanceof ErrorEvent && isStaleBuildError(event.error ?? event.message)) {
        recover();
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError, true);
    };
  }, []);

  return null;
}
