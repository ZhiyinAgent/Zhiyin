import { execSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  openProcessContainer,
  runProcess,
  type ProcessContainment,
} from "../src/index.js";

/**
 * What a program Zhiyin runs gives back, and what it is given: its output is
 * bounded while it runs, not after, and its environment is the one it was
 * handed. Both paths are held to this, the contained one on Windows.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const paths: [string, ProcessContainment | undefined][] = [
  ["uncontained", undefined],
  ...(process.platform === "win32"
    ? ([["contained", { open: openProcessContainer }]] as [
        string,
        ProcessContainment,
      ][])
    : []),
];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

async function eventually(check: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function node(
  containment: ProcessContainment | undefined,
  script: string,
  args: readonly string[],
  extra: Partial<Parameters<typeof runProcess>[0]> = {},
) {
  return async (cwd?: string) =>
    runProcess({
      executable: process.execPath,
      arguments: [join(fixtures, script), ...args],
      cwd: cwd ?? (await mkdtemp(join(tmpdir(), "zhiyin-run-"))),
      timeoutMs: 60_000,
      ...(containment ? { containment } : {}),
      ...extra,
    });
}

describe.each(paths)("a %s run", (_, containment) => {
  it(
    "is stopped, with everything it started, once its output passes the limit",
    { timeout: 60_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "zhiyin-flood-"));

      const run = await node(containment, "flood.mjs", [directory], {
        maximumOutputBytes: 8 * 1024 * 1024,
        maximumOutputCharacters: 1_000,
      })(directory);

      expect(run.ending).toBe("outputLimit");
      expect(run.stdout.length).toBeLessThan(1_100);
      const pid = Number(await readFile(join(directory, "flood.pid"), "utf8"));
      await eventually(() => !alive(pid));
    },
  );

  it("shows what a running program has printed so far, before it ends", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-live-"));
    const go = join(directory, "go");
    let printed: (() => Promise<{ stdout: string }>) | undefined;

    const finished = node(containment, "halves.mjs", [go], {
      onStart: (live) => {
        printed = live.printed;
      },
    })(directory);
    await eventually(() => printed !== undefined);
    let soFar = "";
    const deadline = Date.now() + 10_000;
    while (!soFar.includes("first") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      soFar = (await printed!()).stdout;
    }

    expect(soFar).toBe("first\n");
    await writeFile(go, "");
    expect((await finished).stdout).toBe("first\nsecond\n");
  });

  it("keeps the start and the end of a long output, and says what it left out", async () => {
    const run = await node(containment, "ends.mjs", ["5000000"], {
      maximumOutputCharacters: 1_000,
    })();

    expect(run.exitCode).toBe(0);
    expect(run.ending).toBeUndefined();
    expect(run.stdout.startsWith("HEAD")).toBe(true);
    expect(run.stdout.endsWith("TAIL")).toBe(true);
    expect(run.stdout).toContain("output shortened");
    expect(run.stdout.length).toBeLessThan(1_100);
  });

  it("hands over the whole of each stream when asked, middle included", async () => {
    let whole = "";
    let errors: string | undefined;

    const run = await node(containment, "ends.mjs", ["300000"], {
      maximumOutputCharacters: 1_000,
      keep: async (files) => {
        whole = await readFile(files.stdout, "utf8");
        errors = await readFile(files.stderr, "utf8");
      },
    })();

    expect(run.stdout.length).toBeLessThan(1_100);
    expect(whole.length).toBeGreaterThan(300_000);
    expect(whole.startsWith("HEAD")).toBe(true);
    expect(whole.endsWith("TAIL")).toBe(true);
    expect(whole).not.toContain("output shortened");
    expect(errors).toBe("");
  });

  it("hands over what was printed up to the limit, even when one write passes it", async () => {
    let whole = "";

    const run = await node(containment, "ends.mjs", ["300000"], {
      maximumOutputBytes: 1_000,
      keep: async (files) => {
        whole = await readFile(files.stdout, "utf8");
      },
    })();

    // A contained run can end before its files are measured; then nothing
    // was cut, and the whole output is handed over.
    expect(whole.startsWith("HEAD")).toBe(true);
    expect(whole.length).toBeGreaterThanOrEqual(
      run.ending === "outputLimit" ? 1_000 : 300_008,
    );
  });

  it("gives the program exactly the environment it was handed", async () => {
    process.env["ZHIYIN_PARENT_ONLY"] = "parent";
    try {
      const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      delete environment["ZHIYIN_PARENT_ONLY"];

      const run = await node(
        containment,
        "environment.mjs",
        ["GIT_TERMINAL_PROMPT", "ZHIYIN_PARENT_ONLY"],
        { environment },
      )();

      expect(JSON.parse(run.stdout)).toEqual({
        GIT_TERMINAL_PROMPT: "0",
        ZHIYIN_PARENT_ONLY: null,
      });
    } finally {
      delete process.env["ZHIYIN_PARENT_ONLY"];
    }
  });

  it("inherits Zhiyin's own environment when handed none", async () => {
    process.env["ZHIYIN_PARENT_ONLY"] = "parent";
    try {
      const run = await node(containment, "environment.mjs", [
        "ZHIYIN_PARENT_ONLY",
      ])();

      expect(JSON.parse(run.stdout)).toEqual({ ZHIYIN_PARENT_ONLY: "parent" });
    } finally {
      delete process.env["ZHIYIN_PARENT_ONLY"];
    }
  });

  it("reads valid UTF-8 as UTF-8", async () => {
    const run = await node(containment, "bytes.mjs", ["0xC3", "0xA9"])();

    expect(run.stdout).toBe("é");
  });
});

/** The console code page this machine uses, as `chcp` reports it. */
function consoleCodePage(): number | undefined {
  if (process.platform !== "win32") return undefined;
  return Number(/(\d+)\s*$/.exec(execSync("chcp").toString().trim())?.[1]);
}

describe.runIf([437, 850, 858].includes(consoleCodePage() ?? 0))(
  "output that is not UTF-8",
  () => {
    it.each(paths)(
      "is read in the console's code page on a %s run",
      async (_, containment) => {
        // 0x82 is "é" in the Western OEM code pages, and not UTF-8 at all.
        const run = await node(containment, "bytes.mjs", [
          "0x43",
          "0x61",
          "0x66",
          "0x82",
        ])();

        expect(run.stdout).toBe("Café");
      },
    );
  },
);
