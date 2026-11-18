/**
 * Unwrapping and baking as a person approves them: what each call reads as,
 * and, for a bake, every map file it writes named before Blender runs, in the
 * workspace and nowhere else.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { prepareBake, prepareUnwrap } from "../src/uv-calls.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function place() {
  const root = await folders.make("zhiyin-uv-calls-");
  await writeFile(join(root, "scene.blend"), "");
  return { root, scene: "scene.blend", protect: [] };
}

const rowsOf = (prepared: unknown) =>
  Object.fromEntries(
    ((prepared as { rows: { name: string; value: string }[] }).rows ?? []).map(
      (row) => [row.name, row.value],
    ),
  );

describe("an unwrap as it is approved", () => {
  it("reads as the objects, the method, the seams and how the islands are packed", async () => {
    const prepared = await prepareUnwrap(
      {
        objects: ["Crate", "Lid"],
        method: "minimum_stretch",
        seams: { angle: 45, by: "material", hide: true },
        pack: { margin_px: 8, rotate: false },
        texel_density: { px_per_cm: 10, resolution: 2048 },
      },
      await place(),
    );

    expect(rowsOf(prepared)).toEqual({
      Unwrap: "Crate and Lid",
      Method: "minimum stretch, along seams",
      Seams:
        "edges sharper than 45° and between materials; cuts where the camera sees least",
      Packed: "8 px apart, unturned, at 10 px/cm of a 2048 px texture",
    });
  });

  it("leaves out the seams it was not given, and packing for a projection from the camera", async () => {
    const prepared = await prepareUnwrap(
      { objects: ["Wall"], method: "camera" },
      await place(),
    );

    expect(rowsOf(prepared)).toEqual({
      Unwrap: "Wall",
      Method: "projected from the camera",
    });
  });
});

describe("a bake as it is approved", () => {
  it("names every map it writes, by object and map, in the folder asked, and changes the scene", async () => {
    const where = await place();
    const prepared = await prepareBake(
      {
        objects: ["Crate", "Barrel"],
        maps: ["color", "normal"],
        resolution: 2048,
        from: ["Crate high"],
        folder: "maps/baked",
      },
      where,
    );

    expect("reason" in prepared).toBe(false);
    if ("reason" in prepared) return;
    expect(prepared.written?.map((file) => file.relative)).toEqual([
      "maps/baked/Crate_color.png",
      "maps/baked/Crate_normal.png",
      "maps/baked/Barrel_color.png",
      "maps/baked/Barrel_normal.png",
    ]);
    expect(prepared.changes?.map((change) => change.path)).toEqual([
      "maps/baked/Crate_color.png",
      "maps/baked/Crate_normal.png",
      "maps/baked/Barrel_color.png",
      "maps/baked/Barrel_normal.png",
      "scene.blend",
    ]);
    expect(prepared.args["files"]).toEqual({
      Crate: {
        color: join(where.root, "maps", "baked", "Crate_color.png"),
        normal: join(where.root, "maps", "baked", "Crate_normal.png"),
      },
      Barrel: {
        color: join(where.root, "maps", "baked", "Barrel_color.png"),
        normal: join(where.root, "maps", "baked", "Barrel_normal.png"),
      },
    });
    expect(prepared.picture).toBe(true);
    expect(rowsOf(prepared)).toEqual({
      Bake: "color and normal",
      Of: "Crate and Barrel",
      From: "Crate high, onto each",
      Size: "2048 × 2048 px, 16 px bleed",
      Writes:
        "maps/baked/Crate_color.png, maps/baked/Crate_normal.png, maps/baked/Barrel_color.png, maps/baked/Barrel_normal.png",
      Material: "each object gets a copy of its material drawn from the maps",
    });
  });

  it("writes into textures by default, says a map already there is replaced, and names a file safely after its object", async () => {
    const where = await place();
    await mkdir(join(where.root, "textures"));
    await writeFile(join(where.root, "textures", "Lamp_1_color.png"), "");

    const prepared = await prepareBake(
      { objects: ["Lamp:1"], maps: ["color"] },
      where,
    );

    if ("reason" in prepared) throw new Error(prepared.reason);
    expect(prepared.written).toEqual([
      expect.objectContaining({
        relative: "textures/Lamp_1_color.png",
        exists: true,
      }),
    ]);
    expect(rowsOf(prepared)["Size"]).toBe("1024 × 1024 px, 8 px bleed");
  });

  it("refuses a pattern for the objects, two objects whose files would share names, and a folder outside the workspace", async () => {
    const where = await place();

    const pattern = await prepareBake(
      { objects: ["/Crate.*/"], maps: ["color"] },
      where,
    );
    const clash = await prepareBake(
      { objects: ["Lamp:1", "Lamp?1"], maps: ["color"] },
      where,
    );
    const outside = await prepareBake(
      { objects: ["Crate"], maps: ["color"], folder: "../elsewhere" },
      where,
    );

    expect(pattern).toEqual({
      reason:
        "A bake names each object, as its files are named after it: /Crate.*/ is a pattern.",
      correctable: true,
    });
    expect(clash).toEqual({
      reason:
        "Lamp:1 and Lamp?1 would write maps of the same names: bake them in separate calls, each with its own folder.",
      correctable: true,
    });
    expect("reason" in outside).toBe(true);
  });
});
