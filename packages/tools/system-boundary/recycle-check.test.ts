/**
 * The Recycle Bin check against Windows itself. Only a real file operation can
 * show that the question is answered and that asking it deletes nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRecyclable } from "../src/index.js";

const onWindows = process.platform === "win32" ? describe : describe.skip;

/** The Recycle Bin's capacity on the drive holding the temporary folder. */
function capacityBytes(): number | undefined {
  const guid = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Volume | Where-Object { $_.DriveLetter -eq '${tmpdir().slice(0, 2)}' }).DeviceID`,
    ],
    { encoding: "utf8" },
  ).match(/\{[0-9a-f-]+\}/i)?.[0];
  if (!guid) return undefined;
  try {
    const answer = execFileSync(
      "reg",
      [
        "query",
        `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\${guid}`,
        "/v",
        "MaxCapacity",
      ],
      { encoding: "utf8" },
    );
    const megabytes = answer.match(/0x([0-9a-f]+)/i)?.[1];
    return megabytes ? parseInt(megabytes, 16) * 1024 * 1024 : undefined;
  } catch {
    return undefined;
  }
}

/** A file that reads as `size` bytes and takes almost no room on the disk. */
async function sparseFile(path: string, size: number): Promise<void> {
  await writeFile(path, "");
  execFileSync("fsutil", ["sparse", "setflag", path]);
  await truncate(path, size);
}

onWindows("checking what the Recycle Bin would take", () => {
  it("answers for a file and a folder on a local drive, and deletes neither", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recycle-"));
    const file = join(root, "notes.md");
    const folder = join(root, "drafts");
    await writeFile(file, "Notes.");
    await mkdir(folder);
    await writeFile(join(folder, "one.md"), "One.");

    const answers = await checkRecyclable([file, folder]);

    expect(answers.get(file)).toBe(true);
    expect(answers.get(folder)).toBe(true);
    expect(await readFile(file, "utf8")).toBe("Notes.");
    expect(await readFile(join(folder, "one.md"), "utf8")).toBe("One.");
  }, 60_000);

  /*
   * Windows decides that an item is too large for the Recycle Bin only after
   * the point where it says whether it will recycle, and then deletes it
   * permanently without a word: a sparse file over the capacity is reported
   * as moved by Electron's move to the Recycle Bin. So the check compares
   * sizes itself.
   */
  it("answers that a file larger than the Recycle Bin can hold would be deleted permanently", async () => {
    const capacity = capacityBytes();
    if (capacity === undefined) return; // No capacity set for this drive.
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recycle-"));
    const over = join(root, "over.bin");
    const under = join(root, "under.bin");
    await sparseFile(over, capacity + 1024 * 1024 * 1024);
    await sparseFile(under, Math.min(capacity / 2, 1024 * 1024 * 1024));
    try {
      const answers = await checkRecyclable([over, under]);

      expect(answers.get(over)).toBe(false);
      expect(answers.get(under)).toBe(true);
      expect(existsSync(over)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("answers that a file on a network share would be deleted permanently", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-recycle-"));
    const file = join(root, "shared.md");
    await writeFile(file, "Shared.");
    const shared = `\\\\localhost\\${root.slice(0, 1).toLowerCase()}$${file.slice(2)}`;
    if (!existsSync(shared)) return; // No administrative share here.

    const answers = await checkRecyclable([shared]);

    expect(answers.get(shared)).toBe(false);
    expect(await readFile(file, "utf8")).toBe("Shared.");
  }, 60_000);

  it("leaves out a path it cannot tell about rather than guessing", async () => {
    const missing = join(tmpdir(), "zhiyin-recycle-missing", "nothing.txt");

    expect((await checkRecyclable([missing])).has(missing)).toBe(false);
  }, 60_000);
});
