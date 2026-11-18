/**
 * The session keeps its own copy of the names the CAD studio hands it in
 * files. The real-Blender tests read parts and motion files written in the
 * contract's names, where a Blender is present; these run everywhere and hold
 * the copy in the code that reads each file to the contract's names.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CAD_PART_EXTRAS, type CadMotionFile } from "@zhiyin/contract";

const source = (module: string) =>
  readFile(
    new URL(`../src/session/zhiyin_studio/${module}`, import.meta.url),
    "utf8",
  );

describe("the hand-off the 3D studio reads from the CAD studio", () => {
  it("knows a CAD part's mesh by the contract's names", async () => {
    const reader = await source("model_shapes.py");

    for (const name of Object.values(CAD_PART_EXTRAS))
      expect(reader).toContain(`"${name}"`);
  });

  it("reads a motion file's fields by the contract's names", async () => {
    const reader = await source("cad_motion.py");
    // The fields keying parts depends on; the compiler holds each to the contract.
    const read: readonly (keyof CadMotionFile)[] = [
      "positions",
      "parts",
      "unfitted",
      "straight",
    ];

    for (const field of read) expect(reader).toContain(`"${field}"`);
  });
});
