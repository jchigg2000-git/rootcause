"use client";

import { isStaleBuildError } from "./lib/build-recovery.ts";

/**
 * The last line of defence: what renders when a client error escapes
 * everything else.
 *
 * Until this file existed there was no error boundary anywhere in the app, so
 * any throw during render blanked the page to white with nothing on screen and
 * nothing in the server log. `global-error` replaces the root layout when it
 * fires, so it owns `<html>`/`<body>` itself.
 *
 * Styles are inline on purpose. This page has to render in exactly the
 * situation where the stylesheet may be the asset that failed to load, so it
 * cannot depend on `globals.css`. The palette is the shell's blue/orange from
 * that file, repeated here rather than imported.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A stale build reaching this boundary means BuildRecovery's reload either
  // did not fire or was refused by its cooldown. Reloading is still the fix,
  // so say so instead of offering a retry that re-runs the same dead import.
  const staleBuild = isStaleBuildError(error?.message);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#10243a",
          color: "#f4f6f8",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          lineHeight: 1.5,
        }}
      >
        <main style={{ width: "min(560px, 100%)" }}>
          <p
            style={{
              margin: "0 0 10px",
              font: "700 .7rem ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "#e07a1f",
            }}
          >
            RootCause
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: "clamp(1.4rem, 4vw, 2rem)", lineHeight: 1.15 }}>
            {staleBuild ? "This page is out of date" : "Something went wrong"}
          </h1>
          <p style={{ margin: "0 0 22px", color: "#c3ccd6" }}>
            {staleBuild
              ? "The app was updated while this tab was open, so part of it could not load. Reloading picks up the new version."
              : "The page hit an unexpected error. Your saved cases and reports are not affected."}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={buttonStyle(true)}
            >
              Reload the page
            </button>
            {!staleBuild && (
              <button type="button" onClick={() => reset()} style={buttonStyle(false)}>
                Try again
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                deliberately a plain <a>. This boundary renders when the client
                build is broken, which is precisely when the router must not be
                used: a <Link> navigation would run the same dead module graph
                that got us here. A hard navigation refetches the shell. */}
            <a href="/" style={{ ...buttonStyle(false), textDecoration: "none" }}>
              Start over
            </a>
          </div>

          {/* The digest is the only handle on the server-side stack for this
              error; without it a report is unactionable. The message itself
              stays off the page — it can carry internals. */}
          {error?.digest && (
            <p
              style={{
                margin: "22px 0 0",
                font: "600 .72rem ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "#8b98a6",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    display: "inline-block",
    minHeight: "44px",
    padding: "0 18px",
    lineHeight: "42px",
    borderRadius: "6px",
    border: primary ? "1px solid #e07a1f" : "1px solid #3a4b60",
    background: primary ? "#e07a1f" : "transparent",
    color: primary ? "#1a1205" : "#f4f6f8",
    font: "700 .8rem ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: ".04em",
    textTransform: "uppercase",
    cursor: "pointer",
    textAlign: "center",
  };
}
