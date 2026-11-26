/**
 * Real-Blender tests' starts on a kept graphics driver cache, against the
 * real session launch with a stand-in container: the cache kept is copied
 * into a new container's folder before Blender starts, a container folder's
 * own cache is left as it is, the cache a session leaves is kept once it ends
 * when it differs, and a start whose copy cannot be made runs without one.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Confined,
  Confinement,
  ProcessContainment,
} from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { containedSessionLaunch } from "../src/session-process.js";
import { withKeptGlCache } from "./kept-gl-cache.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** The driver's cache in the container folder the stand-in confinement makes. */
const glCache = (directory: string) =>
  join(
    directory,
    "home",
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

/**
 * A Blender that, as it starts, notes the cache it finds and writes the files
 * given into it, as the driver does; it ends when told to.
 */
async function setUp(kept?: string) {
  const root = await folders.make("zhiyin-kept-gl-cache-");
  const program = join(root, "blender");
  await mkdir(program);
  await writeFile(join(program, "blender.exe"), "");
  const session = join(root, "session");
  await mkdir(session);
  await writeFile(join(session, "start.py"), "the start");
  let starting: { directory: string; writes: readonly string[] } | undefined;
  const found: string[][] = [];
  // Closing the container ends the Blender in it, as it does for a real one.
  let close = () => {};
  const containment = {
    open: () => ({
      launch: () => {
        const { directory, writes } = starting!;
        const ended = new Promise<void>((resolve) => (close = resolve));
        const started = (async () => {
          found.push(await filesIn(glCache(directory)));
          await mkdir(glCache(directory), { recursive: true });
          for (const name of writes)
            await writeFile(join(glCache(directory), name), name);
        })();
        return {
          pipes: {
            fromProcess: Readable.from([]),
            toProcess: new PassThrough(),
          },
          wait: async () => {
            await started;
            await ended;
          },
        };
      },
      close: () => close(),
    }),
  } as unknown as ProcessContainment;
  const launch = withKeptGlCache(
    containedSessionLaunch,
    kept ?? join(root, "kept"),
  )(containment, {
    scripts: join(root, "scripts"),
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
  /** Starts a Blender in a conversation folder, then ends it. */
  const run = async (conversation: string, writes: readonly string[]) => {
    const directory = join(root, conversation);
    starting = { directory, writes };
    const process = await launch({
      executable: join(program, "blender.exe"),
      script: join(session, "start.py"),
      directory,
      workspace: join(root, "workspace"),
    });
    process.end();
    await process.ended;
    return found.at(-1);
  };
  return { root, run };
}

describe("starts for real-Blender tests on a kept graphics driver cache", () => {
  it("starts the first Blender on no cache, and the next conversation's on the one it left", async () => {
    const { run } = await setUp();

    expect(await run("first", ["a.bin", "a.toc"])).toEqual([]);
    expect(await run("second", [])).toEqual(["a.bin", "a.toc"]);
  });

  it("leaves a container folder's own cache as it is", async () => {
    const { root, run } = await setUp();
    await run("first", ["a.bin"]);
    await mkdir(glCache(join(root, "own")), { recursive: true });
    await writeFile(join(glCache(join(root, "own")), "own.bin"), "own");

    expect(await run("own", [])).toEqual(["own.bin"]);
  });

  it("keeps the cache a later session leaves when it holds more", async () => {
    const { run } = await setUp();
    await run("first", ["a.bin"]);
    await run("second", ["b.bin"]);

    expect(await run("third", [])).toEqual(["a.bin", "b.bin"]);
  });

  it("starts without a cache when the kept one cannot be read", async () => {
    const root = await folders.make("zhiyin-kept-gl-cache-file-");
    const notAFolder = join(root, "kept");
    await writeFile(notAFolder, "not a folder");
    const { run } = await setUp(notAFolder);

    expect(await run("first", ["a.bin"])).toEqual([]);
    expect(await run("second", [])).toEqual([]);
  });
});
