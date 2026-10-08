/**
 * A command still running when it was due to answer carries on as a job of
 * its conversation, rather than holding the conversation or being killed. The
 * model can look at it, wait for it and stop it; the conversation is told when
 * it ends by itself; and closing the conversation stops it with everything it
 * started.
 *
 * Real processes in real containment, because what is being shown is that the
 * tree is owned after the call that started it has returned.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { WorkspaceTools, resolveShell, type ToolResult } from "../src/index.js";

const shell = resolveShell();
const contained = shell && process.platform === "win32";

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

async function eventually(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function tools() {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-jobs-"));
  const ended: { conversationId: string; notice: string; wakes: boolean }[] =
    [];
  const changed: string[] = [];
  const workspace = new WorkspaceTools(root, {
    shell,
    containment: { open: openProcessContainer },
    promoteCommandsAfterMs: 1_500,
  });
  workspace.onCommandEnded((conversationId, notice, wakes) =>
    ended.push({ conversationId, notice, wakes }),
  );
  workspace.onCommandsChanged((conversationId) => changed.push(conversationId));
  return { root, workspace, ended, changed };
}

function run(
  workspace: WorkspaceTools,
  command: string,
  conversationId = "conversation-1",
  signal?: AbortSignal,
): Promise<ToolResult> {
  return workspace.execute(
    "bash",
    { command, explanation: "A command for this test." },
    signal,
    conversationId,
  );
}

/** A helper that writes its process id and then runs until it is stopped. */
function helper(pidFile: string): string {
  const script =
    "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
  return `${bashPath(process.execPath)} -e ${JSON.stringify(script)} ${bashPath(pidFile)} & wait`;
}

describe.runIf(contained)("a command that outlasts its call", () => {
  it("carries on as a job, answers for it later, and tells the conversation when it ends", async () => {
    const { workspace, ended } = await tools();

    const started = await run(workspace, "echo first; sleep 3; echo second");

    expect(started).toMatchObject({
      ok: true,
      value: { job: "J1", status: "running" },
    });
    expect(started.ok && JSON.stringify(started.value)).toContain("first");
    const answer = await workspace.execute(
      "job_output",
      { job: "J1", waitSeconds: 20 },
      undefined,
      "conversation-1",
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { job: "J1", status: "finished", exitCode: 0 },
    });
    expect(answer.ok && JSON.stringify(answer.value)).toContain(
      "first\\nsecond",
    );
    await eventually(() => ended.length > 0);
    expect(ended).toEqual([
      {
        conversationId: "conversation-1",
        notice: expect.stringMatching(/^Job J1 .* finished with exit code 0\./),
        wakes: true,
      },
    ]);
  }, 30_000);

  it("is not stopped when the turn that started it is, once it is a job", async () => {
    const { root, workspace } = await tools();
    const pidFile = join(root, "helper.pid");
    const turn = new AbortController();

    await run(workspace, helper(pidFile), "conversation-1", turn.signal);
    turn.abort();
    const pid = Number(await readFile(pidFile, "utf8"));

    expect(
      await workspace.execute(
        "job_output",
        { job: "J1" },
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true, value: { status: "running" } });
    expect(alive(pid)).toBe(true);
    await workspace.stopCommands("conversation-1");
  }, 30_000);

  it("stops a job with everything it started, and says it was stopped", async () => {
    const { root, workspace, ended } = await tools();
    const pidFile = join(root, "helper.pid");
    await run(workspace, helper(pidFile));
    const pid = Number(await readFile(pidFile, "utf8"));

    const stopped = await workspace.execute(
      "stop_job",
      { job: "J1" },
      undefined,
      "conversation-1",
    );

    expect(stopped).toMatchObject({
      ok: true,
      value: { job: "J1", status: "stopped" },
    });
    await eventually(() => !alive(pid));
    // Stopped on purpose: nobody needs to be told it ended.
    expect(ended).toEqual([]);
  }, 30_000);

  it("shows a person a conversation's running jobs, why each was run, and what each has printed so far", async () => {
    const { workspace, changed } = await tools();

    await run(workspace, "echo first; sleep 3; echo second");

    expect(workspace.runningCommands("conversation-1")).toEqual([
      {
        id: "J1",
        command: "echo first; sleep 3; echo second",
        explanation: "A command for this test.",
        startedAt: expect.any(Number),
      },
    ]);
    expect(workspace.runningCommands("conversation-2")).toEqual([]);
    expect(
      (await workspace.commandOutput("conversation-1", "J1"))?.stdout,
    ).toContain("first");
    expect(changed).toContain("conversation-1");

    await workspace.execute(
      "job_output",
      { job: "J1", waitSeconds: 20 },
      undefined,
      "conversation-1",
    );
    await eventually(
      () => workspace.runningCommands("conversation-1").length === 0,
    );
    expect(changed.filter((id) => id === "conversation-1")).toHaveLength(2);
  }, 30_000);

  it("stops a job for the person, and tells the conversation without waking it", async () => {
    const { root, workspace, ended } = await tools();
    const pidFile = join(root, "helper.pid");
    await run(workspace, helper(pidFile));
    const pid = Number(await readFile(pidFile, "utf8"));

    await workspace.stopCommandForPerson("conversation-1", "J1");

    await eventually(() => !alive(pid));
    expect(workspace.runningCommands("conversation-1")).toEqual([]);
    expect(ended).toEqual([
      {
        conversationId: "conversation-1",
        notice: expect.stringMatching(/^Job J1 .* was stopped by the person\./),
        wakes: false,
      },
    ]);
    expect(
      await workspace.execute(
        "job_output",
        { job: "J1" },
        undefined,
        "conversation-1",
      ),
    ).toMatchObject({ ok: true, value: { job: "J1", status: "stopped" } });
  }, 30_000);

  it("leaves the list as it was when Zhiyin closes, so the conversation can be told after", async () => {
    const { root, workspace, changed } = await tools();
    const pidFile = join(root, "helper.pid");
    await run(workspace, helper(pidFile));
    const pid = Number(await readFile(pidFile, "utf8"));
    const before = changed.length;

    await workspace.stopAllCommands();

    await eventually(() => !alive(pid));
    expect(changed).toHaveLength(before);
  }, 30_000);

  it("stops a conversation's jobs when the conversation lets go of them, and no other's", async () => {
    const { root, workspace } = await tools();
    const mine = join(root, "mine.pid");
    const theirs = join(root, "theirs.pid");
    await run(workspace, helper(mine), "conversation-1");
    await run(workspace, helper(theirs), "conversation-2");
    const [minePid, theirPid] = await Promise.all(
      [mine, theirs].map(async (file) => Number(await readFile(file, "utf8"))),
    );

    await workspace.stopCommands("conversation-1");

    await eventually(() => !alive(minePid));
    expect(alive(theirPid)).toBe(true);
    await workspace.stopCommands("conversation-2");
  }, 30_000);

  it("answers only for the jobs of the conversation asking", async () => {
    const { root, workspace } = await tools();
    await run(workspace, helper(join(root, "helper.pid")), "conversation-1");

    expect(
      await workspace.execute(
        "job_output",
        { job: "J1" },
        undefined,
        "conversation-2",
      ),
    ).toEqual({
      ok: false,
      reason:
        "There is no job J1 in this conversation. A job stops when Zhiyin closes.",
    });
    await workspace.stopCommands("conversation-1");
  }, 30_000);

  it("runs a command to its end when the conversation already has three jobs", async () => {
    const { root, workspace } = await tools();
    for (const name of ["a", "b", "c"])
      await run(workspace, helper(join(root, `${name}.pid`)));

    const fourth = await run(workspace, "sleep 3; echo fourth");

    expect(fourth).toMatchObject({ ok: true, value: { exitCode: 0 } });
    expect(fourth.ok && JSON.stringify(fourth.value)).toContain("fourth");
    await workspace.stopCommands("conversation-1");
  }, 30_000);
});
