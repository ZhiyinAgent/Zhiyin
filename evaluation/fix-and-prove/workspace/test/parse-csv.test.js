import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseLine } from "../src/parse-csv.js";

test("splits a plain row into fields", () => {
  assert.deepEqual(parseLine("north,2024,1500"), ["north", "2024", "1500"]);
});

test("keeps an empty field at the end of a row", () => {
  assert.deepEqual(parseLine("north,2024,"), ["north", "2024", ""]);
});

test("removes the quotes around a quoted field", () => {
  assert.deepEqual(parseLine('"north",2024'), ["north", "2024"]);
});

test("reads a whole file without a trailing empty row", () => {
  assert.deepEqual(parseCsv("a,b\nc,d\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});
