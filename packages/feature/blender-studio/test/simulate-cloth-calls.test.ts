/**
 * How blender_simulate's cloth and liquid read for approval: what is made
 * cloth, of what fabric, pinned, inflated, sewn and meeting what, and whether
 * it is kept where it rests; a liquid's preset, resolution, container,
 * sources and obstacles, and that its cache is kept outside the workspace.
 */

import { describe, expect, it } from "vitest";
import { prepareSimulate } from "../src/simulate-calls.js";

const place = { root: "C:/work", scene: "room.blend", protect: [] };
const rowsOf = (prepared: unknown) =>
  (prepared as { rows: { name: string; value: string }[] }).rows.map(
    ({ name, value }) => [name, value],
  );

describe("a cloth simulation", () => {
  it("reads as the cloth, its fabric, spacing, pins, pressure, seams, colliders and what is kept", async () => {
    const prepared = await prepareSimulate(
      {
        cloth: {
          object: "Cushion",
          fabric: "denim",
          subdivide_to: 0.02,
          pinned: { group: "Corners" },
          pressure: 5,
          sew: true,
          colliders: ["Sofa", "Floor"],
          drape: true,
        },
      },
      place,
    );

    expect(prepared).toMatchObject({
      command: "simulate",
      access: "change",
      target: "room.blend",
      changes: [{ path: "room.blend", change: "updated" }],
    });
    expect(rowsOf(prepared)).toEqual([
      ["Cloth", "Cushion, denim"],
      ["Subdivided to", "20 mm apart"],
      ["Pinned", "vertex group Corners"],
      ["Inflated", "by pressure 5"],
      ["Sewn", "its loose edges pulled shut"],
      ["Collides with", "Sofa, Floor"],
      ["Kept", "where it comes to rest, as its shape; the cloth removed"],
    ]);
  });

  it("reads a cloth pinned along an edge or at points, left to move, as cotton by default", async () => {
    const edge = await prepareSimulate(
      { cloth: { object: "Curtain", pinned: { edge: "top" } } },
      place,
    );
    const points = await prepareSimulate(
      { cloth: { object: "Flag", pinned: { points: [[0, 0, 2]] } } },
      place,
    );

    expect(rowsOf(edge)).toEqual([
      ["Cloth", "Curtain, cotton"],
      ["Pinned", "its top edge"],
      ["Kept", "as cloth moving over the scene's frames"],
    ]);
    expect(rowsOf(points)).toContainEqual([
      "Pinned",
      "the points nearest (0, 0, 2 m)",
    ]);
  });

  it("reads when pinned points let go, and a cloth that does not meet itself", async () => {
    const prepared = await prepareSimulate(
      {
        cloth: {
          object: "Tablecloth",
          pinned: { edge: "+x", release: 1.25 },
          self_collision: false,
        },
      },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Cloth", "Tablecloth, cotton"],
      ["Pinned", "its +x edge, let go at 1.25 s"],
      ["Self-collision", "off: it may pass through itself"],
      ["Kept", "as cloth moving over the scene's frames"],
    ]);
  });

  it("reads self-collision turned on when it is given", async () => {
    const prepared = await prepareSimulate(
      { cloth: { object: "Curtain", self_collision: true } },
      place,
    );

    expect(rowsOf(prepared)).toContainEqual(["Self-collision", "on"]);
  });
});

describe("a liquid simulation", () => {
  it("reads as its preset and resolution, the container, the sources, the obstacles and where its cache goes", async () => {
    const prepared = await prepareSimulate(
      {
        liquid: {
          container: "Glass",
          preset: "honey",
          sources: [{ object: "Blob" }, { object: "Tap", flow: "pour" }],
          obstacles: ["Spoon"],
          voxel: 0.002,
        },
      },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Liquid", "honey, baked over the scene's frames at voxels of 2 mm"],
      ["In", "Glass"],
      ["From", "Blob, its volume as liquid; Tap, pouring in"],
      ["Around", "Spoon"],
      [
        "Cache",
        "kept in this conversation's own folder, outside the workspace",
      ],
    ]);
  });

  it("reads as water at the draft resolution when neither is given", async () => {
    const prepared = await prepareSimulate(
      { liquid: { sources: [{ object: "Blob" }] } },
      place,
    );

    expect(rowsOf(prepared)[0]).toEqual([
      "Liquid",
      "water, baked over the scene's frames at resolution 32",
    ]);
  });
});
