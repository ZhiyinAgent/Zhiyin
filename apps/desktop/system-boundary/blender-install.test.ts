// @vitest-environment node
/**
 * Blender, installed as the app installs it, from its real archive.
 *
 * A conversation's Blender cannot write in its own installation (ADR 0028),
 * so the compiled Python it starts on has to be there when the installation
 * is complete. This installs the pinned archive with the installer and the
 * compile step the composition gives it, and starts the installed Blender
 * once. It is skipped unless the archive is named in the environment, as CI's
 * gate names the one it downloads (`ZHIYIN_TEST_TOOLS`):
 *
 *   $env:ZHIYIN_BLENDER_ARCHIVE = "…\blender-5.2.2-windows-x64.zip"
 *   npx vitest run --project system-boundary apps/desktop/system-boundary/blender-install.test.ts
 */

import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compiledBlenderPython } from "@zhiyin/blender-studio";
import { openProcessContainer, runProcess } from "@zhiyin/process-ownership";
import { DownloadedToolchains, pinnedToolchains } from "@zhiyin/toolchains";

const archive = process.env["ZHIYIN_BLENDER_ARCHIVE"];
const containment = { open: openProcessContainer };

/** Every compiled file under a folder, with when it was written. */
async function compiledUnder(folder: string): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".pyc")) continue;
    const file = join(entry.parentPath, entry.name);
    found.set(file, (await stat(file)).mtimeMs);
  }
  return found;
}

describe.runIf(archive)("Blender, installed from its archive", () => {
  let directory: string | undefined;

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("holds its compiled Python when the installation is complete, and starts on it", async () => {
    directory = await mkdtemp(join(tmpdir(), "zhiyin-blender-install-"));
    const toolchains = new DownloadedToolchains({
      directory,
      specs: pinnedToolchains,
      download: async () => createReadStream(archive!),
      ready: { blender: compiledBlenderPython({ containment }) },
    });

    await toolchains.install("blender");

    const blender = await toolchains.executable("blender");
    if (!blender) throw new Error("Blender was not installed.");
    const home = dirname(blender);
    const compiled = await compiledUnder(home);
    const beside = (part: string) =>
      [...compiled.keys()].filter((file) => file.includes(part)).length;
    expect(beside(join("scripts", "modules"))).toBeGreaterThan(50);
    expect(beside(join("scripts", "startup"))).toBeGreaterThan(50);
    expect(beside(join("python", "lib"))).toBeGreaterThan(500);

    // Started as a person would start it, so it could write compiled files
    // if it found the ones it has unfit: it writes none and names its
    // sources where they are.
    const started = await runProcess({
      executable: blender,
      arguments: [
        "--background",
        "--factory-startup",
        "--python-expr",
        "import bpy.ops; print('SOURCE', bpy.ops.__spec__.loader.get_code('bpy.ops').co_filename)",
      ],
      cwd: directory,
      timeoutMs: 120_000,
      containment,
      environment: {
        ...process.env,
        BLENDER_USER_CONFIG: join(directory, "user", "config"),
        BLENDER_USER_SCRIPTS: join(directory, "user", "scripts"),
        BLENDER_USER_DATAFILES: join(directory, "user", "datafiles"),
        BLENDER_USER_EXTENSIONS: join(directory, "user", "extensions"),
      },
    });
    expect(started.exitCode).toBe(0);
    expect(started.stdout).toContain(
      `SOURCE ${join(home, "5.2", "scripts", "modules", "bpy", "ops.py")}`,
    );
    expect(await compiledUnder(home)).toEqual(compiled);
  }, 900_000);
});
