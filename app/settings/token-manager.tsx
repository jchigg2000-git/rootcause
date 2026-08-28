"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../lib/request.ts";

/**
 * The owner's console for access codes — the entire customer on-ramp.
 *
 * Admin-only, mounted from Settings. The plaintext code is returned by POST
 * exactly once and only the SHA-256 is stored, so this component keeps the
 * freshly-issued code on screen until the owner dismisses it. There is no
 * "show again": reissue is the only recovery, and the copy says so.
 */

type TokenRow = {
  id: string;
  label: string | null;
  run_cap: number;
  token_cap: number;
  expires_at: string | null;
  created_at: string;
  redeemed_at: string | null;
  user_id: string | null;
  revoked_at: string | null;
  runs_used: number | null;
  tokens_used: number | null;
};

/** Said twice: as the fallback wording, and when a 2xx arrives carrying no code. */
const ISSUE_FAILED = "The access code could not be issued.";

const fmt = (n: number) => n.toLocaleString("en-US");
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

function statusOf(row: TokenRow): { label: string; tone: string } {
  if (row.revoked_at) return { label: "Revoked", tone: "danger" };
  if (row.expires_at && row.expires_at <= new Date().toISOString()) {
    return { label: "Expired", tone: "warn" };
  }
  // Runs first: it is the limit the holder was sold, so it is the one that
  // should explain a spent code.
  if (row.run_cap > 0 && (row.runs_used ?? 0) >= row.run_cap) {
    return { label: "Used up", tone: "warn" };
  }
  if (row.token_cap > 0 && (row.tokens_used ?? 0) >= row.token_cap) {
    return { label: "Spent", tone: "warn" };
  }
  if (row.redeemed_at) return { label: "Active", tone: "ok" };
  return { label: "Unused", tone: "info" };
}

export function TokenManager() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; label: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const [label, setLabel] = useState("");
  const [runs, setRuns] = useState("3");
  const [cap, setCap] = useState("500000");
  const [days, setDays] = useState("");

  // No state is touched before the first await, so the mount effect below
  // never sets state synchronously (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    const loaded = await requestJson<{ tokens?: TokenRow[] }>(
      "/api/tokens",
      undefined,
      "Access codes could not be loaded.",
    );
    if (!loaded.ok) {
      setError(loaded.message);
      return;
    }
    setRows(loaded.data.tokens ?? []);
    setError("");
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await requestJson<{ code?: string }>(
      "/api/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          runCap: Number(runs),
          tokenCap: Number(cap),
          expiresInDays: days.trim() === "" ? null : Number(days),
        }),
      },
      ISSUE_FAILED,
    );
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    // The plaintext leaves the server exactly once. A 2xx without it means
    // there is nothing to put on screen and nothing to recover, so say so
    // rather than opening an empty issued-code panel.
    if (!result.data.code) {
      setBusy(false);
      setError(ISSUE_FAILED);
      return;
    }
    setIssued({ code: result.data.code, label: label.trim() || null });
    setCopied(false);
    setLabel("");
    // `busy` comes down AFTER the list refresh, not before it. Dropping it at
    // the end of the POST re-enables Issue while the table below is still the
    // pre-issue one, which invites a second code nobody meant to mint.
    await load();
    setBusy(false);
  }

  async function revoke(row: TokenRow) {
    const who = row.label ? `“${row.label}”` : "this code";
    if (!window.confirm(`Revoke ${who}? Anyone signed in with it is signed out immediately.`)) {
      return;
    }
    const revoked = await requestJson<{ revoked?: boolean }>(
      `/api/tokens/${row.id}`,
      { method: "DELETE" },
      "That access code could not be revoked.",
    );
    if (!revoked.ok) {
      setError(revoked.message);
      return;
    }
    await load();
  }

  return (
    <div className="token-manager">
      {issued && (
        <div className="token-issued" role="status">
          <p className="token-issued-title">
            Access code issued{issued.label ? ` for ${issued.label}` : ""}
          </p>
          <code className="token-issued-code">{issued.code}</code>
          <p className="token-issued-note">
            This is the only time it is shown — only a hash is stored. Copy it now; if it is lost,
            issue a new one.
          </p>
          <div className="token-issued-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy code"}
            </button>
            <button type="button" className="button ghost" onClick={() => setIssued(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <form className="token-form" onSubmit={issue}>
        <label className="field">
          <span>Issued to</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Miller Equipment"
            maxLength={120}
          />
        </label>
        <label className="field">
          <span>Reports</span>
          <input
            value={runs}
            onChange={(event) => setRuns(event.target.value)}
            inputMode="numeric"
            placeholder="3"
          />
          <small>
            What the code buys. A report is only counted when it reaches the operator, so a
            failed generation costs nothing. 0 means unlimited.
          </small>
        </label>
        <label className="field">
          <span>Token limit</span>
          <input
            value={cap}
            onChange={(event) => setCap(event.target.value)}
            inputMode="numeric"
            placeholder="500000"
          />
          <small>
            A backstop, not the headline number — total spend this code can ever reach,
            whatever it produced. 0 means unlimited.
          </small>
        </label>
        <label className="field">
          <span>Expires in (days)</span>
          <input
            value={days}
            onChange={(event) => setDays(event.target.value)}
            inputMode="numeric"
            placeholder="never"
          />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Issuing…" : "Issue access code"}
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="muted">No access codes yet. Issue one to let somebody in.</p>
      ) : (
        <ul className="token-list">
          {rows.map((row) => {
            const status = statusOf(row);
            return (
              <li key={row.id} className="token-row">
                <div className="token-row-main">
                  <strong>{row.label || "Unlabelled"}</strong>
                  <span className={`token-status ${status.tone}`}>{status.label}</span>
                </div>
                <div className="token-row-meta">
                  {row.run_cap > 0
                    ? `${fmt(row.runs_used ?? 0)} / ${fmt(row.run_cap)} reports`
                    : `${fmt(row.runs_used ?? 0)} reports · unlimited`}
                  {" · "}
                  {row.token_cap > 0
                    ? `${fmt(row.tokens_used ?? 0)} / ${fmt(row.token_cap)} tokens`
                    : `${fmt(row.tokens_used ?? 0)} tokens`}
                  {" · issued "}
                  {shortDate(row.created_at)}
                  {row.expires_at ? ` · expires ${shortDate(row.expires_at)}` : ""}
                </div>
                {!row.revoked_at && (
                  <button type="button" className="button ghost" onClick={() => void revoke(row)}>
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
