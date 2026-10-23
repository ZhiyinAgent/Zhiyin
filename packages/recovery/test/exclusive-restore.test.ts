import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  exclusiveRecovery,
  type RecoveryFiles,
} from "../src/exclusive-restore.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** The digest of an empty file, which the stand-in reads the target as. */
const emptyDigest = createHash("sha256").digest("hex");

/** File operations that note, in order, when a copy is flushed and moved. */
function recording() {
  const steps: string[] = [];
  const files: RecoveryFiles = {
    openShared: () => ({}),
    read: () => 0,
    close: () => {},
    replace: (target) => {
      steps.push(`replace ${basename(target)}`);
      return true;
    },
    remove: () => true,
    moveIntoPlace: (_from, to) => {
      steps.push(`move into ${basename(to)}`);
      return true;
    },
    flush: async (path) => {
      steps.push(
        path.endsWith(".restore") ? "flush the copy" : `flush ${path}`,
      );
    },
  };
  return { steps, recovery: exclusiveRecovery(() => files) };
}

async function keptCopy(): Promise<{ folder: string; backup: string }> {
  const folder = await folders.make("zhiyin-exclusive-restore-");
  const backup = join(folder, "kept");
  await writeFile(backup, "the kept text");
  return { folder, backup };
}

// Order is the contract: a copy swapped in before it is on disk can be lost
// to a power cut while the swap is kept, leaving the file empty.
describe("putting a file back", () => {
  it("puts the kept copy on disk before it takes the file's place", async () => {
    const { folder, backup } = await keptCopy();
    const { steps, recovery } = recording();

    await recovery.restoreExclusively({
      absolute: join(folder, "notes.md"),
      expected: emptyDigest,
      action: "restore",
      backup,
    });

    expect(steps).toEqual(["flush the copy", "replace notes.md"]);
  });

  it("puts a deleted file's copy on disk before it is made again", async () => {
    const { folder, backup } = await keptCopy();
    const { steps, recovery } = recording();

    await recovery.recreateExclusively({
      absolute: join(folder, "notes.md"),
      backup,
    });

    expect(steps).toEqual(["flush the copy", "move into notes.md"]);
  });
});
