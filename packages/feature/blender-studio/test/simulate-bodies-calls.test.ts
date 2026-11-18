/**
 * How a simulation's rigid bodies, world, bake and keeping read for
 * approval, and what is refused before Blender is asked: an active body is
 * weighed by exactly one of a density, a material and a mass.
 */

import { describe, expect, it } from "vitest";
import { prepareSimulate } from "../src/simulate-calls.js";

const place = { root: "C:/work", scene: "pile.blend", protect: [] };
const rowsOf = (prepared: unknown) =>
  (prepared as { rows: { name: string; value: string }[] }).rows.map(
    ({ name, value }) => [name, value],
  );

describe("a simulation's rigid bodies", () => {
  it("read as each group's role, shape and weighing, the world, the bake and what is kept", async () => {
    const prepared = await prepareSimulate(
      {
        rigid: [
          { objects: ["Box", "Crate"], material: "Steel", bounce: 0.2 },
          { objects: ["Ball"], density: 1100, shape: "sphere" },
          { objects: ["Bag"], mass: 5, friction: 0.9 },
          { objects: ["Floor"], role: "passive" },
          { objects: ["Paddle"], role: "animated" },
        ],
        world: { gravity: [0, 0, -1.62], substeps: 20, iterations: 15 },
        bake: true,
        then: "to_keys",
      },
      place,
    );

    expect(prepared).toMatchObject({
      command: "simulate",
      access: "change",
      target: "pile.blend",
      changes: [{ path: "pile.blend", change: "updated" }],
    });
    expect(rowsOf(prepared)).toEqual([
      [
        "Rigid bodies",
        "Box, Crate active, hull, of Steel, bounce 0.2; Ball active, sphere, at 1100 kg/m³; Bag active, hull, 5 kg, friction 0.9; Floor passive, hull if convex, else mesh; Paddle animated by its keys, hull",
      ],
      [
        "World",
        "gravity (0, 0, -1.62 m/s²), 20 substeps a frame, 15 solver iterations",
      ],
      [
        "Bake",
        "every simulation in the scene over the timeline; dynamic paint that caches beside the scene is left for a script",
      ],
      [
        "Then",
        "key the rigid bodies' motion on every frame and remove the rigid-body physics",
      ],
    ]);
  });

  it("read freeing the bakes and keeping where the bodies rest", async () => {
    const prepared = await prepareSimulate(
      { bake: false, then: "settle" },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Bake", "free every simulation's bake, so each follows changes again"],
      [
        "Then",
        "keep the rigid bodies where they are at the end of the timeline and remove the rigid-body physics",
      ],
    ]);
  });

  it("are refused when an active body is given no density, material or mass, or more than one", async () => {
    const unweighed = await prepareSimulate(
      {
        rigid: [{ objects: ["Box"] }, { objects: ["Floor"], role: "passive" }],
      },
      place,
    );
    const twice = await prepareSimulate(
      { rigid: [{ objects: ["Box"], density: 500, material: "Steel" }] },
      place,
    );

    expect(unweighed).toMatchObject({
      reason: "This call is missing rigid[0].density.",
      correctable: true,
    });
    expect(twice).toMatchObject({
      reason: "Give exactly one of rigid[0].density and rigid[0].material.",
      correctable: true,
    });
  });
});
