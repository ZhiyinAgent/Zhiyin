/**
 * Starts for real-Blender tests on a kept graphics driver cache. A Blender's
 * first start in a new conversation folder draws its warm-up picture with
 * EEVEE, whose shaders the graphics driver compiles into a cache in the folder
 * of the conversation's app container: on an NVIDIA card, about 13 seconds.
 * Every test file makes new conversation folders, so each would pay that.
 *
 * A session launch made with `withKeptGlCache` copies a cache kept for the
 * tests, one per Blender executable in a folder beside the test folders, into
 * a new container's folder before Blender starts, and keeps the cache a
 * session leaves once it has ended, when it differs from the one kept. The
 * cache holds only compiled shaders: a start without it, or on one the driver
 * no longer reads, compiles them again and is otherwise the same, so a start
 * whose copy cannot be made runs as it would without one.
 */

import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { confine as confineProgram } from "@zhiyin/sandbox";
import type { containedSessionLaunch } from "../src/index.js";

type SessionLaunchFactory = typeof containedSessionLaunch;

/** Where the caches are kept between test runs, unless a test names another. */
export const keptGlCaches = join(tmpdir(), "zhiyin-test-gl-cache");

/**
 * `launchWith`, here `containedSessionLaunch`, whose sessions start on the
 * kept cache and keep the one they leave.
 */
export function withKeptGlCache(
  launchWith: SessionLaunchFactory,
  kept: string = keptGlCaches,
): SessionLaunchFactory {
  return (containment, options) => async (launchOptions) => {
    const cache = join(kept, cacheName(launchOptions.executable));
    const confine = options.confine ?? confineProgram;
    let home: string | undefined;
    const launch = launchWith(containment, {
      ...options,
      // The container's folder is made as its folders are granted; the copy
      // goes in after, so it inherits the grants, and before Blender starts.
      confine: async (confinement) => {
        const confined = await confine(confinement);
        home = confinement.home;
        await seed(cache, home).catch(() => {});
        return confined;
      },
    });
    const session = await launch(launchOptions);
    return {
      ...session,
      ended: session.ended.then(async () => {
        if (home !== undefined) await keep(home, cache).catch(() => {});
      }),
    };
  };
}

/** One kept cache per Blender executable: another version compiles others. */
function cacheName(executable: string): string {
  return createHash("sha256")
    .update(resolve(executable).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/**
 * The graphics driver's cache in a home's container folder, or nothing while
 * the home holds no container folder or more than one.
 */
async function glCacheOf(home: string): Promise<string | undefined> {
  const packages = join(home, "AppData", "Local", "Packages");
  const containers: string[] = [];
  for (const name of await readdir(packages).catch(() => [])) {
    const folder = await stat(join(packages, name, "AC")).catch(
      () => undefined,
    );
    if (folder?.isDirectory()) containers.push(name);
  }
  const [only, ...others] = containers;
  return only !== undefined && others.length === 0
    ? join(packages, only, "AC", "NVIDIA", "GLCache")
    : undefined;
}

type Listing = readonly {
  readonly name: string;
  readonly size: number;
  readonly changed: number;
}[];

/** Each file in a folder by its path in it, with its size and when it changed. */
async function listing(folder: string): Promise<Listing | undefined> {
  const names = await readdir(folder, { recursive: true }).catch(
    () => undefined,
  );
  if (names === undefined) return undefined;
  const files = [];
  for (const name of names.sort()) {
    const found = await stat(join(folder, name)).catch(() => undefined);
    if (found?.isFile())
      files.push({ name, size: found.size, changed: found.mtimeMs });
  }
  return files;
}

/** The files' names and sizes, which a cache's contents differ by. */
const sizesOf = (files: Listing | undefined) =>
  JSON.stringify((files ?? []).map(({ name, size }) => [name, size]));

/** Copies the kept cache into a container folder that holds none yet. */
async function seed(cache: string, home: string): Promise<void> {
  const target = await glCacheOf(home);
  if (target === undefined) return;
  if (await stat(target).catch(() => undefined)) return;
  if (!(await stat(cache).catch(() => undefined))) return;
  const making = join(dirname(target), `.seeding-${randomUUID()}`);
  try {
    await mkdir(dirname(target), { recursive: true });
    await cp(cache, making, { recursive: true, preserveTimestamps: true });
    await rename(making, target);
  } catch {
    await rm(making, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Keeps the cache a home's container holds when its files or their sizes
 * differ from the kept one's. Another Blender in the same home may still be
 * writing to it: a copy during which it changed is not kept.
 */
async function keep(home: string, cache: string): Promise<void> {
  const left = await glCacheOf(home);
  if (left === undefined) return;
  const before = await listing(left);
  if (before === undefined || before.length === 0) return;
  if (sizesOf(before) === sizesOf(await listing(cache))) return;
  const making = join(dirname(cache), `.making-${randomUUID()}`);
  const old = join(dirname(cache), `.old-${randomUUID()}`);
  try {
    await mkdir(dirname(cache), { recursive: true });
    await cp(left, making, { recursive: true, preserveTimestamps: true });
    if (JSON.stringify(before) !== JSON.stringify(await listing(left))) return;
    await rename(cache, old).catch(() => {});
    await rename(making, cache);
  } catch {
    // The cache stays as it was kept, or none is kept until a later session.
  } finally {
    await rm(making, { recursive: true, force: true }).catch(() => {});
    await rm(old, { recursive: true, force: true }).catch(() => {});
  }
}
