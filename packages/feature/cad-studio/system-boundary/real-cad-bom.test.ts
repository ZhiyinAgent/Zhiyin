/**
 * A build's parts list, against a real build123d and bd_warehouse: the
 * shown parts counted where one is another moved and turned, a mirror image
 * kept apart, bought parts known by their bd_warehouse class, each row's
 * material, mass and files, and what it could not tell. Skipped unless the
 * CAD environment's Python is named, as the other real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project system-boundary packages/feature/cad-studio/system-boundary/real-cad-bom.test.ts
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const folders = new TemporaryFolders();

/**
 * A plate on four spacers, two of them turned, held by four bd_warehouse
 * screws; two copies of an L bracket with a hole off its middle, one turned,
 * and its mirror image; and a bolt the script made itself.
 */
const assembly = [
  "from build123d import *",
  "from bd_warehouse.fastener import SocketHeadCapScrew",
  "plate = Box(80, 50, 8)",
  "for x in (-30, 30):",
  "    for y in (-15, 15):",
  "        plate -= Pos(x, y, 0) * Cylinder(3.3, 8)",
  'show(plate, name="Plate")',
  "spacer = Cylinder(6, 10) - Cylinder(3.3, 10)",
  "turns = [Rot(0, 0, 0), Rot(0, 0, 33), Rot(180, 0, 0), Rot(0, 0, 0)]",
  'show([Pos(x, y, -9) * turn * spacer for (x, y), turn in zip([(-30, -15), (-30, 15), (30, -15), (30, 15)], turns)], name="Spacer")',
  'screw = SocketHeadCapScrew("M6-1", 20, "iso4762", simple=True)',
  'show([Pos(x, y, 4) * screw for x in (-30, 30) for y in (-15, 15)], name="Screw")',
  "bracket = Box(30, 20, 4, align=Align.MIN) + Box(4, 20, 30, align=Align.MIN)",
  "bracket -= Pos(18, 6, 0) * Cylinder(2.5, 4, align=(Align.CENTER, Align.CENTER, Align.MIN))",
  'show([Pos(60, 0, 0) * bracket, Pos(120, 0, 0) * Rot(0, 0, 90) * bracket], name="Left bracket")',
  'show(Pos(-60, 0, 0) * bracket.mirror(Plane.YZ), name="Right bracket")',
  'show(Pos(0, 60, 0) * Cylinder(3, 30), name="Bolt")',
].join("\n");

describe.skipIf(!python)("a build's parts list, with a real build123d", () => {
  let root: string;
  let build: (args: Record<string, unknown>) => Promise<Result>;
  const text = (result: Result) => result.content[0]?.text ?? "";

  beforeAll(async () => {
    root = await folders.make("zhiyin-real-cad-bom-workspace-");
    const data = await folders.make("zhiyin-real-cad-bom-data-");
    const tools = cadAutomation(await confinedPython(), {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
    });
    build = async (args) => {
      const asked = await tools.inspect("cad_build", args);
      if (!asked.ok) throw new Error(asked.reason);
      return (await tools.callTool(
        "cad_build",
        args,
        undefined,
        asked.identity,
      )) as Result;
    };
  }, 30_000);

  afterAll(() => folders.removeAll());

  it("lists each different part once with how many, its material, mass and files, and says what it could not tell", async () => {
    const result = await build({
      code: assembly,
      exports: [
        { path: "shop/plate.step", parts: ["Plate"] },
        { path: "shop/spacers.stl", parts: ["/Spacer.*/"] },
        {
          path: "shop/parts.csv",
          materials: {
            Plate: "aluminium",
            "/Spacer.*/": "POM",
            "/Screw.*/": "steel",
          },
        },
      ],
    });
    const answer = text(result);

    expect(result.isError, answer).toBeUndefined();
    expect(answer).toMatch(
      /Wrote shop\/parts\.csv \([^)]+\), a parts list of 6 rows from 13 parts:\n/,
    );
    expect(answer).toContain(
      [
        "- 1: 1 × Plate: made, 80 × 50 × 8 mm, aluminium, 83.44 g; in shop/plate.step.",
        "- 2: 4 × Spacer (Spacer 1, Spacer 2, Spacer 3 and Spacer 4, the same shape): made, 12 × 12 × 10 mm, POM; in shop/spacers.stl.",
        "- 3: 4 × Screw (Screw 1, Screw 2, Screw 3 and Screw 4, the same part): bought, socket head cap screw ISO 4762 M6-1 × 20, bd_warehouse's SocketHeadCapScrew, steel, 6.32 g each; in no part file this call wrote.",
        "- 4: 2 × Left bracket (Left bracket 1 and Left bracket 2, the same shape): made, 30 × 30 × 20 mm; in no part file this call wrote.",
        "- 5: 1 × Right bracket: made, 30 × 30 × 20 mm; in no part file this call wrote.",
        "- 6: 1 × Bolt: made, 30 × 6 × 6 mm; in no part file this call wrote.",
        'No material or mass for Left bracket, Right bracket and Bolt: materials gives them none; give each as {"Part": "steel"}, a name or a /pattern/.',
        "No mass for Spacer: POM is not in the material table, which holds PLA, ",
      ].join("\n"),
    );
    expect(answer).toContain(
      "Bolt is not one of bd_warehouse's standard parts, so it is listed as made; a bought part is recognised when the script shows bd_warehouse's own, as SocketHeadCapScrew(...).",
    );
    expect(answer).toContain(
      "Left bracket 1 and Right bracket are mirror images of each other, so each is a row of its own.",
    );

    // A spreadsheet reads the same rows, the byte order mark telling it UTF-8.
    const csv = await readFile(join(root, "shop", "parts.csv"), "utf8");
    expect(csv.split("\r\n")).toEqual([
      "﻿Item,Quantity,Part,Made or bought,Description,Material,Mass each (g),Size (mm),Files",
      "1,1,Plate,made,,aluminium,83.44,80 × 50 × 8,shop/plate.step",
      "2,4,Spacer,made,,POM,,12 × 12 × 10,shop/spacers.stl",
      "3,4,Screw,bought,socket head cap screw ISO 4762 M6-1 × 20,steel,6.32,26 × 10.22 × 10.22,",
      "4,2,Left bracket,made,,,,30 × 30 × 20,",
      "5,1,Right bracket,made,,,,30 × 30 × 20,",
      "6,1,Bolt,made,,,,30 × 6 × 6,",
      "",
    ]);
  }, 240_000);

  it("writes no parts list whose materials name no part, saying so, and keeps the build's other files", async () => {
    const result = await build({
      code: assembly,
      exports: [
        { path: "shop/plate-only.step", parts: ["Plate"] },
        { path: "shop/wrong.csv", materials: { "/Washer.*/": "steel" } },
      ],
    });
    const answer = text(result);

    expect(answer).toContain(
      "shop/wrong.csv was not written: materials gives /Washer.*/, which matches no part's whole name; the parts are Plate, Spacer 1,",
    );
    expect(answer).toMatch(/Wrote shop\/plate-only\.step \([^)]+\): Plate\./);
  }, 240_000);
});
