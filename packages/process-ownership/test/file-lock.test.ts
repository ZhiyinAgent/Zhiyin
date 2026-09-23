import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { holdExclusively } from "../src/index.js";

/**
 * A file only one holder can have open at a time, which the operating system
 * lets go of when the holder is gone however it went. A lock that outlives its
 * holder is an app that says another copy is running when none is.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function lockPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "zhiyin-lock-")), "owner.lock");
}

function held(attempt: ReturnType<typeof holdExclusively>) {
  if (!("held" in attempt)) throw new Error(`refused: ${attempt.refused}`);
  return attempt.held;
}

describe.runIf(process.platform === "win32")("an exclusively held file", () => {
  it("refuses a second holder until the first lets go", async () => {
    const path = await lockPath();
    const first = held(holdExclusively(path));

    expect(holdExclusively(path)).toEqual({
      refused: "held-elsewhere",
    });

    first.release();
    held(holdExclusively(path)).release();
  });

  it("leaves nothing behind once released", async () => {
    const path = await lockPath();
    const lock = held(holdExclusively(path));
    expect(existsSync(path)).toBe(true);

    lock.release();

    expect(existsSync(path)).toBe(false);
  });

  it("takes over a file left behind by a holder that was not running", async () => {
    const path = await lockPath();
    const first = held(holdExclusively(path));
    first.release();
    // Stands in for a lock left by any earlier version, naming whoever.
    await writeFile(path, JSON.stringify({ pid: process.pid }), "utf8");

    held(holdExclusively(path)).release();
  });

  it(
    "is let go of when its holder is killed outright",
    { timeout: 30_000 },
    async () => {
      const path = await lockPath();
      const holder = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          join(fixtures, "lock-holder.mts"),
          path,
        ],
        { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
      );
      const said = await new Promise<string>((resolve) =>
        holder.stdout.once("data", (chunk: Buffer) => resolve(String(chunk))),
      );
      expect(said.trim()).toBe("held");
      expect(holdExclusively(path)).toEqual({
        refused: "held-elsewhere",
      });

      // No /T and no signal it could handle: the process is simply destroyed.
      execSync(`taskkill /pid ${holder.pid} /F`, { stdio: "ignore" });
      await new Promise((resolve) => holder.once("exit", resolve));

      held(holdExclusively(path)).release();
    },
  );

  it("says the folder could not be used, not that someone holds it, when it cannot be created", async () => {
    const path = join(await lockPath(), "missing folder", "owner.lock");

    expect(holdExclusively(path)).toEqual({
      refused: "unavailable",
    });
  });

  it("lets the folder that holds it be removed", async () => {
    const path = await lockPath();
    const lock = held(holdExclusively(path));

    await rm(dirname(path), { recursive: true, force: true });

    expect(existsSync(dirname(path))).toBe(false);
    lock.release();
  });
});
