/**
 * Shaping and adding calls as they are prepared, before Blender is asked: the
 * approval's rows for the newer kinds of step and primitive, the inputs a step
 * cannot run without, and the picture a displace step reads, checked in the
 * workspace.
 */

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { prepareAdd, prepareShape } from "../src/change-calls.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function place() {
  const root = await realpath(await folders.make("zhiyin-shape-calls-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  return { root: workspace, scene: "scene.blend", protect: [] };
}

const rowsOf = (prepared: unknown) =>
  (prepared as { rows: { name: string; value: string }[] }).rows;

describe("preparing a shaping call", () => {
  it("names each newer step in the approval in plain words", async () => {
    const prepared = await prepareShape(
      {
        object: "Ball",
        operations: [
          { kind: "remesh", method: "voxel", voxel_size: 0.005 },
          { kind: "remesh", method: "quadriflow", faces: 2000 },
          { kind: "hard_surface", width: 0.002, triangulate: true },
          { kind: "shrinkwrap", target: "Head", wrap: "project" },
          { kind: "displace", texture: "clouds", strength: 0.01 },
          { kind: "array", count: 8, around: { axis: "z" } },
          { kind: "boolean", collection: "Holes", solver: "auto" },
          { kind: "curve", depth: 0.01, caps: true },
        ],
      },
      await place(),
    );

    expect(rowsOf(prepared)).toEqual([
      expect.objectContaining({
        name: "Ball",
        value: [
          "Remesh by voxels of 5 mm",
          "Remesh as quads by QuadriFlow, about 2000 faces",
          "Hard-surface it: sharp edges, a 2 mm bevel hardening its normals, weighted normals, triangles",
          "Wrap it onto Head by project",
          "Displace it by clouds, 10 mm at full strength",
          "Repeat 8 times, round z",
          "Cut away every object of Holes, auto solver",
          "Set its curve's geometry: 10 mm deep, capped",
        ].join("\n"),
      }),
    ]);
  });

  it("refuses a step missing what its kind needs before anyone is asked", async () => {
    const prepared = await prepareShape(
      {
        object: "Ball",
        operations: [
          { kind: "array", fit: "length", offset: [0.1, 0, 0] },
          { kind: "array", count: 3 },
          { kind: "remesh" },
          { kind: "displace", texture: "image" },
          { kind: "shrinkwrap" },
          { kind: "hard_surface" },
          { kind: "boolean", collection: "Holes" },
        ],
      },
      await place(),
    );

    expect(prepared).toMatchObject({
      reason:
        "This call is missing operations[0].length, operations[1].offset, operations[2].voxel_size, operations[3].image, operations[4].target and operations[5].width.",
      correctable: true,
    });
  });

  it("sends the picture a displace step reads by its path in the workspace, and refuses one that is not there", async () => {
    const at = await place();
    await writeFile(join(at.root, "bumps.png"), "");

    const found = (await prepareShape(
      {
        object: "Ground",
        operations: [
          { kind: "displace", texture: "image", image: "bumps.png" },
        ],
      },
      at,
    )) as unknown as { args: { operations: { image: string }[] } };
    const missing = await prepareShape(
      {
        object: "Ground",
        operations: [{ kind: "displace", texture: "image", image: "gone.png" }],
      },
      at,
    );

    expect(found.args.operations[0]?.image).toBe(join(at.root, "bumps.png"));
    expect(missing).toMatchObject({
      reason: "gone.png does not exist in the workspace.",
      correctable: true,
    });
  });
});

describe("preparing an adding call", () => {
  it("names a primitive's counts and a tube's section, taper and ends in the approval", async () => {
    const prepared = await prepareAdd(
      {
        objects: [
          { name: "Ball", kind: "icosphere", subdivisions: 4 },
          { name: "Ring", kind: "circle", segments: 24, fill: "fan" },
          { name: "Floor", kind: "grid", segments: 10, rows: 4 },
          {
            name: "Duct",
            kind: "tube",
            points: [
              [0, 0, 0],
              [1, 0, 0],
            ],
            section: [
              [0, 0],
              [0.02, 0],
              [0.02, 0.01],
            ],
            taper: [1, 0.5],
            caps: false,
          },
        ],
      },
      await place(),
    );

    expect(rowsOf(prepared).map((row) => row.value)).toEqual([
      "icosphere, 4 subdivisions",
      "circle, 24 segments, filled: fan",
      "grid, 10 segments, 4 rows",
      "tube, a 3-cornered section along 2 points, tapering from 1 to 0.5 of its width, ends open",
    ]);
  });
});
