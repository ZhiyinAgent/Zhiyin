import { describe, expect, it } from "vitest";
import { byKind, oneOf } from "../src/index.js";

type Light = "red" | "amber" | "green";
type Shape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly side: number };

describe("a value checked against the names a type gives", () => {
  const light = oneOf<Light>({ red: true, amber: true, green: true });

  it("is accepted when it is one of them", () => {
    for (const value of ["red", "amber", "green"])
      expect(light(value)).toBe(true);
  });

  it("is refused when it is anything else, a name every object carries included", () => {
    for (const value of [
      "blue",
      "",
      "toString",
      "constructor",
      undefined,
      null,
      0,
      ["red"],
      { red: true },
    ])
      expect(light(value)).toBe(false);
  });

  it("does not compile with a name left out, one the type lacks, or no type given", () => {
    // @ts-expect-error amber and green are left out.
    oneOf<Light>({ red: true });
    // @ts-expect-error blue is not a name the type has.
    oneOf<Light>({ red: true, amber: true, green: true, blue: true });
    // @ts-expect-error the type is not given.
    oneOf({ red: true });
  });
});

describe("a record checked by its kind", () => {
  const shape = byKind<Shape["kind"]>({
    circle: (value) => typeof value.radius === "number",
    square: (value) => typeof value.side === "number",
  });

  it("is accepted in the shape its own kind has", () => {
    expect(shape({ kind: "circle", radius: 2 })).toBe(true);
    expect(shape({ kind: "square", side: 3 })).toBe(true);
  });

  it("is refused in another kind's shape, of a kind nobody named, or when it is no record", () => {
    for (const value of [
      { kind: "circle", side: 3 },
      { kind: "triangle", side: 3 },
      { kind: "toString" },
      { radius: 2 },
      [{ kind: "circle", radius: 2 }],
      "circle",
      null,
      undefined,
    ])
      expect(shape(value)).toBe(false);
  });

  it("does not compile with a kind left out, one the type lacks, or no type given", () => {
    // @ts-expect-error the type is not given.
    byKind({ circle: () => true });
    // @ts-expect-error square is left out.
    byKind<Shape["kind"]>({ circle: () => true });
    byKind<Shape["kind"]>({
      circle: () => true,
      square: () => true,
      // @ts-expect-error triangle is not a kind the type has.
      triangle: () => true,
    });
  });
});
