import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants, getPriority } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  ansiCodePage,
  ansiText,
  containmentAvailability,
  openProcessContainer,
  openToLowIntegrity,
  runProcess,
} from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function workingDirectory() {
  return folders.make("zhiyin-containment-");
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

  /**
   * Windows reads its strings up to the first NUL, so a value carrying one
   * would start something other than what it says: the rest of an argument,
   * a shorter program path, a different folder.
   */
  it.each([
    [
      "an argument",
      { arguments: ["-e", "require('fs').writeFileSync('ran','')", "a\0b"] },
    ],
    ["the program", { executable: `${process.execPath}\0.txt` }],
    ["the folder", { cwd: "C:\\\0" }],
    ["an environment value", { environment: { NOTE: "a\0b" } }],
    ["an environment name", { environment: { "NO\0TE": "a" } }],
  ])("starts nothing when %s holds a NUL character", async (_where, change) => {
    const directory = await workingDirectory();
    const container = openProcessContainer();
    try {
      expect(() =>
        container.launch({
          executable: process.execPath,
          arguments: ["-e", "require('fs').writeFileSync('ran','')"],
          cwd: directory,
          stdout: join(directory, "stdout.txt"),
          stderr: join(directory, "stderr.txt"),
          ...change,
        }),
      ).toThrow(/NUL/);
      // Its output files are made before the process is: neither was.
      expect(await readdir(directory)).toEqual([]);
    } finally {
      container.close();
    }
  });

  it(
    "keeps Zhiyin's own file work going while many processes it started are still running",
    { timeout: 60_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      try {
        // More at once than Node keeps threads for file work.
        const running = Array.from({ length: 8 }, (_, index) =>
          container.launch({
            executable: process.execPath,
            arguments: [join(fixtures, "sleeper.mjs")],
            cwd: directory,
            stdout: join(directory, `stdout-${index}.txt`),
            stderr: join(directory, `stderr-${index}.txt`),
          }),
        );
        const ends = running.map((child) => child.wait());
        const stalled = new Promise<string>((resolve) =>
          setTimeout(() => resolve("stalled"), 5_000),
        );

        expect(
          await Promise.race([
            readFile(join(fixtures, "sleeper.mjs"), "utf8").then(
              () => "answered",
            ),
            stalled,
          ]),
        ).toBe("answered");

        // Each is still told apart from the rest when the tree is ended.
        container.close();
        const codes = await Promise.all(ends);
        expect(codes.map((code) => typeof code)).toEqual(
          Array.from({ length: 8 }, () => "number"),
        );
        await allGone(running.map((child) => child.pid));
      } finally {
        container.close();
      }
    },
  );

  it(
    "tells a process's end as it happens, with no timer asking whether it has",
    { timeout: 20_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      // Timers stand still: an end found by asking on one is never told.
      vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
      try {
        const child = container.launch({
          executable: process.execPath,
          arguments: [join(fixtures, "sleeper.mjs")],
          cwd: directory,
          stdout: join(directory, "stdout.txt"),
          stderr: join(directory, "stderr.txt"),
        });
        const ended = child.wait();
        container.close();

        expect(typeof (await ended)).toBe("number");
      } finally {
        vi.useRealTimers();
        container.close();
      }
    },
  );

  it(
    "ends the processes it was waiting on when its owner exits",
    { timeout: 60_000 },
    async () => {
      const directory = await workingDirectory();
      const quitter = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "--no-warnings",
          join(fixtures, "quitter.mts"),
          directory,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const code = await new Promise<number | null>((resolve) =>
        quitter.once("exit", resolve),
      );
      const sleepers = JSON.parse(
        await readFile(join(directory, "sleepers.json"), "utf8"),
      ) as number[];

      expect(code).toBe(0);
      expect(sleepers).toHaveLength(8);
      await allGone(sleepers);
    },
  );

  it(
    "starts a process below normal priority when asked, so its heavy work leaves the person's own responsive",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const container = openProcessContainer();
      const priorityOf = async (priority?: "below-normal") => {
        const name = `priority-${priority ?? "normal"}.txt`;
        const child = container.launch({
          executable: process.execPath,
          arguments: [
            "-e",
            "process.stdout.write(String(require('node:os').getPriority()))",
          ],
          cwd: directory,
          stdout: join(directory, name),
          stderr: join(directory, "stderr.txt"),
          ...(priority ? { priority } : {}),
        });
        expect(await child.wait()).toBe(0);
        return Number(await readFile(join(directory, name), "utf8"));
      };
      try {
        expect(await priorityOf("below-normal")).toBe(
          constants.priority.PRIORITY_BELOW_NORMAL,
        );
        // One nobody asked anything of starts as Windows starts it: at
        // normal priority, or at its parent's where that is lower, as on a
        // build machine that runs its jobs below normal.
        expect(await priorityOf()).toBe(
          Math.max(getPriority(), constants.priority.PRIORITY_NORMAL),
        );
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

describe("a process started at low integrity", () => {
  /** What the process could write and read of each file, in the order named. */
  async function attempts(
    directory: string,
    files: readonly string[],
    integrity?: "low",
  ): Promise<{ wrote: string; read: string }[]> {
    const container = openProcessContainer();
    try {
      const child = container.launch({
        executable: process.execPath,
        arguments: [join(fixtures, "writes.mjs"), ...files],
        cwd: directory,
        stdout: join(directory, "stdout.txt"),
        stderr: join(directory, "stderr.txt"),
        ...(integrity ? { integrity } : {}),
      });
      expect(await child.wait()).toBe(0);
      return JSON.parse(
        await readFile(join(directory, "stdout.txt"), "utf8"),
      ) as { wrote: string; read: string }[];
    } finally {
      container.close();
    }
  }

  it(
    "writes in a folder opened to it, in what the folder held and in what it is given later, and in no other; it reads them all",
    { timeout: 30_000 },
    async () => {
      const directory = await workingDirectory();
      const open = join(directory, "open");
      const shut = join(directory, "shut");
      await mkdir(join(open, "held before"), { recursive: true });
      await mkdir(shut);
      const before = join(open, "held before", "the person's.txt");
      const beside = join(shut, "the person's.txt");
      await writeFile(before, "the person's own");
      await writeFile(beside, "the person's own");

      await openToLowIntegrity(open);
      await mkdir(join(open, "added later"));
      const files = [
        join(open, "new.txt"),
        before,
        join(open, "added later", "new.txt"),
        join(shut, "new.txt"),
        beside,
      ];
      const low = await attempts(directory, files, "low");

      expect(low.slice(0, 3)).toEqual(
        Array(3).fill({ wrote: "done", read: "written at low integrity" }),
      );
      expect(low[3]).toEqual({ wrote: "EPERM", read: "ENOENT" });
      expect(low[4]).toEqual({ wrote: "EPERM", read: "the person's own" });
      // Opening a folder a second time changes nothing and is no error.
      await openToLowIntegrity(open);
      // The same program, not asked for low integrity, writes where the person can.
      expect((await attempts(directory, [beside]))[0]?.wrote).toBe("done");
    },
  );

  it("is what the shared run path starts when asked, contained", async () => {
    const directory = await workingDirectory();
    const file = join(directory, "new.txt");

    const run = await runProcess({
      executable: process.execPath,
      arguments: [join(fixtures, "writes.mjs"), file],
      cwd: directory,
      timeoutMs: 30_000,
      containment: { open: openProcessContainer },
      integrity: "low",
    });

    expect(JSON.parse(run.stdout)).toEqual([
      { wrote: "EPERM", read: "ENOENT" },
    ]);
  });

  it("is refused by the shared run path without containment, and nothing runs", async () => {
    const directory = await workingDirectory();
    const file = join(directory, "new.txt");

    const run = await runProcess({
      executable: process.execPath,
      arguments: [join(fixtures, "writes.mjs"), file],
      cwd: directory,
      timeoutMs: 30_000,
      integrity: "low",
    });

    expect(run).toMatchObject({ exitCode: null, failure: "containment" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("says why a folder could not be opened to it", async () => {
    const directory = await workingDirectory();

    await expect(
      openToLowIntegrity(join(directory, "not there")),
    ).rejects.toThrow(/not there.*could not be opened to low integrity/s);
  });
});

describe.runIf(process.platform === "win32")(
  "text in Windows' own code page",
  () => {
    it("is read in the ANSI code page, the one Windows reads files' text in, not the console's", () => {
      // "café" as a Western code page writes it: é is the one byte E9.
      const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
      const page = ansiCodePage();

      expect(page).toEqual(expect.any(Number));
      expect(ansiText(bytes)).toBe(
        new TextDecoder(`windows-${page}`).decode(bytes),
      );
    });
  },
);
