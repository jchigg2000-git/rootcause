import assert from "node:assert/strict";
import test from "node:test";

import { MAX_FIELD_LENGTH, MAX_PIN_LENGTH, validateRequest } from "../app/api/spec-lookup/contract.ts";
import { SPEC_SECTIONS, parseSpecJson } from "../app/api/spec-lookup/schema.ts";

test("a PIN is required and bounded, other fields stay optional", () => {
  assert.match(validateRequest({ pin: "" }), /Enter a product identification number/);
  assert.match(validateRequest({ pin: "   " }), /Enter a product identification number/);
  assert.equal(validateRequest({ pin: "1FF350GXKFF123456" }), null);
  assert.match(
    validateRequest({ pin: "X".repeat(MAX_PIN_LENGTH + 1) }),
    /longer than any real serial number/,
  );
  assert.equal(
    validateRequest({ pin: "1FF350GXKFF123456", year: "2014", make: "John Deere", model: "350G LC" }),
    null,
  );
  assert.match(
    validateRequest({ pin: "1FF350GXKFF123456", make: "X".repeat(MAX_FIELD_LENGTH + 1) }),
    /too long/,
  );
});

const SPEC_JSON = JSON.stringify({
  title: "2014 John Deere 350G LC",
  lede: "PIN pattern matches the Deere 350G LC excavator family.",
  metaChips: ["PIN: 1FF350GXKFF123456", "Confidence: Medium"],
  machine: { year: "2014", make: "John Deere", model: "350G LC", machineType: "Excavator", confidence: "medium" },
  sections: [
    { id: "identity", blocks: [{ type: "paragraph", text: "Matched from the WMI prefix.", label: "REASONABLE INFERENCE" }] },
    { id: "capacities", blocks: [{ type: "table", columns: ["Fluid", "Capacity"], rows: [["Hydraulic system", "56 gal"]] }] },
    { id: "gaps", blocks: [{ type: "list", items: ["Confirm engine option via dealer lookup"], style: "bullet" }] },
  ],
  disclaimer: "General reference only.",
});

test("spec JSON is parsed and coerced into the template contract", () => {
  const data = parseSpecJson("```json\n" + SPEC_JSON + "\n```", "2026-08-05");
  assert.ok(data);
  assert.equal(data.title, "2014 John Deere 350G LC");
  // Loose casing from the model is normalized to the qualitative vocabulary.
  assert.equal(data.machine.confidence, "Medium");
  assert.equal(data.sections.identity[0].type, "paragraph");
  assert.equal(data.sections.capacities[0].type, "table");
  assert.equal(data.generatedOn, "2026-08-05");
  assert.equal(parseSpecJson("no json here", "2026-08-05"), null);
});

test("every fixed section id survives, and unknown sections are dropped", () => {
  const data = parseSpecJson(SPEC_JSON, "2026-08-05");
  SPEC_SECTIONS.forEach((section) => {
    assert.ok(section.id in data.sections === (section.id === "identity" || section.id === "capacities" || section.id === "gaps"));
  });
});

test("an invented evidence label is dropped rather than kept", () => {
  const hostile = JSON.stringify({
    title: "x",
    lede: "",
    metaChips: [],
    machine: { year: "", make: "", model: "", machineType: "", confidence: "" },
    sections: [{ id: "identity", blocks: [{ type: "paragraph", text: "hi", label: "NOT A REAL LABEL" }] }],
    disclaimer: "",
  });
  const data = parseSpecJson(hostile, "2026-08-05");
  assert.equal(data.sections.identity[0].label, undefined);
});
