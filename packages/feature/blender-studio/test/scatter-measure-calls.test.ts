/**
 * How a scatter and a measure read for approval, and what each is refused
 * for before Blender is asked: a scatter is a change to the open scene, by a
 * count or a density, never both; a measure only reads it, between two
 * objects, from one along an axis, or from one to everything else.
 */

import { describe, expect, it } from "vitest";
import { prepareMeasure } from "../src/measure-calls.js";
import { prepareScatter } from "../src/scatter-calls.js";

const place = { root: "C:/work", scene: "garden.blend", protect: [] };
const rowsOf = (prepared: unknown) =>
  (prepared as { rows: { name: string; value: string }[] }).rows.map(
    ({ name, value }) => [name, value],
  );

describe("a scatter", () => {
  it("reads as what it scatters, over what, how many, where, how far apart and how each is set", async () => {
    const prepared = await prepareScatter(
      {
        items: ["Rock", "Pebble"],
        onto: "Ground",
        count: 40,
        where: {
          material: "Grass",
          vertex_group: "Meadow",
          slope: [0, 10],
          height: [1, 2],
          away_from: { objects: ["House"], distance: 1 },
          near: { objects: ["Well"], distance: 1.5 },
        },
        keep_clear: ["Path"],
        spacing: 0.05,
        align: "surface",
        jitter: { seed: 3, turn: 90, scale: [0.8, 1.2] },
        as: "instances",
      },
      place,
    );

    expect(prepared).toMatchObject({
      command: "scatter",
      access: "change",
      target: "garden.blend",
      changes: [{ path: "garden.blend", change: "updated" }],
    });
    expect(rowsOf(prepared)).toEqual([
      ["Scatter", "40 instances of Rock, Pebble"],
      ["Over", "Ground"],
      [
        "Where",
        "on material Grass; in vertex group Meadow; sloping 0° to 10°; from 1 m to 2 m high; at least 1 m from House; within 1.5 m of Well",
      ],
      ["Kept clear of", "Path"],
      ["Spacing", "footprints at least 50 mm apart"],
      [
        "Set",
        "turned to the surface, up to 90° at random, scaled 0.8 to 1.2, seed 3",
      ],
    ]);
  });

  it("reads a density, and by default copies upright, turned at random, footprints not touching", async () => {
    const prepared = await prepareScatter(
      { items: ["Fern"], onto: "Ground", density: 0.5 },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Scatter", "0.5 per m² as linked copies of Fern"],
      ["Over", "Ground"],
      ["Spacing", "footprints not touching"],
      ["Set", "upright, up to 360° at random, seed 0"],
    ]);
  });

  it("reads the items' weights and how far each copy is raised or sunk", async () => {
    const prepared = await prepareScatter(
      {
        items: ["Rock A", "Rock B", "Rock C"],
        onto: "Ground",
        count: 30,
        weights: { "Rock A": 3, "Rock B": 0.5 },
        offset: 0.01,
        sink: [0.02, 0.05],
      },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Scatter", "30 linked copies of Rock A, Rock B, Rock C"],
      ["Weights", "Rock A 3, Rock B 0.5, any other item 1"],
      ["Over", "Ground"],
      ["Spacing", "footprints not touching"],
      [
        "Set",
        "upright, raised 10 mm, sunk 20 mm to 50 mm into the surface, up to 360° at random, seed 0",
      ],
    ]);
  });

  it("is refused with neither a count nor a density, or with both", async () => {
    const neither = await prepareScatter(
      { items: ["Fern"], onto: "Ground" },
      place,
    );
    const both = await prepareScatter(
      { items: ["Fern"], onto: "Ground", count: 4, density: 1 },
      place,
    );

    for (const refused of [neither, both])
      expect(refused).toEqual({
        reason: "Give exactly one of count and density.",
        correctable: true,
      });
  });
});

describe("a measure", () => {
  it("only reads the scene, and reads as what it measures", async () => {
    const asked = [
      [{ between: ["Box A", "Box B"] }, "the gap between Box A and Box B"],
      [
        { between: ["Box A", "Box B"], kind: "centres" },
        "the distance between the centres of Box A and Box B",
      ],
      [
        { from: "Shelf", along: "-z" },
        "what lies along -z from Shelf, and how far",
      ],
      [
        { from: "Chair", kind: "clearance" },
        "how near everything else comes to Chair",
      ],
    ] as const;

    for (const [args, said] of asked) {
      const prepared = await prepareMeasure(args, place);
      expect(prepared).toMatchObject({
        command: "measure",
        access: "read",
        target: "garden.blend",
      });
      expect(rowsOf(prepared)).toEqual([["Measure", said]]);
    }
  });

  it("is refused without exactly one of two objects and one to measure from", async () => {
    const neither = await prepareMeasure({ kind: "gap" }, place);
    const both = await prepareMeasure(
      { between: ["Box A", "Box B"], from: "Shelf", along: "x" },
      place,
    );

    for (const refused of [neither, both])
      expect(refused).toEqual({
        reason: "Give exactly one of between and from.",
        correctable: true,
      });
  });

  it("is refused a clearance without an object to measure from, and a gap from one without an axis", async () => {
    const clearance = await prepareMeasure(
      { between: ["Box A", "Box B"], kind: "clearance" },
      place,
    );
    const along = await prepareMeasure({ from: "Shelf" }, place);
    const centres = await prepareMeasure(
      { from: "Shelf", kind: "centres" },
      place,
    );

    expect(clearance).toMatchObject({
      reason: "This call is missing from.",
      correctable: true,
    });
    expect(along).toMatchObject({
      reason: "This call is missing along.",
      correctable: true,
    });
    expect(centres).toMatchObject({
      reason: "This call is missing between.",
      correctable: true,
    });
  });
});
