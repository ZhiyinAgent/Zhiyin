/**
 * Vitest's global setup: the programs some tests need, installed as the app
 * installs them, when `ZHIYIN_TEST_TOOLS` names a folder to keep them in.
 *
 * Zhiyin's shell, busybox-w32, is named in `ZHIYIN_BUSYBOX` when its pinned
 * build is where the app takes it from; the gate builds it first.
 *
 * Typst, Tectonic, uv and Node are downloaded once from their pinned addresses,
 * verified against their pinned digests, and installed there; the tests that
 * need one are told where it is. Blender's archive is downloaded too, for the
 * test that installs it, but no Blender is installed for the tests that run
 * one: they need a graphics card, and are run where `ZHIYIN_BLENDER` names a
 * Blender on a PC that has one. A variable already set is left as it is. CI
 * names a folder, so its gate runs those tests; without one they skip, and
 * the run says so.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DownloadedToolchains,
  fetchDownload,
  pinnedToolchains,
} from "@zhiyin/toolchains";

/** By program id, the variable that tells a test where the program is. */
const variables = {
  typst: "ZHIYIN_TYPST",
  tectonic: "ZHIYIN_TECTONIC",
  uv: "ZHIYIN_UV",
  node: "ZHIYIN_NODE",
};

/**
 * The archive at a pinned address, downloaded once into `folder`. The install
 * verifies it, and the Blender install test reads Blender's.
 */
async function archive(folder, url, fetch, signal) {
  const kept = keptAt(folder, url);
  if (
    await stat(kept).then(
      () => true,
      () => false,
    )
  )
    return kept;
  const partial = `${kept}.partial`;
  await pipeline(
    Readable.from(await fetch(url, signal)),
    createWriteStream(partial),
  );
  await rename(partial, kept);
  return kept;
}

/** Where the archive at a pinned address is kept. */
function keptAt(folder, url) {
  return join(folder, decodeURIComponent(basename(new URL(url).pathname)));
}

/**
 * Installs into `folder` each of `specs` that a test needs and `env` does not
 * already name, fetching with `fetch`, and names each in `env`; and keeps
 * Blender's archive when it is among them.
 */
export async function prepareTestTools({ folder, specs, fetch, env }) {
  const archives = join(folder, "archives");
  await mkdir(archives, { recursive: true });
  const toolchains = new DownloadedToolchains({
    directory: folder,
    specs,
    download: async (url, signal) =>
      createReadStream(await archive(archives, url, fetch, signal)),
  });
  for (const { id, sources } of specs) {
    const variable = variables[id];
    if (!variable || env[variable]) continue;
    await toolchains.install(id).catch(async () => {
      // A kept archive the install refused, such as one an older pin left
      // under the same name, is fetched again once.
      for (const { url } of sources)
        await rm(keptAt(archives, url), { force: true });
      await toolchains.install(id);
    });
    env[variable] = await toolchains.executable(id);
  }
  const blender = specs.find(({ id }) => id === "blender");
  if (blender && !env.ZHIYIN_BLENDER_ARCHIVE)
    env.ZHIYIN_BLENDER_ARCHIVE = await archive(
      archives,
      blender.sources[0].url,
      fetch,
    );
}

/**
 * Names Zhiyin's shell in `ZHIYIN_BUSYBOX` when the folder the app takes it
 * from holds the pinned build, which the gate makes before the tests.
 */
async function nameShell(env) {
  if (env.ZHIYIN_BUSYBOX) return;
  const { builtFiles } = await import("./busybox.mjs");
  const { misplacedFiles } = await import("./verified-files.mjs");
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const pins = JSON.parse(
    await readFile(join(repository, "scripts", "busybox", "pins.json"), "utf8"),
  );
  const folder = join(repository, "apps", "desktop", "busybox");
  const misplaced = await misplacedFiles({
    files: builtFiles.map((file) => ({ file, sha256: pins.built[file] })),
    folder,
  });
  if (!misplaced.length) env.ZHIYIN_BUSYBOX = folder;
}

export default async function setup() {
  await nameShell(process.env);
  const folder = process.env.ZHIYIN_TEST_TOOLS;
  if (!folder) return;
  await prepareTestTools({
    folder,
    specs: pinnedToolchains,
    fetch: fetchDownload,
    env: process.env,
  });
}
