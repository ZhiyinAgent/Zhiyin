/**
 * The requirement kinds the CAD studio measures are one list: the kinds the
 * tools name and refuse others by are the kinds the harness has a measure
 * for, so a kind added to one and not the other fails here.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cadKindNames } from "../src/requirements-request.js";

describe("the requirement kinds", () => {
  it("are those the harness measures, each by its own entry of its table", async () => {
    const harness = await readFile(
      new URL("../src/harness/zhiyin_cad/requirements.py", import.meta.url),
      "utf8",
    );
    const table = /^KINDS = \{\r?\n([\s\S]*?)^\}/m.exec(harness)?.[1] ?? "";
    const measured = [...table.matchAll(/^ {4}"(\w+)":/gm)].map(
      (one) => one[1],
    );

    expect([...measured].sort()).toEqual([...cadKindNames].sort());
  });
});
