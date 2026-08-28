import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HOURS,
  MAX_IDENTITY_LENGTH,
  MAX_PIN_LENGTH,
  MAX_SERVICE_NOTE_LENGTH,
  coerceHours,
  validateMachineInput,
  validateServiceEntry,
} from "../app/api/inventory/contract.ts";

test("make is the only required field, and every field is bounded", () => {
  assert.match(validateMachineInput({}).error, /Enter the machine's make/);
  assert.match(validateMachineInput({ make: "   " }).error, /Enter the machine's make/);
  assert.match(validateMachineInput("John Deere").error, /as an object/);

  // Everything else is optional: the catalog suggests, it never constrains.
  const bare = validateMachineInput({ make: "  John Deere  " });
  assert.equal(bare.ok, true);
  assert.deepEqual(bare.value, {
    year: "",
    make: "John Deere",
    model: "",
    machineType: "",
    serialPin: "",
    currentHours: null,
    maintenance: "",
    label: "",
  });

  const long = validateMachineInput({
    make: "X".repeat(MAX_IDENTITY_LENGTH + 20),
    serialPin: "P".repeat(MAX_PIN_LENGTH + 20),
    label: "L".repeat(MAX_IDENTITY_LENGTH + 20),
  });
  assert.equal(long.value.make.length, MAX_IDENTITY_LENGTH);
  assert.equal(long.value.serialPin.length, MAX_PIN_LENGTH);
  assert.equal(long.value.label.length, MAX_IDENTITY_LENGTH);
});

test("zero hours is a reading; blank hours is not recorded", () => {
  // The distinction the whole field turns on: Number("") === 0, so an empty
  // input coerced through the number path would silently record a machine
  // fresh off the truck.
  assert.equal(validateMachineInput({ make: "Deere", currentHours: "" }).value.currentHours, null);
  assert.equal(validateMachineInput({ make: "Deere", currentHours: "   " }).value.currentHours, null);
  assert.equal(validateMachineInput({ make: "Deere" }).value.currentHours, null);
  assert.equal(validateMachineInput({ make: "Deere", currentHours: 0 }).value.currentHours, 0);
  assert.equal(validateMachineInput({ make: "Deere", currentHours: "0" }).value.currentHours, 0);

  // Operators type hour meters with separators and tenths.
  assert.equal(validateMachineInput({ make: "Deere", currentHours: "4,512.5" }).value.currentHours, 4512.5);

  assert.match(
    validateMachineInput({ make: "Deere", currentHours: "-1" }).error,
    /between 0 and 1,000,000/,
  );
  assert.match(
    validateMachineInput({ make: "Deere", currentHours: MAX_HOURS + 1 }).error,
    /between 0 and 1,000,000/,
  );
  assert.match(
    validateMachineInput({ make: "Deere", currentHours: "about four thousand" }).error,
    /between 0 and 1,000,000/,
  );
});

test("year is four digits or blank, never a partial", () => {
  assert.equal(validateMachineInput({ make: "Deere", year: "" }).value.year, "");
  assert.equal(validateMachineInput({ make: "Deere", year: "2014" }).value.year, "2014");
  assert.match(validateMachineInput({ make: "Deere", year: "14" }).error, /four digits/);
  assert.match(validateMachineInput({ make: "Deere", year: "20x4" }).error, /four digits/);
});

test("coerceHours stands alone for auto-save: blank is null, junk refuses", () => {
  // Auto-save runs the diagnose form's string `hours` through this directly;
  // the blank-vs-zero rule must hold there exactly as it does in the form.
  assert.deepEqual(coerceHours(""), { ok: true, value: null });
  assert.deepEqual(coerceHours(undefined), { ok: true, value: null });
  assert.deepEqual(coerceHours("6,850"), { ok: true, value: 6850 });
  assert.deepEqual(coerceHours(0), { ok: true, value: 0 });
  assert.deepEqual(coerceHours("a lot"), { ok: false });
  assert.deepEqual(coerceHours(-5), { ok: false });
});

test("the saved-machine picker round-trips hours without inventing a zero", () => {
  // Picking a machine fills the form with String(currentHours), and submitting
  // sends that string back through coerceHours. A machine with 0 recorded
  // hours must survive as 0, and one with none must stay null — the round trip
  // is where a `Number("") === 0` slip would silently record a zeroed meter.
  const intoForm = (currentHours) => (currentHours === null ? "" : String(currentHours));
  assert.deepEqual(coerceHours(intoForm(0)), { ok: true, value: 0 });
  assert.deepEqual(coerceHours(intoForm(null)), { ok: true, value: null });
  assert.deepEqual(coerceHours(intoForm(6850)), { ok: true, value: 6850 });
  assert.deepEqual(coerceHours(intoForm(1234.5)), { ok: true, value: 1234.5 });
});

test("a service entry needs a real date and a note, both bounded", () => {
  assert.match(validateServiceEntry(null).error, /as an object/);
  assert.match(validateServiceEntry({ note: "Oil change" }).error, /YYYY-MM-DD/);
  assert.match(validateServiceEntry({ performedOn: "yesterday", note: "x" }).error, /YYYY-MM-DD/);
  assert.match(validateServiceEntry({ performedOn: "2026-08-06", note: "  " }).error, /Describe/);

  const ok = validateServiceEntry({
    performedOn: "2026-08-06",
    note: ` ${"n".repeat(MAX_SERVICE_NOTE_LENGTH + 50)} `,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.performedOn, "2026-08-06");
  assert.equal(ok.value.note.length, MAX_SERVICE_NOTE_LENGTH);
});
