import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseLine } from "../src/parse-csv.js";

test("a comma inside a quoted field does not split it", () => {
  assert.deepEqual(parseLine('"Paris, France",2024,1500'), [
    "Paris, France",
    "2024",
    "1500",
  ]);
});

test("a doubled quote inside a quoted field is one quote", () => {
  assert.deepEqual(parseLine('"She said ""hello""",2024'), [
    'She said "hello"',
    "2024",
  ]);
});

test("spaces inside a quoted field are part of the value", () => {
  assert.deepEqual(parseLine('"  padded  ",x'), ["  padded  ", "x"]);
});

test("an empty quoted field is an empty field", () => {
  assert.deepEqual(parseLine('a,"",c'), ["a", "", "c"]);
});

test("a quoted number at the end of a row keeps its comma", () => {
  assert.deepEqual(parseLine('2024,"1,500"'), ["2024", "1,500"]);
});

test("a plain row still splits the way it always did", () => {
  assert.deepEqual(parseCsv("north,2024,1500\nsouth,2024,\n"), [
    ["north", "2024", "1500"],
    ["south", "2024", ""],
  ]);
});
