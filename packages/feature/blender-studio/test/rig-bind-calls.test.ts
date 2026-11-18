/**
 * A rig call's binding and reaching chains as they are prepared before
 * Blender is reached: the approval says in words what is bound to what and
 * what each chain reaches for, and a chain with neither a target nor a curve,
 * or both, is refused naming them.
 */

import { describe, expect, it } from "vitest";
import { prepareRig } from "../src/rig-calls.js";

const place = { root: "C:/workspace", scene: "scene.blend", protect: [] };
const rows = (prepared: Awaited<ReturnType<typeof prepareRig>>) => {
  if ("reason" in prepared) throw new Error(prepared.reason);
  return prepared.rows.map(({ name, value }) => `${name}: ${value}`);
};

describe("preparing a rig's binding and reaching chains", () => {
  it("says what is bound to which armature, how, and the most bones on a point", async () => {
    const prepared = await prepareRig(
      {
        bind: {
          meshes: ["Body", "Eyes"],
          armature: "Rig",
          influences: 4,
        },
      },
      place,
    );

    expect(rows(prepared)).toEqual([
      "Bind: Body, Eyes to Rig, by automatic weights, keeping joints' volume",
      "Influences: at most 4 bones on each point",
    ]);
  });

  it("says a rigid binding, and the rig a call made when no armature is named", async () => {
    const prepared = await prepareRig(
      { bind: { meshes: ["Robot"], how: "rigid", preserve_volume: false } },
      place,
    );

    expect(rows(prepared)).toEqual([
      "Bind: Robot to the rig this call made, or the scene's armature, rigidly, each loose part to the bone it lies in",
    ]);
  });

  it("says what each chain reaches for, its bones, its pole and whether it stretches", async () => {
    const prepared = await prepareRig(
      {
        ik: [
          { bone: "shin.L", target: "Foot L", pole: "Knee L" },
          { bone: "forearm.R", armature: "Rig", target: "Hand R", chain: 2 },
          { bone: "tail.004", curve: "Tail path", stretch: true },
        ],
      },
      place,
    );

    expect(rows(prepared)).toEqual([
      "Reach: shin.L (2 bones) reaches for Foot L, bending toward Knee L",
      "Reach: forearm.R of Rig (2 bones) reaches for Hand R",
      "Reach: tail.004 (to the root) lies along Tail path, stretching",
    ]);
  });

  it("refuses a chain given neither a target nor a curve, or both", async () => {
    const prepared = await prepareRig(
      {
        ik: [
          { bone: "shin.L" },
          { bone: "tail", target: "Ball", curve: "Path" },
        ],
      },
      place,
    );

    expect(prepared).toEqual({
      reason:
        "Give exactly one of ik[0].target and ik[0].curve. Give exactly one of ik[1].target and ik[1].curve.",
      correctable: true,
    });
  });
});
