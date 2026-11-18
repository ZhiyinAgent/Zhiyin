/**
 * The harness keeps its own copy of the names it hands the 3D studio in files.
 * The real-CAD tests check the files it writes against the contract, where
 * the CAD environment is present; these run everywhere and hold the copy in
 * the code that writes each file to the contract's names.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CAD_MOTION_FORMAT,
  CAD_PART_EXTRAS,
  type CadMotionFile,
} from "@zhiyin/contract";

const source = (module: string) =>
  readFile(
    new URL(`../src/harness/zhiyin_cad/${module}`, import.meta.url),
    "utf8",
  );

describe("the hand-off the CAD studio writes for the 3D studio", () => {
  it("marks each part's mesh in a .glb with the contract's names", async () => {
    const writer = await source("glb.py");

    for (const name of Object.values(CAD_PART_EXTRAS))
      expect(writer).toContain(`"${name}"`);
  });

  it("writes a motion file with the contract's fields, in its format", async () => {
    const writer = await source("motion.py");
    // Every field the contract names, held to its type both ways by the compiler.
    const fields = {
      motion: true,
      positions: true,
      parts: true,
      unfitted: true,
      still: true,
      straight: true,
    } satisfies Record<keyof CadMotionFile, true>;

    for (const field of Object.keys(fields))
      expect(writer).toContain(`"${field}"`);
    expect(writer).toContain(`"motion": ${CAD_MOTION_FORMAT},`);
  });
});
