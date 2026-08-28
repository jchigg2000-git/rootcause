"use client";

import { FormEvent, useState } from "react";
import { LogoMark } from "../components/logo.tsx";

/**
 * Sign-in form — ONE credential field.
 *
 * There are no passwords in this app (2026-08-18). The same box takes either
 * the owner's skeleton key or an access code, and the server decides which it
 * got. Deliberately one field rather than a picker: an operator handed a code
 * should not have to know what kind of secret it is, and the server's single
 * error string does not tell an attacker which kind they guessed.
 *
 * A real <form> with a submit handler, not a div of inputs with a click
 * handler — a password manager keys its save prompt off form submission, and
 * this also makes Enter work. `autoComplete="current-password"` on a text input
 * is intentional: it is what gets a manager to offer to store the code, which
 * matters more here than anywhere, because a lost code cannot be recovered.
 * After success we do a full navigation rather than a soft route change,
 * because a manager that never sees a navigation follow the submit will usually
 * not offer to save.
 */
export function LoginForm() {
  const [credential, setCredential] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, remember }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Sign-in failed. Please try again.");
        setBusy(false);
        return;
      }
      // A full document load, not router.push: the session cookie was set by the
      // response we just read, and every page resolves its own user server-side
      // via pageUser(). A client-side navigation would render the new route
      // against the pre-login server state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch {
      setError("Sign-in could not be reached. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <header className="auth-head">
          <LogoMark size={40} title="RootCause HME" />
          <div>
            <p className="eyebrow">RootCause</p>
            <h1>Sign in</h1>
          </div>
        </header>
        <p className="auth-lede">
          Enter your access code, or the owner key for this installation.
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Access code or key</span>
            <input
              type="password"
              name="credential"
              autoComplete="current-password"
              placeholder="RC-XXXXX-XXXXX-XXXXX-XXXXX"
              spellCheck={false}
              autoCapitalize="characters"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              required
              autoFocus
            />
            <small>Codes are not case-sensitive and the dashes are optional.</small>
          </label>

          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>Keep me signed in for 30 days</span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>
    </main>
  );
}
