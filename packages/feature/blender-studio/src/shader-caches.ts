/**
 * The shaders the NVIDIA graphics driver compiles for Blender's warm-up
 * picture, kept for every new conversation (ADR 0032). A Blender's first
 * start in a new container compiles them into the container's own folder,
 * about 14 seconds on an RTX 4070 Ti SUPER; started on a copy of a cache
 * that already holds them, it skips that work.
 *
 * One cache is kept for each Blender, by its executable's contents, and
 * graphics driver version, in a folder of Zhiyin's own. Only a Blender
 * started for that alone makes it, in a container and folder new for it and
 * removed after: it draws Zhiyin's warm-up picture and runs nothing else, so
 * nothing a conversation ran is ever in what another receives. A conversation's
 * container is given a copy, never the kept folder itself, and only before
 * its first Blender has made a driver folder of its own.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { forgetConfinement } from "@zhiyin/sandbox";
import { sessionHome } from "./session-process.js";

export type KeptShaderCachesOptions = {
  /** Where the kept caches are, in Zhiyin's data, outside every conversation's folder. */
  readonly directory: string;
  /** The version of this PC's NVIDIA graphics driver, or nothing on a PC without one. */
  readonly driver: () => Promise<string | undefined>;
  /**
   * How long a made cache must stay unchanged before it is kept, the driver
   * writing it on its own time: a second unless a test sets it.
   */
  readonly quietMs?: number;
};

/**
 * What a start was given: a copy of the kept cache, or none, and then the
 * cache that would match it when none is kept yet.
 */
export type Seeding =
  | { readonly copied: true }
  | { readonly copied: false; readonly missing?: string };

/**
 * Starts a Blender in `directory`, a folder new for it, that draws the
 * warm-up picture as a session's start does; settles once it is ready, on
 * whether it drew on the graphics card, with a way to end it.
 */
export type DrawWarmUp = (directory: string) => Promise<{
  readonly drew: boolean;
  end(): Promise<void>;
}>;

/** The folders the make's Blenders run in, beside the kept caches. */
const makingFolder = "making";

/** The longest a made cache is waited for to stay unchanged. */
const longestWaitMs = 30_000;

/** Each file in a folder by its path in it, with its size, in order. */
async function listing(folder: string): Promise<string> {
  const names = await readdir(folder, { recursive: true }).catch(() => []);
  const files: [string, number][] = [];
  for (const name of names.sort()) {
    const found = await stat(join(folder, name)).catch(() => undefined);
    if (found?.isFile()) files.push([name, found.size]);
  }
  return JSON.stringify(files);
}

/**
 * The listing of the files in `folder` once it has stayed the same for
 * `quietMs` and holds a file, or nothing when it has not within the longest
 * wait.
 */
async function quietListing(
  folder: string,
  quietMs: number,
): Promise<string | undefined> {
  const until = Date.now() + longestWaitMs;
  let before = await listing(folder);
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, quietMs));
    const now = await listing(folder);
    if (now === before && now !== "[]") return now;
    before = now;
  }
  return undefined;
}

/**
 * The folder Windows gives a home's app container, or nothing while the
 * home holds no container folder or more than one. A link is not one.
 */
async function containerFolder(home: string): Promise<string | undefined> {
  const packages = join(home, "AppData", "Local", "Packages");
  const found: string[] = [];
  for (const entry of await readdir(packages, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!entry.isDirectory()) continue;
    const folder = join(packages, entry.name, "AC");
    if ((await lstat(folder).catch(() => undefined))?.isDirectory())
      found.push(folder);
  }
  const [only, ...others] = found;
  return others.length === 0 ? only : undefined;
}

/** NVIDIA's folder in a container's folder, which holds its shader cache. */
const nvidiaFolder = (container: string) => join(container, "NVIDIA");
const shaderCache = (container: string) =>
  join(nvidiaFolder(container), "GLCache");

/**
 * Copies the folders and files in `from` into `to`, which it makes, and
 * counts the files. Links and anything else that is not a plain file or
 * folder are left out.
 */
async function copyFiles(from: string, to: string): Promise<number> {
  await mkdir(to);
  let files = 0;
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) files += await copyFiles(source, target);
    else if (entry.isFile()) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      files += 1;
    }
  }
  return files;
}

const removed = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});

/** A file's SHA-256, read as a stream. */
async function contentHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The shader caches kept for new conversations' Blenders. */
export class KeptShaderCaches {
  readonly #options: KeptShaderCachesOptions;
  /** Each executable's contents, by its path, size and time of change. */
  readonly #contents = new Map<string, Promise<string>>();
  /** The caches whose making has been tried in this run of the app. */
  readonly #tried = new Set<string>();
  #making: Promise<void> = Promise.resolve();
  #cleared = false;

  constructor(options: KeptShaderCachesOptions) {
    this.#options = options;
  }

  /**
   * Copies the cache kept for `executable` and this PC's driver into the
   * container folder of `home`, before a Blender starts there, when that
   * container holds no driver folder yet. A container with a folder of its
   * own, a PC without an NVIDIA driver, or a copy that fails leaves the start
   * as it is without one.
   */
  async seed(home: string, executable: string): Promise<Seeding> {
    const container = await containerFolder(home);
    if (container === undefined) return { copied: false };
    const nvidia = nvidiaFolder(container);
    if (await lstat(nvidia).catch(() => undefined)) return { copied: false };
    const name = await this.#name(executable);
    if (name === undefined) return { copied: false };
    const kept = join(this.#options.directory, name);
    if (!(await stat(kept).catch(() => undefined))?.isDirectory())
      return { copied: false, missing: name };
    const copying = join(nvidia, `.copying-${randomUUID()}`);
    try {
      // Made here, not found: a folder that appeared meanwhile is the
      // container's own, and nothing is copied into it.
      await mkdir(nvidia);
      await copyFiles(kept, copying);
      await rename(copying, shaderCache(container));
      return { copied: true };
    } catch {
      await removed(copying);
      return { copied: false };
    }
  }

  /**
   * Makes the cache `name` in the background, with a Blender `draw` starts
   * in a folder new for it; once in this run of the app for each cache, one
   * at a time. What that Blender's container holds once it drew is kept, in
   * place of every cache kept before.
   */
  make(name: string, draw: DrawWarmUp): void {
    if (this.#tried.has(name)) return;
    this.#tried.add(name);
    this.#making = this.#making.then(() =>
      this.#make(name, draw).catch(() => {}),
    );
  }

  /** Settles once every making asked for so far has ended. */
  settled(): Promise<void> {
    return this.#making;
  }

  async #make(name: string, draw: DrawWarmUp): Promise<void> {
    const directory = this.#options.directory;
    const throwaways = join(directory, makingFolder);
    if (!this.#cleared) {
      this.#cleared = true;
      // What a making left when the app ended during it.
      for (const left of await readdir(throwaways).catch(() => [])) {
        await removed(join(throwaways, left));
        forgetConfinement("blender", sessionHome(join(throwaways, left)));
      }
    }
    // A short name: Blender cannot use paths past 260 characters, so neither
    // can its driver, and `making\` and eight characters are shorter than a
    // conversation's folder, so the cache is made wherever a conversation's
    // own would be.
    const folder = join(throwaways, randomUUID().slice(0, 8));
    const keeping = join(directory, `.keeping-${randomUUID()}`);
    let drawing: Awaited<ReturnType<DrawWarmUp>> | undefined;
    try {
      await mkdir(folder, { recursive: true });
      drawing = await draw(folder);
      if (!drawing.drew) return;
      const container = await containerFolder(sessionHome(folder));
      if (container === undefined) return;
      // The driver writes the cache on its own time, and holds its files
      // while Blender runs: once the cache has stayed the same, Blender is
      // ended, and the cache is kept only as it was copied.
      const cache = shaderCache(container);
      const quietMs = this.#options.quietMs ?? 1_000;
      if ((await quietListing(cache, quietMs)) === undefined) return;
      await drawing.end();
      const written = await listing(cache);
      await copyFiles(cache, keeping);
      if (written === "[]" || (await listing(cache)) !== written) return;
      await rename(keeping, join(directory, name));
      // A cache for another Blender or driver no longer matches any start.
      for (const entry of await readdir(directory))
        if (entry !== name && entry !== makingFolder)
          await removed(join(directory, entry));
    } finally {
      await drawing?.end();
      await removed(keeping);
      await removed(folder);
      forgetConfinement("blender", sessionHome(folder));
    }
  }

  /**
   * The kept cache's name for `executable` on this PC's driver: the
   * driver's version and the executable's contents. Nothing without an
   * NVIDIA driver, or when either cannot be read.
   */
  async #name(executable: string): Promise<string | undefined> {
    const [driver, contents] = await Promise.all([
      this.#options.driver().catch(() => undefined),
      this.#contentsOf(executable).catch(() => undefined),
    ]);
    if (driver === undefined || contents === undefined) return undefined;
    const version = driver.replace(/[^0-9A-Za-z.+-]+/g, "_").slice(0, 64);
    return `nvidia-${version}-blender-${contents.slice(0, 16)}`;
  }

  async #contentsOf(executable: string): Promise<string> {
    const { size, mtimeMs } = await stat(executable);
    const known = `${executable}|${size}|${mtimeMs}`;
    let contents = this.#contents.get(known);
    if (!contents) {
      contents = contentHash(executable);
      this.#contents.set(known, contents);
      contents.catch(() => this.#contents.delete(known));
    }
    return contents;
  }
}
