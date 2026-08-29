/**
 * Machine-inventory request contract.
 *
 * Deliberately free of the database and of the `?raw` migration import that
 * `app/lib/inventory.ts` carries — the same reason every testable predicate is kept
 * clean. This is the piece where a coercion mistake writes junk into a user's
 * record, so it has to be checkable without a running server, and the tests
 * import `.ts` directly under Node's type stripping (`npm test`), which cannot
 * resolve a `?raw` specifier.
 */

/** Matches `MAX_PIN_LENGTH` in `app/api/spec-lookup/contract.ts`. */
export const MAX_PIN_LENGTH = 40;
export const MAX_IDENTITY_LENGTH = 80;
export const MAX_MAINTENANCE_LENGTH = 4000;
export const MAX_SERVICE_NOTE_LENGTH = 500;
/** A 40,000-hour excavator is at end of life; 1,000,000 is a typo, not a reading. */
export const MAX_HOURS = 1_000_000;

export type MachineInput = {
  year: string;
  make: string;
  model: string;
  machineType: string;
  serialPin: string;
  /** null means "not recorded", which is not the same as zero hours. */
  currentHours: number | null;
  maintenance: string;
  /** Operator nickname, shown after year/make/model in the card header. */
  label: string;
};

export type MachineRecord = MachineInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type ValidationResult =
  | { ok: true; value: MachineInput }
  | { ok: false; error: string };

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Coerce an hours value the way the inventory records it.
 *
 * "" and null both mean not recorded. 0 is a real reading on a machine fresh
 * off the truck, so the empty check has to be on the input, never on the
 * parsed number — `Number("") === 0` would silently record zero hours.
 * Exported on its own because intake auto-save runs the same coercion on the
 * diagnose request's string `hours` field.
 */
export function coerceHours(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) {
    return { ok: true, value: null };
  }
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_HOURS) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * Coerce and bound an untrusted body.
 *
 * Deliberately forgiving about everything except make: the intake form treats
 * every field as free text (the catalog suggests, it never validates) and an
 * inventory that rejected an uncatalogued machine would be worse than useless
 * in a yard full of them. `make` is required only so a list row has something
 * to name it by.
 */
export function validateMachineInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send the machine's details as an object." };
  }
  const raw = body as Record<string, unknown>;

  const make = text(raw.make, MAX_IDENTITY_LENGTH);
  if (!make) return { ok: false, error: "Enter the machine's make." };

  const year = text(raw.year, 4);
  if (year && !/^\d{4}$/.test(year)) {
    return { ok: false, error: "Enter the year as four digits, or leave it blank." };
  }

  const hours = coerceHours(raw.currentHours);
  if (!hours.ok) {
    return { ok: false, error: "Enter current hours as a number between 0 and 1,000,000." };
  }

  return {
    ok: true,
    value: {
      year,
      make,
      model: text(raw.model, MAX_IDENTITY_LENGTH),
      machineType: text(raw.machineType, MAX_IDENTITY_LENGTH),
      serialPin: text(raw.serialPin, MAX_PIN_LENGTH),
      currentHours: hours.value,
      maintenance: text(raw.maintenance, MAX_MAINTENANCE_LENGTH),
      label: text(raw.label, MAX_IDENTITY_LENGTH),
    },
  };
}

export type ServiceEntryInput = {
  /** YYYY-MM-DD, the day the work was done. */
  performedOn: string;
  note: string;
};

export type ServiceEntry = ServiceEntryInput & {
  id: string;
  createdAt: string;
};

export type ServiceValidationResult =
  | { ok: true; value: ServiceEntryInput }
  | { ok: false; error: string };

/** A dated maintenance entry: the date is the point, so it is required. */
export function validateServiceEntry(body: unknown): ServiceValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send the service entry as an object." };
  }
  const raw = body as Record<string, unknown>;

  const performedOn = text(raw.performedOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) {
    return { ok: false, error: "Enter the service date as YYYY-MM-DD." };
  }

  const note = text(raw.note, MAX_SERVICE_NOTE_LENGTH);
  if (!note) return { ok: false, error: "Describe the work that was done." };

  return { ok: true, value: { performedOn, note } };
}
