/**
 * Vitest's global setup: the programs some tests need, installed as the app
 * installs them, when `ZHIYIN_TEST_TOOLS` names a folder to keep them in.
 *
 * Typst, Tectonic, uv and Blender are downloaded once from their pinned
 * addresses, verified against their pinned digests, and installed there; the
 * tests that need one are told where it is. A variable already set is left as
 * it is. CI names a folder, so its gate runs those tests; without one they
 * skip, and the run says so.
 *
 * A machine with no graphics driver, as CI's is, asks for software OpenGL
 * (`ZHIYIN_TEST_SOFTWARE_OPENGL`): Mesa's llvmpipe, pinned and verified as the
 * programs are, is put beside the test Blender, which then draws EEVEE on the
 * processor. Only that Blender has it; a Blender a test installs itself does
 * not, and stands for a PC without a driver.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
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
 * Mesa's OpenGL for Windows, from mesa-dist-win: `opengl32.dll` loads the
 * Gallium driver beside it, and `GALLIUM_DRIVER` names llvmpipe, the one that
 * needs nothing else from the archive.
 */
const softwareOpengl = {
  url: "https://github.com/pal1000/mesa-dist-win/releases/download/26.2.4/mesa3d-26.2.4-release-msvc.7z",
  sha256: "351fc8c8b695878ffb3eaa044b3ead08672a48b1a045e3c3e3975811df0f6695",
  files: ["x64/opengl32.dll", "x64/libgallium_wgl.dll"],
};

/** Puts Mesa's llvmpipe beside `blender`, from an archive kept in `archives`. */
async function drawsInSoftware(archives, blender) {
  const kept = await archive(archives, softwareOpengl.url);
  const digest = createHash("sha256")
    .update(await readFile(kept))
    .digest("hex");
  if (digest !== softwareOpengl.sha256)
    throw new Error(`${basename(kept)} is not the archive pinned: ${digest}.`);
  const unpacked = join(archives, "mesa");
  await mkdir(unpacked, { recursive: true });
  // Windows' own tar reads 7z archives.
  await promisify(execFile)(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    ["-xf", kept, "-C", unpacked, ...softwareOpengl.files],
  );
  for (const file of softwareOpengl.files)
    await copyFile(
      join(unpacked, file),
      join(dirname(blender), basename(file)),
    );
  process.env.GALLIUM_DRIVER = "llvmpipe";
}

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
  const installed = new Set();
  for (const [id, variable] of Object.entries(variables)) {
    if (process.env[variable]) continue;
    await toolchains.install(id);
    process.env[variable] = await toolchains.executable(id);
    installed.add(id);
  }
  // Only into the Blender installed here: one named from outside is left as
  // it is. A kept install not asked to draw in software draws as the PC does.
  if (installed.has("blender")) {
    const blender = process.env.ZHIYIN_BLENDER;
    if (process.env.ZHIYIN_TEST_SOFTWARE_OPENGL)
      await drawsInSoftware(archives, blender);
    else
      for (const file of softwareOpengl.files)
        await rm(join(dirname(blender), basename(file)), { force: true });
  }
  if (!process.env.ZHIYIN_BLENDER_ARCHIVE) {
    const blender = pinnedToolchains.find(({ id }) => id === "blender");
    process.env.ZHIYIN_BLENDER_ARCHIVE = await archive(archives, blender.url);
  }
}
