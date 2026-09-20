import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  containmentAvailability,
  openProcessContainer,
  runProcess,
} from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function workingDirectory() {
  return mkdtemp(join(tmpdir(), "zhiyin-containment-"));
}

/** Polls rather than sleeps, so a slow machine waits and a fast one does not. */
async function until<T>(
  attempt: () => Promise<T | undefined>,
  give_up_after = 15_000,
): Promise<T> {
  const deadline = Date.now() + give_up_after;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function pidFile(directory: string, name: string): Promise<number> {
  return until(async () => {
    try {
      const text = await readFile(join(directory, name), "utf8");
      const pid = Number.parseInt(text, 10);
      return Number.isInteger(pid) ? pid : undefined;
    } catch {
      return undefined;
    }
  });
}

/** Asks the operating system, not our own bookkeeping, whether a pid is alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

async function allGone(pids: readonly number[]): Promise<void> {
  await until(async () => {
    const surviving = pids.filter((pid) => alive(pid));
    if (surviving.length === 0) return true;
    return undefined;
  }, 20_000).catch(() => {
    throw new Error(
      `Processes survived containment: ${pids.filter((pid) => alive(pid)).join(", ")}`,
    );
  });
}

describe.runIf(process.platform === "win32")("process containment", () => {
  it("reports whether processes can be contained here", () => {
    expect(containmentAvailability()).toEqual({ available: true });
  });

  it("runs a process through the shared contained execution path", async () => {
    let launched = false;
    let closed = 0;
    const result = await runProcess({
      executable: process.execPath,
      arguments: ["--version"],
      cwd: await workingDirectory(),
      timeoutMs: 10_000,
      containment: {
        open: () => ({
          contain: () => undefined,
          launch: () => {
            launched = true;
            return { pid: 123, wait: async () => 0 };
          },
          close: () => {
            closed += 1;
          },
        }),
      },
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toBe(true);
    expect(closed).toBeGreaterThan(0);
  });

  it(
    "kills a detached grandchild started after containment",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      const child = spawn(
        process.execPath,
        [join(fixtures, "child.mjs"), directory],
        { stdio: "ignore", windowsHide: true },
      );
      if (child.pid === undefined) throw new Error("no child pid");
      container.contain(child.pid);

      // Only now is the grandchild allowed to start, so its containment cannot
      // be an accident of winning a race against the assignment above.
      await writeFile(join(directory, "go"), "");
      const grandchild = await pidFile(directory, "grandchild.pid");
      expect(alive(child.pid)).toBe(true);
      expect(alive(grandchild)).toBe(true);

      container.close();

      await allGone([child.pid, grandchild]);
    },
  );

  it(
    "owns a reparented descendant before its first instruction can run",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      const owner = container.launch({
        executable: process.execPath,
        arguments: [join(fixtures, "immediate-child.mjs"), directory],
        cwd: directory,
        stdout: join(directory, "stdout.txt"),
        stderr: join(directory, "stderr.txt"),
      });

      expect(await owner.wait()).toBe(0);
      const descendant = await pidFile(directory, "immediate.pid");
      expect(alive(descendant)).toBe(true);

      // The direct parent has already exited and the descendant is detached.
      // Only ownership established at process creation still reaches it.
      container.close();
      await allGone([descendant]);
    },
  );

  it(
    "kills a contained tree when the owning process dies abruptly",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const owner = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          join(fixtures, "owner.mts"),
          directory,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      if (owner.pid === undefined) throw new Error("no owner pid");
      const child = await pidFile(directory, "child.pid");
      await writeFile(join(directory, "go"), "");
      const grandchild = await pidFile(directory, "grandchild.pid");
      expect(alive(child)).toBe(true);
      expect(alive(grandchild)).toBe(true);

      // The owner is destroyed outright: no exit handler, no unwinding, nothing
      // of ours runs afterwards. A tree walk we would have performed on the way
      // out is exactly what is unavailable here.
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(owner.pid), "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => resolve());
        killer.on("close", () => resolve());
      });

      await allGone([child, grandchild]);
    },
  );

  it("refuses to contain a process that is not there", () => {
    const container = openProcessContainer();
    try {
      // Never a live pid: Windows reserves 0 for the system idle process, and
      // it cannot be opened for containment.
      expect(() => container.contain(0)).toThrow();
    } finally {
      container.close();
    }
  });

  it("closes without complaint more than once", () => {
    const container = openProcessContainer();
    container.close();
    expect(() => container.close()).not.toThrow();
  });

  it("refuses to contain anything after it is closed", () => {
    const container = openProcessContainer();
    container.close();
    expect(() => container.contain(process.pid)).toThrow(
      "This process container is already closed.",
    );
  });
});
