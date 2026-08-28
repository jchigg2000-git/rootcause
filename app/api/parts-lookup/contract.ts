/**
 * Shared request contract for `/api/parts-lookup`.
 *
 * Pure functions and constants only, testable under plain `node --test` —
 * same shape as `app/api/spec-lookup/contract.ts`. The lookup is machine-
 * scoped by design: a lookup always targets one of the caller's own saved
 * machines, so the route resolves identity from that inventory row, never
 * from free-form request fields.
 */

export const MAX_PART_QUERY_LENGTH = 200;
export const MAX_MACHINE_ID_LENGTH = 128;

export type PartsLookupRequest = {
  machineId: string;
  partQuery: string;
};

export function clean(value?: string): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function validateRequest(body: PartsLookupRequest): string | null {
  if (!body || typeof body.machineId !== "string" || !clean(body.machineId)) {
    return "Pick a machine from your inventory.";
  }
  if (body.machineId.length > MAX_MACHINE_ID_LENGTH) {
    return "Pick a machine from your inventory.";
  }
  if (typeof body.partQuery !== "string" || !clean(body.partQuery)) {
    return "Name the part you need.";
  }
  if (body.partQuery.length > MAX_PART_QUERY_LENGTH) {
    return "Keep the part description under 200 characters.";
  }
  return null;
}
