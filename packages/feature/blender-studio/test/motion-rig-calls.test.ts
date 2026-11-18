/**
 * How an animation of bones, poses, drivers and the ways an aim follows reads
 * for approval: each bone key under its armature and bone, each pose saved
 * with its bones, each value driven with what it reads and how, and each aim
 * with how it turns, stretches or stays on a curve.
 */

import { describe, expect, it } from "vitest";
import { prepareAnimate } from "../src/change-calls.js";

const place = { root: "C:/work", scene: "rig.blend", protect: [] };
const rowsOf = (prepared: unknown) =>
  (prepared as { rows: { name: string; value: string }[] }).rows.map(
    ({ name, value }) => [name, value],
  );

describe("an animation of a rig", () => {
  it("reads each bone key under its armature and bone, and each pose with its bones", async () => {
    const prepared = await prepareAnimate(
      {
        poses: [
          {
            object: "Rig",
            name: "Wave",
            bones: [{ bone: "Forearm", rotation: [0, 0, 45] }],
          },
          { object: "Rig", name: "Now" },
        ],
        keys: [
          { object: "Rig", bone: "Forearm", at: 1, rotation: [90, 0, 0] },
          { object: "Rig", bone: "Hand", at: 1.5, reach: [0, 0.4, 1.2] },
          { object: "Rig", at: 2, pose: "Wave", easing: "linear" },
        ],
      },
      place,
    );

    expect(prepared).toMatchObject({ command: "animate", access: "change" });
    expect(rowsOf(prepared)).toEqual([
      ["Rig pose Wave", "Forearm turned (0°, 0°, 45°)"],
      ["Rig pose Now", "as it stands now"],
      ["Rig's Forearm at 1 s", "turned (90°, 0°, 0°)"],
      ["Rig's Hand at 1.5 s", "reaching for (0, 0.4, 1.2 m)"],
      ["Rig at 2 s", "pose Wave, at an even speed"],
    ]);
  });

  it("reads each value driven with the variables it reads and how they make it", async () => {
    const prepared = await prepareAnimate(
      {
        drive: [
          {
            object: "Face",
            path: 'data.shape_keys.key_blocks["Smile"].value',
            variables: [
              {
                name: "d",
                kind: "distance",
                object: "Rig",
                bone: "Jaw",
                to: "Chin",
              },
            ],
            formula: "d * 4",
          },
          {
            object: "Lid",
            path: '["open"]',
            variables: [
              { object: "Dial", path: "rotation_euler[2]" },
              { kind: "turn_between", object: "Dial", to: "Knob" },
            ],
            combine: "max",
          },
        ],
      },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      [
        `Face's data.shape_keys.key_blocks["Smile"].value`,
        "driven by d, the distance from Rig's Jaw to Chin, by d * 4",
      ],
      [
        `Lid's ["open"]`,
        "driven by a, Dial's rotation_euler[2]; b, the turn between Dial and Knob, max",
      ],
    ]);
  });

  it("reads how each aim follows: an axis kept up, one axis only, stretched, or kept on a curve", async () => {
    const prepared = await prepareAnimate(
      {
        aim: [
          { object: "Camera", at: "Ball", up: "y" },
          { object: "Turret", at: "Plane", locked: "z" },
          { object: "Spring", at: "Pin", stretch: true },
          { object: "Car", at: "Track", on_curve: true },
        ],
      },
      place,
    );

    expect(rowsOf(prepared)).toEqual([
      ["Camera aims at", "Ball, its y axis up"],
      ["Turret aims at", "Plane, turning about its z axis only"],
      ["Spring aims at", "Pin, stretching to reach it"],
      ["Car aims at", "kept on the curve Track"],
    ]);
  });

  it("takes a call that only saves a pose or only drives a value as one that sets something", async () => {
    const posing = await prepareAnimate(
      { poses: [{ object: "Rig", name: "Now" }] },
      place,
    );
    const driving = await prepareAnimate(
      {
        drive: [
          {
            object: "Lid",
            path: '["open"]',
            variables: [{ object: "Dial", path: "location[0]" }],
          },
        ],
      },
      place,
    );

    expect(posing).toMatchObject({ command: "animate" });
    expect(driving).toMatchObject({ command: "animate" });
  });
});
