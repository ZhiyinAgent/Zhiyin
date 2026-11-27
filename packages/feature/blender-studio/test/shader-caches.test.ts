/**
 * New conversations' Blenders start on the shader cache kept for their
 * Blender and graphics driver, against the real session launch with a
 * stand-in container and Blender: the cache kept is the one a Blender of
 * Zhiyin's own leaves after drawing the warm-up picture, never what a
 * conversation's Blender leaves; it is copied into a new container before
 * Blender starts; and whatever fails, a start goes on as it would without one.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Confined,
  Confinement,
  ContainedProcessOptions,
  ProcessContainment,
} from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { KeptShaderCaches } from "../src/shader-caches.js";
import { containedSessionLaunch } from "../src/session-process.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** The driver's cache in the container folder the stand-in confinement makes in a home. */
const glCacheIn = (home: string) =>
  join(
    home,
    "AppData",
    "Local",
    "Packages",
    "Zhiyin.blender.test",
    "AC",
    "NVIDIA",
    "GLCache",
  );

const filesIn = async (folder: string) =>
  (await readdir(folder, { recursive: true }).catch(() => [])).sort();

/** Each file in a cache, by its name, with what it holds. */
async function cacheIn(folder: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of await filesIn(folder))
    files[name] = await readFile(join(folder, name), "utf8");
  return files;
}

/** One Blender the stand-in started: how, where, and the cache it found. */
type Start = {
  readonly arguments: readonly string[];
  readonly home: string;
  found: Record<string, string>;
};

/** What the stand-in's warm-up leaves in the cache. */
const warmUp = { "warm-up.bin": "the warm-up's" };

/**
 * A stand-in Blender, a container and kept caches. As it draws its warm-up
 * picture the stand-in writes the shaders it compiles into its container's
 * cache, as the driver does; a conversation's Blender then writes what its
 * own work leaves, `leaves`. The Blender making the kept cache says whether
 * it drew with EEVEE, `drew`, and its driver may write a file `late`, a
 * moment after it said it was ready.
 */
async function setUp(
  settings: {
    driver?: () => Promise<string | undefined>;
    drew?: boolean;
    kept?: string;
    late?: string;
  } = {},
) {
  const root = await folders.make("zhiyin-shader-caches-");
  const kept = settings.kept ?? join(root, "kept");
  const program = join(root, "blender");
  await mkdir(program);
  const executable = join(program, "blender.exe");
  await writeFile(executable, "Blender 5.2.2");
  const session = join(root, "session");
  await mkdir(session);
  await writeFile(join(session, "start.py"), "the start");
  const starts: Start[] = [];
  /** What each conversation's Blender leaves, by its home. */
  const leaves = new Map<string, readonly string[]>();
  const containment = {
    open: () => {
      let close = () => {};
      const closed = new Promise<void>((resolve) => (close = resolve));
      return {
        launch: (options: ContainedProcessOptions) => {
          const start: Start = {
            arguments: options.arguments,
            home: options.cwd,
            found: {},
          };
          starts.push(start);
          const cache = glCacheIn(options.cwd);
          const leaving = leaves.get(options.cwd) ?? [];
          const making = options.cwd.startsWith(join(kept, "making"));
          async function* said() {
            start.found = await cacheIn(cache);
            if (options.arguments.includes("--warm")) {
              yield '{"warming": true}\n';
              await mkdir(cache, { recursive: true });
              for (const [name, holds] of Object.entries(warmUp))
                await writeFile(join(cache, name), holds);
            }
            for (const name of leaving)
              await writeFile(join(cache, name), "a conversation's own");
            const late = settings.late;
            if (making && late !== undefined)
              setTimeout(
                () =>
                  void writeFile(join(cache, late), "written late").catch(
                    () => {},
                  ),
                100,
              );
            const eevee = making ? (settings.drew ?? true) : true;
            yield `{"ready": true, "eevee": ${eevee}}\n`;
            await closed;
          }
          const lines = Readable.from(said());
          const ended = new Promise<void>((resolve) =>
            lines.on("close", resolve),
          );
          return {
            pipes: { fromProcess: lines, toProcess: new PassThrough() },
            wait: async () => {
              await Promise.race([ended, closed]);
            },
          };
        },
        close: () => close(),
      };
    },
  } as unknown as ProcessContainment;
  const caches = new KeptShaderCaches({
    directory: kept,
    driver: settings.driver ?? (async () => "32.0.16.1088"),
    // Longer than the stand-in driver takes to write a file late.
    quietMs: 250,
  });
  const launch = containedSessionLaunch(containment, {
    scripts: join(root, "scripts"),
    shaderCaches: caches,
    confine: async (confinement: Confinement) => {
      await mkdir(
        join(
          confinement.home,
          "AppData",
          "Local",
          "Packages",
          "Zhiyin.blender.test",
          "AC",
          "Temp",
        ),
        { recursive: true },
      );
      return { purpose: confinement.purpose } as Confined;
    },
  });
  /**
   * Starts a conversation's Blender until it is ready, then ends it, and
   * gives the cache it found as it started.
   */
  const run = async (
    conversation: string,
    options: { leaving?: readonly string[]; processor?: true } = {},
  ) => {
    const directory = join(root, "conversations", conversation);
    const home = join(directory, "home");
    leaves.set(home, options.leaving ?? []);
    const process = await launch({
      executable,
      script: join(session, "start.py"),
      directory,
      workspace: join(root, "workspace"),
      ...(options.processor
        ? { processor: true as const }
        : { warm: join(directory, "previews", "warm.jpg") }),
    });
    for (;;) {
      const line = await process.next();
      if (line === undefined) throw new Error("Blender ended as it started.");
      if (line.includes('"ready"')) break;
    }
    process.end();
    await process.ended;
    return starts.find((start) => start.home === home)!.found;
  };
  /** The Blenders started for no conversation, which make a kept cache. */
  const makes = () => starts.filter((s) => !leaves.has(s.home));
  const conversationHome = (conversation: string) =>
    join(root, "conversations", conversation, "home");
  return {
    root,
    executable,
    caches,
    run,
    makes,
    conversationHome,
    kept,
  };
}

describe("a new conversation's Blender and the kept shader cache", () => {
  it("starts the first conversation's Blender on none, then keeps what a Blender of Zhiyin's own leaves from its warm-up picture, which the next starts on", async () => {
    const { run, caches, makes } = await setUp();

    expect(await run("first")).toEqual({});
    await caches.settled();
    expect(await run("second")).toEqual(warmUp);

    expect(makes()).toHaveLength(1);
  });

  it("makes the kept cache in a folder and a container new for it, and removes them once it has drawn", async () => {
    const { root, run, caches, makes } = await setUp();

    await run("first");
    await caches.settled();

    const [make] = makes();
    expect(make?.found).toEqual({});
    expect(make?.arguments).toContain("--warm");
    expect(make?.home.startsWith(join(root, "conversations"))).toBe(false);
    expect(await stat(make!.home).catch(() => "removed")).toBe("removed");
  });

  it("keeps the cache only once the driver has finished writing it", async () => {
    const { run, caches } = await setUp({ late: "written-late.bin" });

    await run("first");
    await caches.settled();

    expect(await run("second")).toEqual({
      ...warmUp,
      "written-late.bin": "written late",
    });
  });

  it("never keeps what a conversation's own Blender leaves in its cache, and a conversation changes only its own copy", async () => {
    const { run, caches } = await setUp();

    await run("first", { leaving: ["first-conversation.bin"] });
    await caches.settled();
    expect(
      await run("second", { leaving: ["second-conversation.bin"] }),
    ).toEqual(warmUp);
    expect(await run("third")).toEqual(warmUp);
  });

  it("never keeps a conversation's own writing over the warm-up's shaders", async () => {
    const { run, caches } = await setUp();

    await run("first", { leaving: ["warm-up.bin"] });
    await caches.settled();
    expect(await run("second", { leaving: ["warm-up.bin"] })).toEqual(warmUp);
    expect(await run("third")).toEqual(warmUp);
  });

  it("makes the cache once for conversations that start together", async () => {
    const { run, caches, makes } = await setUp();

    await Promise.all([run("first"), run("second"), run("third")]);
    await caches.settled();

    expect(makes()).toHaveLength(1);
  });

  it("after a driver update finds no cache kept, starts as without one, and keeps a new one in place of the old", async () => {
    let driver = "32.0.16.1088";
    const { run, caches, makes, kept } = await setUp({
      driver: async () => driver,
    });
    await run("first");
    await caches.settled();
    const before = await readdir(kept);

    driver = "32.0.16.1100";
    expect(await run("after the update")).toEqual({});
    await caches.settled();
    expect(await run("next")).toEqual(warmUp);

    expect(makes()).toHaveLength(2);
    const after = (await readdir(kept)).filter((name) => name !== "making");
    expect(after).toHaveLength(1);
    expect(before).not.toContain(after[0]);
  });

  it("after Blender is updated, finds no cache kept for it and starts as without one", async () => {
    const { run, caches, executable } = await setUp();
    await run("first");
    await caches.settled();

    await writeFile(executable, "Blender 5.2.3, updated");

    expect(await run("after the update")).toEqual({});
  });

  it("on a PC without an NVIDIA driver, copies nothing and starts no Blender to make a cache", async () => {
    const { run, caches, makes } = await setUp({
      driver: async () => undefined,
    });

    expect(await run("first")).toEqual({});
    await caches.settled();
    expect(await run("second")).toEqual({});
    expect(makes()).toEqual([]);
  });

  it("starts as without a cache when the driver's version cannot be read", async () => {
    const { run, caches, makes } = await setUp({
      driver: () => Promise.reject(new Error("pnputil could not be run")),
    });

    expect(await run("first")).toEqual({});
    await caches.settled();
    expect(makes()).toEqual([]);
  });

  it("leaves a container's own driver cache as it is", async () => {
    const { run, caches, conversationHome } = await setUp();
    await run("first");
    await caches.settled();
    await mkdir(glCacheIn(conversationHome("own")), { recursive: true });
    await writeFile(join(glCacheIn(conversationHome("own")), "own.bin"), "own");

    expect(await run("own")).toEqual({ "own.bin": "own" });
  });

  it("starts as without a cache when the kept caches can be neither read nor written", async () => {
    const root = await folders.make("zhiyin-shader-caches-file-");
    const notAFolder = join(root, "kept");
    await writeFile(notAFolder, "not a folder");
    const { run, caches } = await setUp({ kept: notAFolder });

    expect(await run("first")).toEqual({});
    await caches.settled();
    expect(await run("second")).toEqual({});
  });

  it("keeps nothing when the Blender making the cache does not draw, and does not start it again in the app's run", async () => {
    const { run, caches, makes } = await setUp({ drew: false });

    await run("first");
    await caches.settled();
    expect(await run("second")).toEqual({});
    await caches.settled();

    expect(makes()).toHaveLength(1);
  });

  it("gives a Blender drawing on the processor no cache, and makes none for it", async () => {
    const { run, caches, makes } = await setUp();
    await run("first");
    await caches.settled();

    expect(await run("on the processor", { processor: true })).toEqual({});
    await caches.settled();
    expect(makes()).toHaveLength(1);
  });
});
