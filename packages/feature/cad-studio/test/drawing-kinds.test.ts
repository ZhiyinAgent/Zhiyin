/**
 * A drawing's angles, chamfers, hole callouts, ordinates and parts list, and
 * a build's parts list file, as they are checked and shown before anyone is
 * asked: what each kind takes, what is refused, and the approval's words.
 */

import { describe, expect, it } from "vitest";
import { callRows, writtenWords } from "../src/call-rows.js";
import { drawingOf, type DrawingSpec } from "../src/drawing-request.js";

const refused = (args: Record<string, unknown>) => {
  const checked = drawingOf(args);
  return checked.ok ? undefined : checked.reason;
};
const one = (dimension: Record<string, unknown>) =>
  refused({ views: [{ view: "front" }], dimensions: [dimension] });

describe("a drawing asked for no dimensions", () => {
  it("is handed on with none named when they are left out, so the harness gives the overall sizes, and with an empty list when none is asked", () => {
    const left = drawingOf({ views: [{ view: "front" }] });
    const none = drawingOf({ views: [{ view: "front" }], dimensions: [] });

    expect(left.ok && "dimensions" in left.spec).toBe(false);
    expect(none.ok && none.spec["dimensions"]).toEqual([]);
  });
});

describe("a drawing's further dimension kinds", () => {
  it("takes an angle, a chamfer, a hole callout and an ordinate as asked", () => {
    const checked = drawingOf({
      views: [{ view: "front" }, { view: "top" }],
      dimensions: [
        { view: "front", kind: "angle", from: [0, 0, 0], to: [1, 0, 1] },
        { view: "front", kind: "chamfer", at: [0, 0, 0], expect: 1 },
        { view: "top", kind: "hole_callout", at: [0, 0, 0], all: true },
        { view: "top", kind: "hole_callout", expect: 6.8 },
        {
          view: "top",
          kind: "ordinate",
          from: [0, 0, 0],
          to: [5, 0, 0],
          direction: "horizontal",
        },
      ],
    });

    expect(checked.ok).toBe(true);
  });

  it("refuses each kind given what it does not take or short of what it needs, saying what it takes", () => {
    expect(one({ view: "front", kind: "angle", from: [0, 0, 0] })).toBe(
      "dimensions[0] is an angle: from and to are points [x, y, z] in mm, each on one of the two edges it is between.",
    );
    expect(
      one({
        view: "front",
        kind: "angle",
        from: [0, 0, 0],
        to: [1, 0, 0],
        at: [0, 0, 0],
      }),
    ).toBe("dimensions[0] is an angle; it takes no at.");
    expect(one({ view: "front", kind: "chamfer", from: [0, 0, 0] })).toBe(
      "dimensions[0] is a chamfer; it takes no from.",
    );
    expect(one({ view: "front", kind: "hole_callout" })).toBe(
      "dimensions[0] is a hole callout: at is a point [x, y, z] in mm on the hole's circle or at its centre, or expect is its drilled diameter, which finds the hole of that size.",
    );
    expect(
      one({ view: "front", kind: "ordinate", from: [0, 0, 0], to: [1, 0, 0] }),
    ).toBe(
      "dimensions[0] is an ordinate: direction is horizontal for the distance across from its datum, or vertical for the distance up.",
    );
    expect(one({ view: "front", kind: "taper" })).toBe(
      "dimensions[0].kind is length, overall, diameter, radius, angle, chamfer, hole_callout or ordinate.",
    );
  });
});

describe("a drawing's parts list", () => {
  it("takes a parts list with its balloons' view and its materials", () => {
    const checked = drawingOf({
      views: [{ view: "front" }, { view: "iso" }],
      parts_list: true,
      balloons: "front",
      materials: { Plate: "aluminium", "/Screw.*/": "steel" },
    });

    expect(checked.ok && checked.spec).toMatchObject({
      parts_list: true,
      balloons: "front",
      materials: { Plate: "aluminium", "/Screw.*/": "steel" },
    });
  });

  it("refuses balloons or materials without a parts list, balloons on a view it does not have, materials not as text, and a parts list of the scene", () => {
    expect(refused({ balloons: "iso" })).toBe(
      "balloons names the view a parts list's balloons go on; give parts_list: true too.",
    );
    expect(refused({ materials: { Plate: "steel" } })).toBe(
      "materials gives a parts list's materials; give parts_list: true too.",
    );
    expect(
      refused({
        views: [{ view: "front" }],
        parts_list: true,
        balloons: "iso",
      }),
    ).toBe(
      "balloons are on the iso view, which the drawing does not have; it has front.",
    );
    expect(refused({ parts_list: true, materials: { Plate: 7.85 } })).toBe(
      'materials gives each part, by its name or a /pattern/, its material as text of at most 80 characters, as { "Plate": "aluminium", "/Screw.*/": "steel" }.',
    );
    expect(refused({ scene: true, parts_list: true })).toBe(
      "A parts list lists a script's parts; a drawing of the 3D scene has none.",
    );
  });

  it("is shown for approval with its materials and the view it is ballooned on", () => {
    const rows = callRows({
      code: "",
      arguments: [],
      drawing: {
        parts_list: true,
        balloons: "front",
        materials: { Plate: "aluminium" },
      } as unknown as DrawingSpec,
    });

    expect(rows.find((row) => row.name === "Parts list")?.value).toBe(
      "a parts list of the parts shown, each different part once with how many, Plate in aluminium, ballooned on the front view, or another where it does not show",
    );
  });
});

describe("a build's parts list file", () => {
  it("is shown for approval as what it lists, with the materials given", () => {
    expect(
      writtenWords({
        kind: "bom",
        relative: "shop/parts.csv",
        parts: ["Plate", "Screw 1"],
        materials: { Plate: "aluminium" },
      }),
    ).toBe(
      "A parts list of Plate, Screw 1, each different part once with how many, Plate in aluminium, in CSV.",
    );
    expect(writtenWords({ kind: "bom", relative: "shop/parts.csv" })).toBe(
      "A parts list of the parts shown, each different part once with how many, no materials given, in CSV.",
    );
  });
});
