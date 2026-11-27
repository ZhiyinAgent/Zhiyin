/**
 * Real programs confined under a long home: the CAD environment's Python,
 * whose launcher asks Windows for its temporary folder before it starts
 * Python, and a real Blender. Windows names a container's temporary folder
 * below the home, so a long home makes it long; one past 245 characters is
 * refused at once, saying why, and one of 245 runs. Each is skipped unless
 * its program is named:
 *
 *   $env:ZHIYIN_CAD_PYTHON = "…\cad\Scripts\python.exe"
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"
 *   npx vitest run --project "system-boundary*" packages/platform/sandbox/system-boundary/long-home.test.ts
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  forgetConfinement,
  openProcessContainer,
  runProcess,
} from "../src/index.js";

const python = process.env["ZHIYIN_CAD_PYTHON"];
const blender = process.env["ZHIYIN_BLENDER"];

const folders = new TemporaryFolders();
const purpose = "long-home-test";
const homes: string[] = [];
afterEach(() => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
});
afterAll(() => folders.removeAll());

/**
 * The length of the temporary folder Windows gives a container: below the
 * local application data of its home, in a folder named for the container,
 * `Zhiyin.<purpose>.` and sixteen characters of the home's key.
 */
const temporaryFolderLength = (home: string) =>
  join(
    home,
    "AppData",
    "Local",
    "Packages",
    `Zhiyin.${purpose}.${"x".repeat(16)}`,
    "AC",
    "Temp",
  ).length;

/** A home, not made yet, whose temporary folder is `characters` long. */
async function homeWhoseTemporaryFolderIs(characters: number) {
  const base = await folders.make("zhiyin-long-home-");
  const extra = characters - temporaryFolderLength(base);
  // Folders of at most 60 characters, each after a backslash.
  const count = Math.ceil(extra / 61);
  const letters = extra - count;
  const names = Array.from({ length: count }, (_, at) =>
    "d".repeat(Math.floor(letters / count) + (at < letters % count ? 1 : 0)),
  );
  const own = join(base, ...names);
  homes.push(own);
  expect(temporaryFolderLength(own)).toBe(characters);
  return own;
}

/** A confined run of `executable`, timed from its start to its answer. */
async function timedRun(
  executable: string,
  args: readonly string[],
  home: string,
  read: readonly string[],
) {
  const cwd = await folders.make("zhiyin-long-home-cwd-");
  const started = performance.now();
  const ran = await runProcess({
    executable,
    arguments: args,
    cwd,
    timeoutMs: 60_000,
    containment: { open: openProcessContainer },
    environment: {
      SystemRoot: process.env["SystemRoot"],
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    confinement: { purpose, home, read, write: [], hosts: [] },
  });
  return { ran, ms: performance.now() - started };
}

/**
 * Makes a file in the temporary folder twice: as Python's own module does,
 * and as Windows programs do, by asking Windows for the folder and a name in it.
 */
const makesTemporaryFiles = [
  "import ctypes, os, tempfile",
  "from ctypes import wintypes",
  "k = ctypes.WinDLL('kernel32', use_last_error=True)",
  "k.GetTempPathW.argtypes = [wintypes.DWORD, wintypes.LPWSTR]",
  "k.GetTempFileNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT, wintypes.LPWSTR]",
  "handle, path = tempfile.mkstemp(); os.close(handle); os.remove(path)",
  "folder = ctypes.create_unicode_buffer(32767)",
  "assert k.GetTempPathW(32767, folder)",
  "name = ctypes.create_unicode_buffer(32767)",
  "assert k.GetTempFileNameW(folder.value, 'zh', 0, name), ctypes.get_last_error()",
  "os.remove(name.value)",
  "print('made in', folder.value)",
].join("\n");

const refused = (ran: Awaited<ReturnType<typeof timedRun>>["ran"]) => {
  expect(ran).toMatchObject({ exitCode: null, failure: "confinement" });
  expect(ran.reason).toMatch(
    /\\AppData\\Local\\Packages\\Zhiyin\.long-home-test\.[0-9a-f]{16}\\AC\\Temp\b/,
  );
  expect(ran.reason).toContain("245");
};

describe.skipIf(!python)(
  "the CAD environment's Python under a long home",
  () => {
    /**
     * The environment's Python names its own through a link in the folder of
     * Zhiyin's Pythons, so that folder is read whole, as the app gives it.
     */
    const reads = async () => {
      const environment = dirname(dirname(python!));
      const configured = await readFile(
        join(environment, "pyvenv.cfg"),
        "utf8",
      );
      const base = /^home\s*=\s*(.+)$/m.exec(configured)?.[1]?.trim();
      if (!base) throw new Error("The CAD environment names no base Python.");
      return [dirname(base), environment];
    };

    it("is refused at once, saying why, where its launcher would wait for Windows forever", async () => {
      const { ran, ms } = await timedRun(
        python!,
        ["-I", "-c", "print('ran')"],
        await homeWhoseTemporaryFolderIs(280),
        await reads(),
      );

      expect(ms).toBeLessThan(1000);
      refused(ran);
    });

    it("is refused at once one character past the limit", async () => {
      const { ran, ms } = await timedRun(
        python!,
        ["-I", "-c", "print('ran')"],
        await homeWhoseTemporaryFolderIs(246),
        await reads(),
      );

      expect(ms).toBeLessThan(1000);
      refused(ran);
    });

    it("runs at the limit, and makes temporary files as Windows programs do", async () => {
      const { ran } = await timedRun(
        python!,
        ["-I", "-c", makesTemporaryFiles],
        await homeWhoseTemporaryFolderIs(245),
        await reads(),
      );

      expect(ran.stderr).not.toMatch(/Traceback/);
      expect(ran).toMatchObject({ exitCode: 0 });
      expect(ran.stdout).toMatch(/made in .*\\AC\\Temp\\/);
    });
  },
);

describe.skipIf(!blender)("a real Blender under a long home", () => {
  const quits = [
    "--background",
    "--factory-startup",
    "--python-expr",
    makesTemporaryFiles,
  ];

  it("is refused at once, saying why, where it would stop as it starts", async () => {
    // At 259 characters, USD fails to read the temporary folder and ends
    // Blender before it runs a line.
    const { ran, ms } = await timedRun(
      blender!,
      quits,
      await homeWhoseTemporaryFolderIs(259),
      [dirname(blender!)],
    );

    expect(ms).toBeLessThan(1000);
    refused(ran);
  });

  it("starts at the limit, and makes temporary files there", async () => {
    const { ran } = await timedRun(
      blender!,
      quits,
      await homeWhoseTemporaryFolderIs(245),
      [dirname(blender!)],
    );

    expect(ran.stderr).not.toMatch(/Traceback|ArchError/);
    expect(ran).toMatchObject({ exitCode: 0 });
    expect(ran.stdout).toMatch(/made in .*\\AC\\Temp\\/);
  });
});
