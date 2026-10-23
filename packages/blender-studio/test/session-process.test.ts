/**
 * What Blender is started with, against a container that records the launch:
 * of the person's variables only those every confined program has, so none
 * can point Blender at scripts it runs on start or hand a script a key, and
 * Blender is confined to the folders it works in, none it loads code from.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Confined,
  Confinement,
  ContainedProcessOptions,
  ProcessContainment,
} from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { containedSessionLaunch } from "../src/session-process.js";

const folders = new TemporaryFolders();

afterEach(async () => {
  vi.unstubAllEnvs();
  await folders.removeAll();
});

/** A Blender, a session script and a container that records what it is asked to start. */
async function setUp() {
  const directory = await folders.make("zhiyin-blender-session-");
  const program = join(directory, "blender");
  await mkdir(program);
  await writeFile(join(program, "blender.exe"), "");
  const session = join(directory, "session");
  await mkdir(join(session, "zhiyin_studio"), { recursive: true });
  await writeFile(join(session, "start.py"), "the start");
  await writeFile(join(session, "zhiyin_studio", "main.py"), "the session");
  const launched: ContainedProcessOptions[] = [];
  const containment = {
    open: () => ({
      launch: (options: ContainedProcessOptions) => {
        launched.push(options);
        throw new Error("Not started in this test.");
      },
      close: () => {},
    }),
  } as unknown as ProcessContainment;
  const confinements: Confinement[] = [];
  const launch = containedSessionLaunch(containment, {
    scripts: join(directory, "scripts"),
    confine: async (confinement) => {
      confinements.push(confinement);
      return { purpose: confinement.purpose } as Confined;
    },
  });
  const options = {
    executable: join(program, "blender.exe"),
    script: join(session, "start.py"),
    directory: join(directory, "conversation"),
    workspace: join(directory, "workspace"),
    warm: join(directory, "warm.png"),
  };
  await mkdir(options.workspace);
  return { directory, program, launch, options, launched, confinements };
}

describe("starting Blender", () => {
  it("passes on none of the person's variables that name what Blender, USD or MaterialX load, nor any key", async () => {
    vi.stubEnv("BLENDER_SYSTEM_SCRIPTS", "C:/planted/scripts");
    vi.stubEnv("PXR_PLUGINPATH_NAME", "C:/planted/usd");
    vi.stubEnv("MaterialX_Search_Path", "C:/planted/materialx");
    vi.stubEnv("GITHUB_TOKEN", "ghp_not_a_real_token");
    vi.stubEnv("SystemRoot", "C:\\Windows");
    const { launch, options, launched } = await setUp();

    await expect(launch(options)).rejects.toThrow("Not started in this test.");

    const environment = launched[0]?.environment ?? {};
    const names = Object.keys(environment).map((name) => name.toUpperCase());
    expect(names).not.toContain("BLENDER_SYSTEM_SCRIPTS");
    expect(names).not.toContain("PXR_PLUGINPATH_NAME");
    expect(names).not.toContain("MATERIALX_SEARCH_PATH");
    expect(names).not.toContain("GITHUB_TOKEN");
    // Windows matches variable names without case.
    expect(
      Object.entries(environment).find(
        ([name]) => name.toUpperCase() === "SYSTEMROOT",
      )?.[1],
    ).toBe("C:\\Windows");
  });

  it("confines Blender: it reads its installation, its settings and a copy of the session script, changes only its working folders and the workspace, and has no internet", async () => {
    const { directory, program, launch, options, launched, confinements } =
      await setUp();

    await expect(launch(options)).rejects.toThrow("Not started in this test.");

    const [confinement] = confinements;
    const own = (name: string) => join(options.directory, name);
    expect(confinement?.purpose).toBe("blender");
    expect(confinement?.network).toBe(false);
    expect(confinement?.home).toBe(own("home"));
    // Its settings, scripts and add-ons are read at start, so it may not
    // change them; nothing else it may change is read at start.
    expect([...(confinement?.write ?? [])].sort()).toEqual(
      [
        own("cache"),
        own("previews"),
        own("pictures"),
        options.workspace,
      ].sort(),
    );
    // What a script's card says it can change, "any file in the workspace,
    // and nothing else of yours", rests on this: everything else it may
    // change is inside the conversation's own folder, which is Zhiyin's.
    for (const folder of confinement?.write ?? [])
      expect(
        folder === options.workspace ||
          folder.startsWith(`${options.directory}\\`),
        folder,
      ).toBe(true);
    expect(confinement?.read).toContain(options.directory);
    const copy =
      confinement?.read.find(
        (folder) => folder !== program && folder !== options.directory,
      ) ?? "";
    expect(confinement?.read).toEqual(expect.arrayContaining([program, copy]));
    expect(copy.startsWith(`${join(directory, "scripts")}\\`)).toBe(true);
    expect(await readFile(join(copy, "start.py"), "utf8")).toBe("the start");
    expect(await readFile(join(copy, "zhiyin_studio", "main.py"), "utf8")).toBe(
      "the session",
    );
    // Blender runs the copy, confined as asked.
    expect(launched[0]?.arguments).toContain(join(copy, "start.py"));
    expect(launched[0]?.confined).toEqual({ purpose: "blender" });
  });

  it("starts on empty settings, whatever an earlier start left in them", async () => {
    const { launch, options, launched } = await setUp();
    const planted = join(
      options.directory,
      "blender-settings",
      "scripts",
      "addons",
      "modules",
      "io_curve_svg",
    );
    await mkdir(planted, { recursive: true });
    await writeFile(join(planted, "__init__.py"), "planted");

    await expect(launch(options)).rejects.toThrow("Not started in this test.");

    const environment = launched[0]?.environment ?? {};
    const scripts = environment["BLENDER_USER_SCRIPTS"] ?? "";
    expect(
      scripts.startsWith(join(options.directory, "blender-settings")),
    ).toBe(true);
    expect(await readdir(scripts)).toEqual([]);
  });

  it("starts nothing when the workspace cannot be given to Blender, and says why", async () => {
    const { directory, options } = await setUp();
    const launched: ContainedProcessOptions[] = [];
    const launch = containedSessionLaunch(
      {
        open: () => ({
          launch: (given: ContainedProcessOptions) => {
            launched.push(given);
            throw new Error("Not started in this test.");
          },
          close: () => {},
        }),
      } as unknown as ProcessContainment,
      {
        scripts: join(directory, "scripts"),
        confine: async () => {
          throw new Error("C:\\ is a whole drive, which is never given.");
        },
      },
    );

    await expect(launch(options)).rejects.toThrow(
      "C:\\ is a whole drive, which is never given.",
    );
    expect(launched).toEqual([]);
  });

  it("runs a session script that changed from a new copy", async () => {
    const { launch, options, confinements } = await setUp();
    await expect(launch(options)).rejects.toThrow();
    await writeFile(options.script, "the start, changed");

    await expect(launch(options)).rejects.toThrow();

    const copies = confinements.map(
      (confinement) =>
        confinement.read.find((folder) => folder.includes("scripts")) ?? "",
    );
    expect(copies[0]).not.toBe(copies[1]);
    expect(await readFile(join(copies[1]!, "start.py"), "utf8")).toBe(
      "the start, changed",
    );
  });
});
