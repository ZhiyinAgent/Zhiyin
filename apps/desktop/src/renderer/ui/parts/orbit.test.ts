import { describe, expect, it } from "vitest";
import {
  cameraPosition,
  fittingDistance,
  startingOrbit,
  turned,
  zoomed,
} from "./orbit.js";

describe("looking round the parts", () => {
  it("turns round them without end, and stops short of straight above or below", () => {
    expect(turned(startingOrbit, 360 * 5 + 10, 0).yaw).toBeCloseTo(
      startingOrbit.yaw + 10,
    );
    expect(turned(startingOrbit, 0, 200).pitch).toBe(85);
    expect(turned(startingOrbit, 0, -200).pitch).toBe(-85);
  });

  it("zooms between a close look and a small whole", () => {
    let near = startingOrbit;
    for (let step = 0; step < 50; step++) near = zoomed(near, 1.15);
    expect(near.distance).toBe(0.15);
    let far = startingOrbit;
    for (let step = 0; step < 50; step++) far = zoomed(far, 1 / 1.15);
    expect(far.distance).toBe(6);
  });

  it("stands the camera at the fitting distance from the centre, in front for no turn", () => {
    const [x, y, z] = cameraPosition(
      { yaw: 0, pitch: 0, distance: 1 },
      [1, 2, 3],
      10,
    );
    expect([x, y, z].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      1, 2, 13,
    ]);
    const above = cameraPosition(
      { yaw: 0, pitch: 85, distance: 2 },
      [0, 0, 0],
      10,
    );
    expect(Math.hypot(...above)).toBeCloseTo(20);
    expect(above[1]).toBeGreaterThan(19);
  });
});

describe("fitting the parts", () => {
  const box = (x: number, y: number, z: number) =>
    [-1, 1].flatMap((i) =>
      [-1, 1].flatMap((j) =>
        [-1, 1].map((k) => [(i * x) / 2, (j * y) / 2, (k * z) / 2] as const),
      ),
    );

  it("stands closer to a flat plate than to a cube as wide", () => {
    const plate = fittingDistance(box(120, 10, 80), 32, 1.5);
    const cube = fittingDistance(box(120, 120, 120), 32, 1.5);
    expect(plate).toBeLessThan(cube * 0.8);
  });

  it("stands further back in a narrow view than in a wide one", () => {
    const parts = box(120, 10, 80);
    expect(fittingDistance(parts, 32, 0.6)).toBeGreaterThan(
      fittingDistance(parts, 32, 1.8),
    );
  });
});
