/**
 * Shared request contract for `/api/spec-lookup`.
 *
 * Pure functions and constants only, so the client component and the route
 * can hold the same limits and the whole contract is testable under plain
 * `node --test` — same shape as `app/api/diagnose/contract.ts`.
 */

export const MAX_PIN_LENGTH = 40;
export const MAX_FIELD_LENGTH = 120;

/**
 * PIN format is deliberately unvalidated beyond length. Heavy-equipment PINs
 * range from short legacy serials to the 17-character ISO/PIS format, and the
 * app's whole philosophy (see `equipment-catalog.ts`) is old and odd machines
 * over a rigid schema — the model has to make sense of whatever was typed.
 */
export type SpecLookupRequest = {
  pin: string;
  year?: string;
  make?: string;
  model?: string;
  machineType?: string;
};

export function clean(value?: string): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function validateRequest(body: SpecLookupRequest): string | null {
  if (!body || typeof body.pin !== "string") {
    return "Enter a product identification number.";
  }
  const pin = clean(body.pin);
  if (!pin) return "Enter a product identification number.";
  if (pin.length > MAX_PIN_LENGTH) return "That PIN is longer than any real serial number.";

  const optionalFields: Array<keyof SpecLookupRequest> = ["year", "make", "model", "machineType"];
  for (const field of optionalFields) {
    const value = body[field];
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_FIELD_LENGTH)) {
      return "One of the machine fields is too long.";
    }
  }

  return null;
}
