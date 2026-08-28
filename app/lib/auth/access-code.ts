/**
 * The access-code alphabet and its two pure helpers.
 *
 * Split out of `access-tokens.ts` for exactly the reason `paths.ts` is split
 * out of the gate: that module imports its schema with `?raw`, which only Vite
 * understands, so anything importing it cannot be exercised by `node --test`.
 * This is the piece where a mistake either rejects a paying customer's code or
 * folds a near-miss onto somebody else's, so it has to be directly testable.
 *
 * The alphabet excludes I, L, O, U and 0/1 so a code can be read down a phone
 * line without ambiguity and cannot accidentally spell a word.
 */
export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const GROUPS = 4;
export const GROUP_LEN = 5;

/** ~98 bits over a 30-character alphabet, grouped for transcription. */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GROUPS * GROUP_LEN));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i += 1) {
    groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(""));
  }
  return `RC-${groups.join("-")}`;
}

/**
 * Accept a code the way a human retyped it: case-insensitive, hyphens and
 * spaces optional. Normalisation happens before hashing, so the stored hash is
 * of the canonical form and only one representation is ever hashed.
 *
 * Anything that is not exactly a well-formed code returns null rather than a
 * best guess — a near-miss must never normalize into a different valid code.
 */
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bare = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (bare.length !== 2 + GROUPS * GROUP_LEN) return null;
  if (!bare.startsWith("RC")) return null;
  const body = bare.slice(2);
  if (![...body].every((c) => ALPHABET.includes(c))) return null;
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i += 1) groups.push(body.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
  return `RC-${groups.join("-")}`;
}
