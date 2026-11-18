/**
 * A decal call as it is prepared before Blender is reached: the picture and
 * font it reads are checked in the workspace and sent by their absolute
 * paths, the approval says in words what goes where, and a call missing what
 * it cannot run without is refused naming it.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { prepareDecal } from "../src/decal-calls.js";

describe("preparing a decal", () => {
  const folders = new TemporaryFolders();
  let root: string;
  const place = () => ({ root, scene: "scene.blend", protect: [] });

  beforeAll(async () => {
    root = await folders.make("zhiyin-decal-calls-");
    await mkdir(join(root, "art"));
    await writeFile(join(root, "art", "logo.png"), "picture");
  });
  afterAll(() => folders.removeAll());

  it("reads the picture from the workspace, sends its whole path and says where it goes", async () => {
    const prepared = await prepareDecal(
      {
        object: "Crate",
        picture: "art/logo.png",
        at: [0.4, -0.5, 0.5],
        direction: [0, 1, 0],
        size: 0.4,
        rotation: 15,
        affects: ["color", "roughness"],
        roughness: 0.2,
      },
      place(),
    );

    expect("reason" in prepared).toBe(false);
    if ("reason" in prepared) return;
    expect(prepared.command).toBe("decal");
    expect(prepared.args["picture"]).toBe(join(root, "art", "logo.png"));
    expect(prepared.rows.map(({ name, value }) => `${name}: ${value}`)).toEqual(
      [
        "On: Crate",
        "Reads: art/logo.png",
        "Kind: projected onto the surface",
        "Where: cast along (0, 1, 0) through (400, -500, 500 mm), turned 15°",
        "Size: 400 mm wide",
        "Changes: colour, roughness 0.2",
      ],
    );
    expect(prepared.changes).toEqual([
      expect.objectContaining({ path: "scene.blend", change: "updated" }),
    ]);
  });

  it("says a strip's line and pattern", async () => {
    const prepared = await prepareDecal(
      {
        object: "Bag",
        kind: "strip",
        along: { sharp_angle: 30 },
        width: 0.002,
        pattern: "stitch",
        pitch: 0.006,
        raised: 0.0005,
        color: "#f0e0c0",
      },
      place(),
    );

    if ("reason" in prepared) throw new Error(prepared.reason);
    expect(prepared.rows.map(({ name, value }) => `${name}: ${value}`)).toEqual(
      [
        "On: Bag",
        "Along: its edges sharper than 30°",
        "Strip: 2 mm wide, stitch pattern, every 6 mm, raised 0.5 mm",
      ],
    );
  });

  it("says a normal decal's shape, a wrapped label's stock and a groove's depth", async () => {
    const rows = async (args: Record<string, unknown>) => {
      const prepared = await prepareDecal(args, place());
      if ("reason" in prepared) throw new Error(prepared.reason);
      return prepared.rows.map(({ name, value }) => `${name}: ${value}`);
    };

    expect(
      await rows({
        object: "Panel",
        kind: "normal",
        shape: "vent",
        count: 8,
        at: [0, 0, 1],
        size: 0.1,
        relief: -0.003,
      }),
    ).toEqual([
      "On: Panel",
      "Kind: relief by shading alone, projected onto the surface",
      "Draws: vent, 8 of its parts, pressed 3 mm in",
      "Where: on the surface nearest (0, 0, 1 m)",
      "Size: 100 mm wide",
    ]);
    expect(
      await rows({
        object: "Bottle",
        kind: "wrap",
        picture: "art/logo.png",
        at: [0, -0.05, 0.1],
        size: 0.08,
        label: "clear",
        white_ink: false,
        roughness: 0.1,
      }),
    ).toEqual([
      "On: Bottle",
      "Reads: art/logo.png",
      "Kind: a label wrapped round its z axis",
      "Label: clear film, ink without white under it, roughness 0.1",
      "Where: its middle on the surface outside (0, -50, 100 mm)",
      "Size: 80 mm wide",
    ]);
    expect(
      await rows({
        object: "Case",
        kind: "strip",
        along: { curve: "Seam" },
        width: 0.001,
        pattern: "groove",
        relief: -0.0005,
      }),
    ).toEqual([
      "On: Case",
      "Along: the curve Seam",
      "Strip: 1 mm wide, a groove, pressed 0.5 mm in, by shading alone",
    ]);
  });

  it("refuses a normal decal without its shape or picture, a picture's without its relief, and a shape strip without its shape", async () => {
    const neither = await prepareDecal(
      { object: "Panel", kind: "normal", at: [0, 0, 1], size: 0.1 },
      place(),
    );
    const flat = await prepareDecal(
      {
        object: "Panel",
        kind: "normal",
        picture: "art/logo.png",
        at: [0, 0, 1],
        size: 0.1,
      },
      place(),
    );
    const shapeless = await prepareDecal(
      {
        object: "Panel",
        kind: "strip",
        along: { seams: true },
        width: 0.004,
        pattern: "shape",
      },
      place(),
    );

    expect(neither).toMatchObject({
      reason: "Give exactly one of shape and picture.",
    });
    expect(flat).toMatchObject({ reason: "This call is missing relief." });
    expect(shapeless).toMatchObject({
      reason: "This call is missing shape.",
    });
  });

  it("refuses a picture that is not in the workspace before Blender is reached", async () => {
    const missing = await prepareDecal(
      { object: "Crate", picture: "art/none.png", at: [0, 0, 0], size: 0.1 },
      place(),
    );
    const outside = await prepareDecal(
      { object: "Crate", picture: "../logo.png", at: [0, 0, 0], size: 0.1 },
      place(),
    );

    expect(missing).toMatchObject({
      reason: "art/none.png does not exist in the workspace.",
      correctable: true,
    });
    expect(outside).toMatchObject({
      reason: "../logo.png is outside the workspace.",
      correctable: false,
    });
  });

  it("refuses a call missing what it cannot run without, naming it", async () => {
    const both = await prepareDecal(
      {
        object: "Crate",
        picture: "art/logo.png",
        text: "Hi",
        at: [0, 0, 0],
        size: 0.1,
      },
      place(),
    );
    const unsized = await prepareDecal(
      { object: "Crate", text: "Hi", at: [0, 0, 0] },
      place(),
    );
    const valueless = await prepareDecal(
      {
        object: "Crate",
        text: "Hi",
        at: [0, 0, 0],
        size: 0.1,
        affects: ["roughness", "normal"],
      },
      place(),
    );
    const lineless = await prepareDecal(
      { object: "Crate", kind: "strip", pattern: "picture" },
      place(),
    );

    expect(both).toMatchObject({
      reason: "Give exactly one of picture and text.",
    });
    expect(unsized).toMatchObject({ reason: "This call is missing size." });
    expect(valueless).toMatchObject({
      reason: "This call is missing roughness and relief.",
    });
    expect(lineless).toMatchObject({
      reason: "This call is missing along, width and picture.",
    });
  });
});
