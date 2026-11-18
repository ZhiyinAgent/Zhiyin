/**
 * A rig call's bones and ready rig as a person approves them: the armature,
 * the bones and where their ends go, each list edit in words, the side
 * mirrored, the bone collections, and a ready rig with the mesh it is
 * fitted to and the rig it makes.
 */

import { describe, expect, it } from "vitest";
import { prepareRig } from "../src/rig-calls.js";

const place = { root: "C:/work", scene: "scene.blend", protect: [] };

const rowsOf = async (args: Record<string, unknown>) => {
  const prepared = await prepareRig(args, place);
  if ("reason" in prepared) throw new Error(prepared.reason);
  return prepared.rows.map(({ name, value }) => `${name}: ${value}`);
};

describe("approving bones and ready rigs", () => {
  it("says the armature, each bone's ends, the list edits, the mirror and the collections", async () => {
    const rows = await rowsOf({
      armature: "Arm rig",
      bones: [
        { name: "upper_arm.L", head: [0.15, 0, 1.4], tail: [0.5, 0, 1.4] },
        { name: "forearm.L", parent: "upper_arm.L", tail: [0.85, 0, 1.4] },
      ],
      bone_edits: [
        { bone: "forearm.L", kind: "extrude", to: [1, 0, 1.4], name: "hand.L" },
        { bone: "upper_arm.L", kind: "subdivide", count: 2 },
        {
          bone: "upper_arm.L",
          kind: "duplicate",
          offset: [0, 0.2, 0],
          replace: ["arm", "wing"],
        },
        { bone: "hand.L", kind: "rename", name: "palm.L" },
        { bone: "palm.L", kind: "remove" },
      ],
      symmetrize: "L",
      collections: [
        { name: "Arms", bones: ["upper_arm.L", "forearm.L"] },
        { name: "Spare", visible: false },
      ],
    });

    expect(rows).toEqual([
      "Armature: Arm rig",
      "Bones: 2 bones: upper_arm.L from (0.15, 0, 1.4 m) to (0.5, 0, 1.4 m); forearm.L to (0.85, 0, 1.4 m) under upper_arm.L",
      "Edits: extrude hand.L from forearm.L to (1, 0, 1.4 m); split upper_arm.L into 2; copy upper_arm.L and the bones below it, moved (0, 200, 0 mm), “arm” renamed “wing”; rename hand.L to palm.L; remove palm.L",
      "Mirror: the left (.L) bones onto the other side",
      "Collections: Arms (2 bones), Spare, hidden",
    ]);
  });

  it("refuses before approval bones with no armature and list edits missing what their kind needs", async () => {
    const homeless = await prepareRig(
      { bones: [{ name: "a", head: [0, 0, 0], tail: [0, 0, 1] }] },
      place,
    );
    const lacking = await prepareRig(
      {
        armature: "Rig",
        bone_edits: [
          { bone: "a", kind: "extrude" },
          { bone: "a", kind: "subdivide" },
          { bone: "a", kind: "rename" },
          { bone: "a", kind: "remove" },
        ],
      },
      place,
    );
    const ready = await prepareRig(
      {
        from: { kind: "human", fit_to: "Body" },
        bones: [{ name: "shin.L", head: [0.1, 0, 0.5] }],
      },
      place,
    );

    expect(homeless).toMatchObject({
      reason: "This call is missing armature.",
      correctable: true,
    });
    expect(lacking).toMatchObject({
      reason:
        "This call is missing bone_edits[0].to, bone_edits[1].count and bone_edits[2].name.",
    });
    expect("reason" in ready).toBe(false);
  });

  it("says a ready rig's kind, the mesh it is fitted to, where it faces and the rig it makes", async () => {
    const rows = await rowsOf({
      from: { kind: "quadruped", fit_to: "Dog", facing: "+x" },
    });

    expect(rows).toEqual([
      "Ready rig: Rigify's quadruped fitted to Dog, its front toward +x, and its rig generated",
      "Armature: Dog rig",
    ]);
  });
});
