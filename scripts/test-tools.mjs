/**
 * Vitest's global setup: the programs some tests need, installed as the app
 * installs them, when `ZHIYIN_TEST_TOOLS` names a folder to keep them in.
 *
 * Typst, Tectonic, uv and Blender are downloaded once from their pinned
 * addresses, verified against their pinned digests, and installed there; the
 * tests that need one are told where it is. A variable already set is left as
 * it is. CI names a folder, so its gate runs those tests; without one they
 * skip, and the run says so.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { compiledBlenderPython } from "@zhiyin/blender-studio";
import { openProcessContainer } from "@zhiyin/process-ownership";
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
  blender: "ZHIYIN_BLENDER",
};

/**
 * The archive at a pinned address, downloaded once into `folder`. The install
 * verifies it, and the Blender install test reads Blender's.
 */
async function archive(folder, url, signal) {
  const kept = join(
    folder,
    decodeURIComponent(basename(new URL(url).pathname)),
  );
  if (
    await stat(kept).then(
      () => true,
      () => false,
    )
  )
    return kept;
  const partial = `${kept}.partial`;
  await pipeline(
    Readable.from(await fetchDownload(url, signal)),
    createWriteStream(partial),
  );
  await rename(partial, kept);
  return kept;
}

export default async function setup() {
  const folder = process.env.ZHIYIN_TEST_TOOLS;
  if (!folder) return;
  const archives = join(folder, "archives");
  await mkdir(archives, { recursive: true });
  const toolchains = new DownloadedToolchains({
    directory: folder,
    specs: pinnedToolchains,
    download: async (url, signal) =>
      createReadStream(await archive(archives, url, signal)),
    ready: {
      blender: compiledBlenderPython({
        containment: { open: openProcessContainer },
      }),
    },
  });
  for (const [id, variable] of Object.entries(variables)) {
    if (process.env[variable]) continue;
    await toolchains.install(id);
    process.env[variable] = await toolchains.executable(id);
  }
  if (!process.env.ZHIYIN_BLENDER_ARCHIVE) {
    const blender = pinnedToolchains.find(({ id }) => id === "blender");
    process.env.ZHIYIN_BLENDER_ARCHIVE = await archive(archives, blender.url);
  }
}
