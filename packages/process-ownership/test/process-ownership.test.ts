import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
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

  it(
    "ends a contained process that commits more memory than its limit, and only that process",
    { timeout: 30_000 },
    async () => {
      const allocate = async (processMemoryLimit?: number) => {
        const directory = await workingDirectory();
        const container = openProcessContainer(
          processMemoryLimit ? { processMemoryLimit } : {},
        );
        const child = spawn(
          process.execPath,
          [join(fixtures, "allocator.mjs"), directory],
          { stdio: "ignore", windowsHide: true },
        );
        try {
          if (child.pid === undefined) throw new Error("no child pid");
          const ended = new Promise<number | null>((resolve) =>
            child.once("exit", resolve),
          );
          container.contain(child.pid);
          // The limit is in force before the process asks for anything.
          await writeFile(join(directory, "go"), "");
          return await Promise.race([
            ended.then((code) => ({ ended: code })),
            until(async () => {
              const text = await readFile(
                join(directory, "allocated"),
                "utf8",
              ).catch(() => undefined);
              return text ? { allocated: text } : undefined;
            }),
          ]);
        } finally {
          container.close();
        }
      };

      await expect(allocate(256 * 1024 * 1024)).resolves.toMatchObject({
        ended: expect.any(Number),
      });
      await expect(allocate()).resolves.toEqual({ allocated: "640" });
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

  it(
    "hands a contained process its arguments exactly, quotes and backslashes included",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const given = [
        'say "hi"',
        "ends in a backslash\\",
        'a\\"b',
        "\\\\server\\share\\",
        "",
        "two  spaces",
        '"',
        "\\\\\\",
        "C:\\Program Files\\x.exe",
      ];
      const container = openProcessContainer();
      try {
        const echo = container.launch({
          executable: process.execPath,
          arguments: [
            "-e",
            "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
            ...given,
          ],
          cwd: directory,
          stdout: join(directory, "stdout.txt"),
          stderr: join(directory, "stderr.txt"),
        });
        expect(await echo.wait()).toBe(0);
        expect(
          JSON.parse(await readFile(join(directory, "stdout.txt"), "utf8")),
        ).toEqual(given);
      } finally {
        container.close();
      }
    },
  );

  it(
    "talks with a contained process over pipes of its own",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      try {
        const echo = container.launch({
          executable: process.execPath,
          arguments: [join(fixtures, "pipe-echo.mjs")],
          pipes: (ends) => [ends.reads, ends.writes],
          cwd: directory,
          stdout: join(directory, "stdout.txt"),
          stderr: join(directory, "stderr.txt"),
        });
        if (!echo.pipes) throw new Error("No pipes were handed back.");
        const answer = new Promise<string>((resolve) =>
          echo.pipes!.fromProcess.once("data", (chunk: Buffer) =>
            resolve(chunk.toString("utf8")),
          ),
        );

        echo.pipes.toProcess.write("only between us");

        expect(await answer).toBe("ONLY BETWEEN US");
        echo.pipes.toProcess.end();
        expect(await echo.wait()).toBe(0);
      } finally {
        container.close();
      }
    },
  );

  it(
    "hands a contained process none of Zhiyin's other inheritable handles",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const secret = join(directory, "held-by-zhiyin.txt");
      await writeFile(secret, "");
      const held = inheritableHandle(secret);
      const container = openProcessContainer();
      try {
        const child = container.launch({
          executable: process.execPath,
          arguments: [join(fixtures, "handle-path.mjs"), String(held.value)],
          cwd: directory,
          stdout: join(directory, "stdout.txt"),
          stderr: join(directory, "stderr.txt"),
        });

        expect(await child.wait()).toBe(0);
        const seen = await readFile(join(directory, "stdout.txt"), "utf8");
        expect(seen).not.toContain("held-by-zhiyin.txt");
      } finally {
        container.close();
        held.close();
      }
    },
  );
});

/**
 * A handle any process Zhiyin starts with inheritance would receive, at the
 * same value. Node opens its own files uninheritable, so the test makes one.
 */
function inheritableHandle(path: string): {
  readonly value: bigint;
  close(): void;
} {
  const kernel32 = koffi.load("kernel32.dll");
  const CreateFileW = kernel32.func(
    "intptr_t CreateFileW(const char16_t*, uint32, uint32, void*, uint32, uint32, void*)",
  );
  const CloseHandle = kernel32.func("bool CloseHandle(intptr_t)");
  // SECURITY_ATTRIBUTES: its size, no descriptor, inheritable.
  const security = Buffer.alloc(24);
  security.writeUInt32LE(24, 0);
  security.writeUInt32LE(1, 16);
  const GENERIC_READ = 0x80000000;
  const FILE_SHARE_READ = 0x1;
  const OPEN_EXISTING = 3;
  const handle = BigInt(
    CreateFileW(
      path,
      GENERIC_READ,
      FILE_SHARE_READ,
      security,
      OPEN_EXISTING,
      0,
      null,
    ),
  );
  if (handle <= 0n) throw new Error("The test could not open its own file.");
  return { value: handle, close: () => CloseHandle(handle) };
}
