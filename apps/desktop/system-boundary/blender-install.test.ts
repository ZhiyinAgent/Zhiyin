// @vitest-environment node
/**
 * Blender, installed as the app installs it, from its real archive.
 *
 * A conversation's Blender may only read its own installation (ADR 0006), so
 * the compiled Python it starts on has to be there when the installation
 * is complete. This installs the pinned archive with the installer and the
 * compile step the composition gives it, and starts the installed Blender
 * once. The installed Blender then reads every file of the session script
 * Zhiyin runs in it and loads each of its modules, so a mistake in them fails
 * here rather than in every conversation's 3D tools. It is skipped unless the
 * archive is named in the environment, as CI's gate names the one it
 * downloads (`ZHIYIN_TEST_TOOLS`):
 *
 *   $env:ZHIYIN_BLENDER_ARCHIVE = "…\blender-5.2.2-windows-x64.zip"
 *   npx vitest run --project system-boundary apps/desktop/system-boundary/blender-install.test.ts
 */

import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { compiledBlenderPython } from "@zhiyin/blender-studio";
import { openProcessContainer, runProcess } from "@zhiyin/process-ownership";
import { DownloadedToolchains, pinnedToolchains } from "@zhiyin/toolchains";

const archive = process.env["ZHIYIN_BLENDER_ARCHIVE"];
const containment = { open: openProcessContainer };
/** The script Zhiyin runs in each conversation's Blender, as the app ships it. */
const session = fileURLToPath(
  new URL("../../../packages/blender-studio/src/session", import.meta.url),
);

/**
 * Compiles every file of the session in memory, writing nothing beside it,
 * then imports each of its modules, and says how many it loaded.
 */
const loadSession = `import importlib, pathlib, pkgutil, sys
sys.dont_write_bytecode = True
root = pathlib.Path(sys.argv[sys.argv.index("--") + 1])
for file in sorted(root.rglob("*.py")):
    compile(file.read_text(encoding="utf-8"), str(file), "exec")
sys.path.insert(0, str(root))
import zhiyin_studio
names = [module.name for module in pkgutil.iter_modules(zhiyin_studio.__path__)]
for name in names:
    importlib.import_module("zhiyin_studio." + name)
print("LOADED", len(names))
`;

/** Where Blender keeps what a person sets, inside the test's own folder. */
function userFolders(directory: string): Record<string, string> {
  return {
    BLENDER_USER_CONFIG: join(directory, "user", "config"),
    BLENDER_USER_SCRIPTS: join(directory, "user", "scripts"),
    BLENDER_USER_DATAFILES: join(directory, "user", "datafiles"),
    BLENDER_USER_EXTENSIONS: join(directory, "user", "extensions"),
  };
}

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
  const folders = new TemporaryFolders();
  let directory: string | undefined;
  let blender: string | undefined;

  afterAll(() => folders.removeAll());

  it("holds its compiled Python when the installation is complete, and starts on it", async () => {
    directory = await folders.make("zhiyin-blender-install-");
    const toolchains = new DownloadedToolchains({
      directory,
      specs: pinnedToolchains,
      download: async () => createReadStream(archive!),
      ready: { blender: compiledBlenderPython({ containment }) },
    });

    await toolchains.install("blender");

    blender = await toolchains.executable("blender");
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
      environment: { ...process.env, ...userFolders(directory) },
    });
    expect(started.exitCode).toBe(0);
    expect(started.stdout).toContain(
      `SOURCE ${join(home, "5.2", "scripts", "modules", "bpy", "ops.py")}`,
    );
    expect(await compiledUnder(home)).toEqual(compiled);
  }, 900_000);

  it("reads every file of the session script and loads each of its modules", async () => {
    if (!blender || !directory) throw new Error("Blender was not installed.");
    const script = join(directory, "load-session.py");
    await writeFile(script, loadSession, "utf8");
    const before = await compiledUnder(session);
    const sources = (await readdir(session, { recursive: true })).filter(
      (entry) => entry.endsWith(".py") && !entry.includes("__pycache__"),
    );

    const loaded = await runProcess({
      executable: blender,
      arguments: [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        script,
        "--",
        session,
      ],
      cwd: directory,
      timeoutMs: 120_000,
      containment,
      environment: { ...process.env, ...userFolders(directory) },
    });

    expect(loaded.exitCode).toBe(0);
    // Every module but the package's own __init__.
    expect(loaded.stdout).toContain(
      `LOADED ${sources.filter((entry) => entry.includes("zhiyin_studio") && !entry.endsWith("__init__.py")).length}`,
    );
    expect(await compiledUnder(session)).toEqual(before);
  }, 180_000);
});
