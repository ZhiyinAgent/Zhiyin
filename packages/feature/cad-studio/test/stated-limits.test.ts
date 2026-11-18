/**
 * The limits a build's script and its requirements file are held to, as the
 * model reads them before a call, and as a call past one is refused: naming
 * the limit, and what to do instead.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { requirementsFor } from "../src/requirements-request.js";
import { scriptOf } from "../src/script-source.js";
import { cadTools } from "../src/tools.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

type Property = {
  readonly description: string;
  readonly maxLength?: number;
};

const inputOf = (tool: string, field: string) =>
  (
    cadTools.find((one) => one.name === tool)?.inputSchema?.["properties"] as
      Record<string, Property> | undefined
  )?.[field];

const megabyte = 1024 * 1024;

describe("a build's script", () => {
  it("is said to be at most 1 MB, as code or as a file, in both tools", () => {
    for (const tool of ["cad_build", "cad_draw"]) {
      expect(inputOf(tool, "code")).toEqual({
        type: "string",
        maxLength: megabyte,
        description: "The script, as Python code, at most 1 MB.",
      });
      expect(inputOf(tool, "file")?.description).toContain("At most 1 MB.");
    }
  });

  it("is refused past 1 MB as code, saying how to make it smaller", async () => {
    const root = await folders.make("zhiyin-cad-limits-");

    expect(
      await scriptOf(root, { code: `x = 1\n${"#".repeat(megabyte)}` }),
    ).toEqual({
      ok: false,
      reason:
        "A script may be at most 1 MB. Move parts of it into workspace modules it imports, or have it read its data from a workspace file.",
    });
  });

  it("is refused past 1 MB as a file, saying how to make it smaller", async () => {
    const root = await folders.make("zhiyin-cad-limits-");
    await writeFile(join(root, "big.py"), `x = 1\n${"#".repeat(megabyte)}`);

    expect(await scriptOf(root, { file: "big.py" })).toEqual({
      ok: false,
      reason:
        "big.py is over 1 MB, the most a script may be. Move parts of it into workspace modules it imports, or have it read its data from a workspace file.",
    });
  });
});

describe("a requirements file", () => {
  async function read(contents: unknown) {
    const root = await folders.make("zhiyin-cad-limits-");
    await writeFile(
      join(root, "requirements.json"),
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
    return requirementsFor(root, "requirements.json");
  }

  const wall = { check: "wall", part: "Plate", min: 1.2 };

  it("is said to hold from 1 to 100 requirements, with words, names and lists of 200 at most, in at most 256 KB", () => {
    expect(inputOf("cad_build", "requirements")?.description).toContain(
      "The file holds from 1 to 100 requirements and is at most 256 KB; says is at most 200 characters, a part's name or pattern at most 200, and a list of them at most 200 entries.",
    );
  });

  it("is refused past 100 requirements, saying how to need fewer", async () => {
    const requirements = Array.from({ length: 101 }, (_, n) => ({
      id: `R${n + 1}`,
      ...wall,
    }));

    expect(await read({ requirements })).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: it holds at most 100 requirements; check several parts in one with a pattern between slashes, such as /Bolt_.*/, or keep those that matter most.",
    });
  });

  it("refuses words past 200 characters, saying to shorten them", async () => {
    expect(
      await read({
        requirements: [{ id: "R1", says: "x".repeat(201), ...wall }],
      }),
    ).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: says is the requirement in words, at most 200 characters; shorten it.",
    });
  });

  it("refuses a name past 200 characters, saying a pattern can stand for it", async () => {
    expect(
      await read({
        requirements: [{ id: "R1", ...wall, part: "P".repeat(201) }],
      }),
    ).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: part names one shown part, or a pattern between slashes, at most 200 characters; a pattern such as /Bolt_.*/ stands for a long name.",
    });
  });

  it("refuses a list past 200 names, saying a pattern can stand for many", async () => {
    const parts = Array.from({ length: 201 }, (_, n) => `Bolt_${n}`);

    expect(
      await read({
        requirements: [{ id: "R1", check: "separate", parts }],
      }),
    ).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json: R1: parts names from 1 to 200 shown parts, or patterns between slashes, each at most 200 characters; a pattern such as /Bolt_.*/ stands for many.",
    });
  });

  it("is refused past 256 KB, saying how to make it smaller", async () => {
    expect(
      await read(
        JSON.stringify({ requirements: [{ id: "R1", ...wall }] }).padEnd(
          256 * 1024 + 1,
          " ",
        ),
      ),
    ).toEqual({
      ok: false,
      file: "requirements.json",
      reason:
        "requirements.json is over 256 KB, the most a requirements file may be. Let patterns between slashes, such as /Bolt_.*/, stand for long lists of parts, and keep says short.",
    });
  });
});
