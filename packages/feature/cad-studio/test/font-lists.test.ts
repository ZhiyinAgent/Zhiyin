/**
 * The list of the system's fonts the CAD studio keeps for its runs: made once
 * by a run of its own, read by every build's two runs, which may not change
 * it, and made again once the system's fonts change. Python is a stand-in that
 * lists fonts as ezdxf does; the real one runs in the system-boundary tests.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  cadAutomation,
  KeptFontLists,
  type CadPython,
  type CadRun,
} from "../src/index.js";
import { requestOf, stoppedUnasked } from "./harness-request.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const code = 'from build123d import *\nshow(Box(80, 50, 8), name="Plate")\n';
const listFile = join("ezdxf", "font_manager_cache.json");

/** Whether a run is the one that lists the fonts. */
const listing = (run: CadRun) =>
  run.arguments.some((one) => basename(one) === "font_list.py");

/** The folder a run is told to read the font list from, or nothing. */
const fontsOf = (run: CadRun) => {
  const at = run.arguments.indexOf("--fonts");
  return at === -1 ? undefined : run.arguments[at + 1];
};

/**
 * A studio over a stand-in Python whose font listing writes, as ezdxf does,
 * the fonts in `fonts` into the folder it is given; `lists` says how a
 * listing ends.
 */
async function studio(
  options: {
    readonly lists?: (out: string, fonts: string) => Promise<number>;
    readonly packages?: string;
    readonly data?: string;
    readonly fonts?: string;
  } = {},
) {
  const root = await folders.make("zhiyin-cad-fonts-workspace-");
  const data = options.data ?? (await folders.make("zhiyin-cad-fonts-data-"));
  const fonts = options.fonts ?? (await folders.make("zhiyin-cad-fonts-"));
  if (!options.fonts) await writeFile(join(fonts, "arial.ttf"), "font");
  const runs: CadRun[] = [];
  const lists =
    options.lists ??
    (async (out: string, from: string) => {
      await mkdir(join(out, "ezdxf"), { recursive: true });
      const faces = (await readdir(from)).map((name) => [
        join(from, name),
        name,
        "Regular",
        400,
        5,
      ]);
      await writeFile(
        join(out, listFile),
        JSON.stringify({ version: 2, "font-faces": faces }),
      );
      return 0;
    });
  const python: CadPython = {
    state: async () => "ready",
    run: async (request) => {
      runs.push(request);
      if (listing(request))
        return {
          ok: true,
          run: {
            exitCode: await lists(request.arguments.at(-1)!, fonts),
            stdout: "",
            stderr: "",
          },
        };
      const path = await requestOf(request);
      if (!path) return stoppedUnasked;
      const given = JSON.parse(await readFile(path, "utf8")) as {
        phase?: string;
        output: string;
      };
      if (given.phase === "script")
        await writeFile(join(given.output, "manifest.json"), "{}");
      else
        await writeFile(
          join(given.output, "answer.json"),
          JSON.stringify({
            parts: [],
            overlaps: [],
            exports: [],
            seconds: { total: 1 },
          }),
        );
      return { ok: true, run: { exitCode: 0, stdout: "", stderr: "" } };
    },
  };
  const harness = join(data, "harness", "run.py");
  const kept = new KeptFontLists({
    directory: join(data, "cad-fonts"),
    python,
    harness,
    fonts,
    ...(options.packages ? { packages: options.packages } : {}),
  });
  const tools = cadAutomation(python, {
    workspaceRoot: () => root,
    harness,
    directory: join(data, "cad-studio"),
    fonts: kept,
  });
  /** Builds the plate, and answers the build's two runs. */
  const build = async () => {
    const before = runs.length;
    const result = (await tools.callTool("cad_build", { code })) as {
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    return runs.slice(before).filter((run) => !listing(run));
  };
  return { data, fonts, runs, kept, build, harness };
}

describe("the kept font list", () => {
  it("is made once, by a run of its own beside the first build, which lists the fonts itself", async () => {
    const { runs, kept, build } = await studio();

    await Promise.all([build(), build()]);
    await kept.settled();

    const built = runs.filter((run) => !listing(run));
    expect(built).toHaveLength(4);
    // Neither build waited for a list: each run lists the fonts itself.
    for (const run of built) expect(fontsOf(run)).toBeUndefined();
    expect(runs.filter(listing)).toHaveLength(1);
  });

  it("lists the fonts isolated, given only the harness to read and a folder new for it to write, in a home that lasts one run", async () => {
    const { runs, kept, build, harness, data } = await studio();

    await build();
    await kept.settled();

    const [made] = runs.filter(listing);
    expect(made!.arguments).toEqual([
      "-I",
      "-X",
      "utf8",
      join(dirname(harness), "font_list.py"),
      made!.write[0],
    ]);
    expect(made!.read).toEqual([dirname(harness)]);
    expect(made!.write).toHaveLength(1);
    expect(made!.cwd).toBe(made!.write[0]);
    expect(made!.homeLastsOneRun).toBe(true);
    // What it was given to write and its home are gone once the list is kept.
    expect(await readdir(join(data, "cad-fonts", "making"))).toEqual([]);
  });

  it("is read by both runs of every later build, which may not write it", async () => {
    const { kept, build } = await studio();
    await kept.folder();
    await kept.settled();
    const folder = (await kept.folder())!;
    const list = await readFile(join(folder, listFile), "utf8");

    const [script, measuring] = await build();

    for (const run of [script!, measuring!]) {
      expect(fontsOf(run)).toBe(folder);
      expect(run.read).toContain(folder);
      // Neither what it writes nor its home holds the list, or is held in it.
      for (const written of [...run.write, run.home]) {
        expect(folder.startsWith(written)).toBe(false);
        expect(written.startsWith(folder)).toBe(false);
      }
      // The request is still the last argument.
      expect(run.arguments.at(-1)).toMatch(/\.json$/);
    }
    expect(JSON.parse(list)["font-faces"][0][1]).toBe("arial.ttf");
  });

  it("is not read once a font is added to the system's fonts: that build lists them itself, and the list is made again with it", async () => {
    const { kept, build, fonts, data } = await studio();
    await kept.folder();
    await kept.settled();
    const before = (await kept.folder())!;
    // A folder's time of change moves on as a file is added to it.
    await new Promise((wait) => setTimeout(wait, 30));
    await writeFile(join(fonts, "added.ttf"), "font");

    const [script, measuring] = await build();
    await kept.settled();
    const after = await kept.folder();
    const [again] = await build();

    expect(fontsOf(script!)).toBeUndefined();
    expect(fontsOf(measuring!)).toBeUndefined();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    const faces = JSON.parse(await readFile(join(after!, listFile), "utf8"))[
      "font-faces"
    ] as string[][];
    expect(faces.map((face) => face[1])).toContain("added.ttf");
    expect(fontsOf(again!)).toBe(after);
    // The list of the fonts as they were is no longer kept.
    expect(await readdir(join(data, "cad-fonts"))).toEqual(
      expect.not.arrayContaining([basename(before)]),
    );
  });

  it("is never one made for other CAD packages", async () => {
    const data = await folders.make("zhiyin-cad-fonts-shared-");
    const fonts = await folders.make("zhiyin-cad-fonts-");
    await writeFile(join(fonts, "arial.ttf"), "font");
    const earlier = await studio({ data, fonts, packages: "earlier" });
    await earlier.kept.folder();
    await earlier.kept.settled();
    const theirs = await earlier.kept.folder();

    const now = await studio({ data, fonts, packages: "now" });

    expect(theirs).toBeDefined();
    expect(await now.kept.folder()).toBeUndefined();
  });

  it("is not kept when listing fails or writes no list, and is not tried again while the app runs", async () => {
    let tries = 0;
    const failing = await studio({
      lists: async () => {
        tries += 1;
        return 1;
      },
    });
    const empty = await studio({
      lists: async (out) => {
        await mkdir(join(out, "ezdxf"), { recursive: true });
        await writeFile(join(out, listFile), '{"version": 2');
        return 0;
      },
    });

    for (const { kept } of [failing, empty]) {
      await kept.folder();
      await kept.settled();
      expect(await kept.folder()).toBeUndefined();
    }
    const [script] = await failing.build();
    await failing.kept.settled();

    expect(fontsOf(script!)).toBeUndefined();
    expect(tries).toBe(1);
    expect(await readdir(join(empty.data, "cad-fonts"))).toEqual(["making"]);
  });
});
