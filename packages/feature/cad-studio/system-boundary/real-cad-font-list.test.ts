/**
 * The font list the CAD studio keeps, against a real build123d: made by a
 * confined run of its own from the Windows fonts, read by a build's runs,
 * which cannot change it, and not read once the fonts it was made from have
 * changed. Skipped unless the CAD environment's Python is named, as the other
 * real-CAD tests are:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"; npx vitest run --project "system-boundary*" packages/feature/cad-studio/system-boundary/real-cad-font-list.test.ts
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { cadAutomation, KeptFontLists } from "../src/index.js";
import { confinedPython, harness, python } from "./confined-cad-python.js";

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

type Result = { isError?: boolean; content: { text?: string }[] };

/** A plate, built after the script tries to change the list ezdxf read and says where it read it. */
const plate = (thickness: number) =>
  [
    "import os",
    "from build123d import *",
    "from ezdxf.fonts import fonts",
    "read = str(fonts._get_font_manager_path())",
    "kept = os.environ.get('XDG_CACHE_HOME')",
    "print('read the kept list' if kept and read.startswith(kept) else 'read its own list')",
    "print('arial', fonts.font_manager.has_font('arial.ttf'))",
    "try:",
    "    open(read, 'a').close()",
    "    print('changed the list')",
    "except PermissionError:",
    "    print('may not change the list')",
    `show(Box(80, 50, ${thickness}), name="Plate")`,
  ].join("\n");

const digest = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

describe.skipIf(!python)("the kept font list, with a real build123d", () => {
  it("is made from the Windows fonts, read by a build's runs, which may not change it, and not read once the fonts change", async () => {
    const root = await folders.make("zhiyin-real-cad-fonts-workspace-");
    const data = await folders.make("zhiyin-real-cad-fonts-data-");
    // Stands for the system's fonts folder, whose time of change names the list.
    const fonts = await folders.make("zhiyin-real-cad-fonts-folder-");
    const confined = await confinedPython();
    const kept = new KeptFontLists({
      directory: join(data, "cad-fonts"),
      python: confined,
      harness,
      fonts,
    });
    const tools = cadAutomation(confined, {
      workspaceRoot: () => root,
      harness,
      directory: join(data, "cad-studio"),
      fonts: kept,
    });
    const build = async (code: string) => {
      const asked = await tools.inspect("cad_build", { code });
      if (!asked.ok) throw new Error(asked.reason);
      const result = (await tools.callTool(
        "cad_build",
        { code },
        undefined,
        asked.identity,
      )) as Result;
      return result.content.map((part) => part.text ?? "").join("\n");
    };

    expect(await kept.folder()).toBeUndefined();
    await kept.settled();
    const folder = await kept.folder();
    expect(folder).toBeDefined();
    const list = join(folder!, "ezdxf", "font_manager_cache.json");
    const faces = JSON.parse(await readFile(list, "utf8"))[
      "font-faces"
    ] as string[][];
    const windowsFonts = join(process.env["SystemRoot"]!, "Fonts");
    expect(
      faces.some(
        ([path]) =>
          path!.toLowerCase() === join(windowsFonts, "arial.ttf").toLowerCase(),
      ),
    ).toBe(true);
    const before = await digest(list);

    const reading = await build(plate(8));

    expect(reading).toContain("Plate: a valid solid, 80 × 50 × 8 mm");
    expect(reading).toContain("read the kept list");
    expect(reading).toContain("arial True");
    expect(reading).toContain("may not change the list");
    expect(await digest(list)).toBe(before);

    // A font added: the folder's time of change moves on.
    await writeFile(join(fonts, "added.ttf"), "");
    const changed = await build(plate(9));
    await kept.settled();

    expect(changed).toContain("Plate: a valid solid, 80 × 50 × 9 mm");
    expect(changed).toContain("read its own list");
    expect(changed).toContain("arial True");
    const again = await kept.folder();
    expect(again).toBeDefined();
    expect(again).not.toBe(folder);
  });
});
