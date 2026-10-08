import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { WorkspaceTools, resolveShell } from "../src/index.js";

const shell = resolveShell();
const withShell = shell ? describe : describe.skip;

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-bash-"));
}

/** Git Bash wants a forward-slashed path, and quoting for the spaces. */
function bashPath(value: string): string {
  return `"${value.replaceAll("\\", "/")}"`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  attempts = 200,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("bash availability", () => {
  it("is not advertised at all when no shell is present", () => {
    const tools = new WorkspaceTools(".", { shell: undefined });

    expect(tools.list().map((tool) => tool.name)).not.toContain("bash");
  });
});

withShell("bash", () => {
  it("reports a missing command even when a fallback masks its exit code", async () => {
    const tools = new WorkspaceTools(await workspace(), { shell });
    const result = await tools.execute("bash", {
      command: "__zhiyin_missing_command__ || true",
      explanation: "Probe a missing executable.",
    });
    expect(result).toMatchObject({
      ok: false,
      reported: true,
      value: {
        exitCode: 0,
        stderr: expect.stringContaining("command not found"),
      },
    });
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("not confirmed"),
    );
  });

  it("does not mistake ordinary stderr progress for a failed command", async () => {
    const tools = new WorkspaceTools(await workspace(), { shell });
    expect(
      await tools.execute("bash", {
        command: "echo 'Working...' >&2",
        explanation: "Print progress.",
      }),
    ).toMatchObject({ ok: true, value: { exitCode: 0 } });
  });
  it("does not dispatch a command when cancellation won the launch race", async () => {
    const root = await workspace();
    const sentinel = join(root, "must-not-exist.txt");
    const tools = new WorkspaceTools(root);
    const controller = new AbortController();
    controller.abort();

    const result = await tools.execute(
      "bash",
      {
        command: `echo leaked > ${bashPath(sentinel)}`,
        explanation: "Writes a sentinel, for the purpose of this test.",
      },
      controller.signal,
    );

    expect(result).toMatchObject({ ok: false });
    expect(existsSync(sentinel)).toBe(false);
  });

  it("requires the model to say what the command does before anyone approves it", async () => {
    const tools = new WorkspaceTools(await workspace());

    expect(
      await tools.inspect("bash", { command: "git status --short" }),
    ).toMatchObject({ ok: false, correctable: true });

    const inspection = await tools.inspect("bash", {
      command: "git status --short",
      explanation: "Lists which files in the project have been changed.",
    });
    expect(inspection).toMatchObject({
      ok: true,
      action: "Run a command",
      target: "git status --short",
      // The model's sentence travels as a claim, never as the authoritative
      // consequence.
      claim: "Lists which files in the project have been changed.",
    });
    // What every command could do is not restated on every card.
    expect(inspection).not.toHaveProperty("detail");
  });

  it("runs in the workspace and reports what the command wrote", async () => {
    const root = await workspace();
    await writeFile(join(root, "note.txt"), "hello", "utf8");
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("bash", {
      command: "cat note.txt",
      explanation: "Shows the contents of the note.",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { exitCode: 0, stdout: "hello", stderr: "" },
    });
  });

  /**
   * A non-zero exit is not success, and the model is told exactly that. But
   * the command did run, and this is its answer: `command -v python3` exiting
   * 1 means Python is absent, which is a finding rather than a breakage.
   * `reported` is how that difference survives as far as the person watching.
   */
  it("marks a non-zero exit as reported, not as a failure to run", async () => {
    const tools = new WorkspaceTools(await workspace());

    const result = await tools.execute("bash", {
      command: "echo problem >&2; exit 3",
      explanation: "Exits with an error on purpose.",
    });

    expect(result).toMatchObject({
      ok: false,
      reported: true,
      reason: "The command exited with code 3.",
      value: { exitCode: 3, stderr: "problem\n" },
    });
  });

  it("does not call a stopped command a reported one", async () => {
    const tools = new WorkspaceTools(await workspace());
    const controller = new AbortController();

    const running = tools.execute(
      "bash",
      {
        command: "sleep 30",
        explanation: "Waits, for the purpose of this test.",
      },
      controller.signal,
    );
    controller.abort();

    expect(await running).not.toHaveProperty("reported", true);
  });

  it("stops a command that runs longer than it was given", async () => {
    const tools = new WorkspaceTools(await workspace());

    const result = await tools.execute("bash", {
      command: "sleep 30",
      explanation: "Waits, for the purpose of this test.",
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ ok: false });
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("ran longer than 1000 ms"),
    );
    // Stopped before it could answer: there is nothing here that it reported.
    expect(result).not.toHaveProperty("reported", true);
  });

  it("stops a command that prints without end, and says why", async () => {
    const tools = new WorkspaceTools(await workspace(), {
      ...(process.platform === "win32"
        ? { containment: { open: openProcessContainer } }
        : {}),
    });

    const result = await tools.execute("bash", {
      command: "yes",
      explanation: "Prints without end, for the purpose of this test.",
      timeoutMs: 60_000,
    });

    expect(result).toMatchObject({ ok: false });
    expect(result).toHaveProperty(
      "reason",
      expect.stringContaining("printed more than"),
    );
    expect(result).not.toHaveProperty("reported", true);
  }, 90_000);

  /**
   * The reason a shell tool can exist at all: a command that starts a
   * *detached grandchild* must not leave it running once the command is
   * stopped.
   *
   * This is one real case with real processes, not a proof of universal
   * containment. It shows that the mechanism reaches past the direct child; it
   * says nothing about a process that re-parents itself, is started as a
   * service, or survives its creator deliberately.
   */
  it("kills the whole tree, not just the shell it started", async () => {
    const root = await workspace();
    const pidFile = join(root, "grandchild.pid");
    const tools = new WorkspaceTools(root);
    const controller = new AbortController();

    const script =
      "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
    const running = tools.execute(
      "bash",
      {
        command: `${bashPath(process.execPath)} -e ${JSON.stringify(script)} ${bashPath(pidFile)} & wait`,
        explanation:
          "Starts a long-running helper, for the purpose of this test.",
        timeoutMs: 60_000,
      },
      controller.signal,
    );

    expect(await waitUntil(() => existsSync(pidFile))).toBe(true);
    const grandchild = Number((await readFile(pidFile, "utf8")).trim());
    expect(Number.isInteger(grandchild)).toBe(true);
    expect(alive(grandchild)).toBe(true);

    controller.abort();
    await expect(running).resolves.toMatchObject({ ok: false });

    expect(await waitUntil(() => !alive(grandchild))).toBe(true);
  }, 90_000);

  it("stopping one command leaves an unrelated command running", async () => {
    const root = await workspace();
    const firstPidFile = join(root, "first.pid");
    const secondPidFile = join(root, "second.pid");
    const tools = new WorkspaceTools(root);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const script =
      "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
    const start = (pidFile: string, controller: AbortController) =>
      tools.execute(
        "bash",
        {
          command: `${bashPath(process.execPath)} -e ${JSON.stringify(script)} ${bashPath(pidFile)} & wait`,
          explanation:
            "Starts one long-running helper, for the purpose of this test.",
          timeoutMs: 60_000,
        },
        controller.signal,
      );

    const first = start(firstPidFile, firstController);
    const second = start(secondPidFile, secondController);
    let firstPid = 0;
    let secondPid = 0;
    try {
      expect(await waitUntil(() => existsSync(firstPidFile))).toBe(true);
      expect(await waitUntil(() => existsSync(secondPidFile))).toBe(true);
      firstPid = Number((await readFile(firstPidFile, "utf8")).trim());
      secondPid = Number((await readFile(secondPidFile, "utf8")).trim());
      expect(alive(firstPid)).toBe(true);
      expect(alive(secondPid)).toBe(true);

      firstController.abort();
      await expect(first).resolves.toMatchObject({ ok: false });

      expect(await waitUntil(() => !alive(firstPid))).toBe(true);
      expect(alive(secondPid)).toBe(true);
    } finally {
      secondController.abort();
      await second;
    }
    expect(await waitUntil(() => !alive(secondPid))).toBe(true);
  }, 90_000);
  it("does not run a command whose processes could not be contained", async () => {
    const root = await workspace();
    const marker = join(root, "ran");
    const tools = new WorkspaceTools(root, {
      containment: {
        open: () => {
          throw new Error("no job object here");
        },
      },
    });

    const result = await tools.execute("bash", {
      command: `touch ${bashPath(marker)}`,
      explanation: "Prove whether the command ran at all.",
    });

    expect(result).toMatchObject({
      ok: false,
      reason:
        "This command was not started, because the processes it creates could not be contained.",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("closes a command's container once the command has reported", async () => {
    const root = await workspace();
    let launched = false;
    let closed = false;
    const tools = new WorkspaceTools(root, {
      containment: {
        open: () => ({
          contain: () => undefined,
          launch: (options) => {
            launched = true;
            writeFileSync(options.stdout, "contained\n", "utf8");
            writeFileSync(options.stderr, "", "utf8");
            return { pid: 123, wait: async () => 0 };
          },
          close: () => {
            closed = true;
          },
        }),
      },
    });

    const result = await tools.execute("bash", {
      command: "echo contained",
      explanation: "An ordinary command still succeeds.",
    });

    expect(result).toMatchObject({ ok: true });
    // A command that has reported its result owns nothing further: whatever it
    // left running is an orphan, so the container does not outlive the answer.
    expect(closed).toBe(true);
    expect(launched).toBe(true);
  });
});
