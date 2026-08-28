/**
 * The entitlement decision table, and the words a refusal uses.
 *
 * Split from `access.ts` for the same reason `paths.ts` and `access-code.ts` are
 * split from their modules: `access.ts` imports its schema with `?raw`, which
 * only Vite can resolve, so anything imported by a plain `node --test` run has
 * to live outside it. This is the part worth pinning, and pinning it must not
 * require standing up a database. `tests/auth-contract.test.mjs` walks every
 * branch below.
 */

/** The shape the decision reads. The full row lives in `access.ts`. */
export type GrantLimits = {
  run_cap: number;
  runs_used: number;
  token_cap: number;
  tokens_used: number;
};

export type AccessCheck =
  | { allowed: true; exempt: boolean }
  | {
      allowed: false;
      reason: "no-grant" | "runs-exhausted" | "tokens-exhausted";
      used: number;
      cap: number;
    };


/**
 * The decision table, with the storage read lifted out.
 *
 * Split from `checkAccess` for the same reason `paths.ts` and `access-code.ts`
 * are split from their modules: this is the part worth pinning, and pinning it
 * must not require standing up a database. `tests/auth-contract.test.mjs` walks
 * every branch below.
 */
export function decideAccess(
  role: string,
  grant: GrantLimits | null,
): AccessCheck {
  if (role === "admin") return { allowed: true, exempt: true };
  if (!grant) return { allowed: false, reason: "no-grant", used: 0, cap: 0 };

  // Runs first: it is the limit the holder was actually sold, so it should be
  // the one they are told about when both are spent.
  if (grant.run_cap > 0 && grant.runs_used >= grant.run_cap) {
    return { allowed: false, reason: "runs-exhausted", used: grant.runs_used, cap: grant.run_cap };
  }
  if (grant.token_cap > 0 && grant.tokens_used >= grant.token_cap) {
    return {
      allowed: false,
      reason: "tokens-exhausted",
      used: grant.tokens_used,
      cap: grant.token_cap,
    };
  }
  return { allowed: true, exempt: false };
}

/**
 * The refusal for when entitlement could not be READ at all.
 *
 * Not one of the decided outcomes above, and deliberately not worded like one:
 * nobody has been told they are out of anything, because nobody knows. A
 * viewer's grant is the only thing authorising spend against the owner's
 * provider key, so an unreadable grant has to deny — but it denies as a server
 * fault (503), never as an exhausted allowance (429). Telling an operator they
 * have used up an access code they have barely touched is its own kind of wrong,
 * and it sends them to ask for a replacement code they do not need.
 *
 * Added 2026-08-19. Until then all three billable routes logged the exception
 * and fell through into the model call, which is precisely the fail-open this
 * scheme exists to prevent.
 */
export const ACCESS_UNVERIFIABLE_MESSAGE =
  "Your access could not be verified right now. Try again in a moment.";

/** The operator-facing refusal, worded once so every billable route matches. */
export function accessDeniedMessage(check: Extract<AccessCheck, { allowed: false }>): string {
  if (check.reason === "no-grant") {
    return "This account has no remaining allowance. Redeem an access code to continue.";
  }
  if (check.reason === "runs-exhausted") {
    const reports = check.cap === 1 ? "report" : "reports";
    return (
      `You've used all ${check.cap.toLocaleString("en-US")} ${reports} on this access code. ` +
      "Ask for another code to continue."
    );
  }
  return (
    `This access code has reached its ${check.cap.toLocaleString("en-US")} token spending limit. ` +
    "Ask for another code to continue."
  );
}
