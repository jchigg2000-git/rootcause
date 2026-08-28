import assert from "node:assert/strict";
import test from "node:test";

import {
  MACHINE_TYPES,
  MANUFACTURERS,
  MODELS_BY_MAKE,
  filterSuggestions,
  machineTypeForModel,
  modelsForMake,
  parseModelYear,
} from "../app/lib/equipment-catalog.ts";

test("no make's model-suggestion list has duplicate entries", () => {
  for (const [make, models] of Object.entries(MODELS_BY_MAKE)) {
    assert.equal(
      models.length,
      new Set(models).size,
      `${make} has a duplicate model in its datalist suggestions`,
    );
  }
});

test("a model number shared across machine types still resolves a type", () => {
  // John Deere's "670G" is both an excavator and a motor grader — deduping
  // the datalist suggestions must not break machine-type inference for it.
  assert.equal(machineTypeForModel("John Deere", "670G"), "Excavator");
});

test("model suggestions narrow to what existed in the given year", () => {
  // Caterpillar's D-series skid steers launched in 2015 — a 2005 machine
  // shouldn't suggest a model that didn't exist yet.
  const in2020 = modelsForMake("Caterpillar", 2020);
  const in2005 = modelsForMake("Caterpillar", 2005);
  assert.ok(in2020.includes("226D"));
  assert.ok(!in2005.includes("226D"));
  // A base model carried across generations under one name stays suggested
  // for an old machine, since our catalog doesn't track sub-generations.
  assert.ok(in2005.includes("320"));
});

test("an unparsed or missing year does not narrow the list", () => {
  const unfiltered = modelsForMake("Caterpillar");
  assert.deepEqual(unfiltered.sort(), MODELS_BY_MAKE.Caterpillar.slice().sort());
});

test("only a complete, plausible year narrows the model list", () => {
  // The bug this fixes: three views passed a raw Number(year), so a
  // half-typed "201" narrowed the list to nothing mid-keystroke.
  assert.equal(parseModelYear("201"), undefined);
  assert.equal(parseModelYear(""), undefined);
  assert.equal(parseModelYear("2014"), 2014);
  assert.equal(parseModelYear(" 2014 "), 2014);
  assert.equal(parseModelYear("1899"), undefined);
  const nextYear = new Date().getFullYear() + 1;
  assert.equal(parseModelYear(String(nextYear)), nextYear);
  assert.equal(parseModelYear(String(nextYear + 1)), undefined);
});

test("suggestions match on a substring, not just a prefix", () => {
  // The catalog is full of compounds whose distinguishing word comes last, so
  // an operator types "loader", never "wheel l".
  const loaders = filterSuggestions(MACHINE_TYPES, "loader");
  assert.ok(loaders.includes("Wheel loader"));
  assert.ok(loaders.includes("Compact track loader"));
  // Word-start beats interior: "Wheel loader" has "loader" at a word boundary,
  // as does "Compact track loader" — both rank above nothing, and catalog
  // order breaks the tie, so the assertion is that neither is dropped.
  assert.ok(filterSuggestions(MANUFACTURERS, "holland").includes("New Holland"));
});

test("a prefix match outranks an interior one", () => {
  const ranked = filterSuggestions(MACHINE_TYPES, "ex");
  assert.equal(ranked[0], "Excavator");
  assert.ok(ranked.indexOf("Excavator") < ranked.indexOf("Mini excavator"));
});

test("punctuation and spacing never keep a suggestion from matching", () => {
  // Tier one normalizes; tier two squashes everything non-alphanumeric, which
  // is what lets a run-together query reach a spaced model name.
  assert.ok(filterSuggestions(MANUFACTURERS, "link belt").includes("Link-Belt"));
  assert.ok(filterSuggestions(MANUFACTURERS, "linkbelt").includes("Link-Belt"));
  assert.ok(filterSuggestions(["350G LC", "344K"], "350glc").includes("350G LC"));
});

test("an empty query lists everything, a miss lists nothing", () => {
  assert.deepEqual(filterSuggestions(MACHINE_TYPES, ""), [...MACHINE_TYPES]);
  assert.deepEqual(filterSuggestions(MACHINE_TYPES, "   "), [...MACHINE_TYPES]);
  assert.deepEqual(filterSuggestions(MACHINE_TYPES, "zzz"), []);
});
