/**
 * A program that may change any file in its folder runs only with its folder
 * copied first (ADR 0012): a script whose folder cannot be copied is decided
 * as a change that cannot be undone, and one that cannot be copied again
 * just before it runs does not run. Copying is a stand-in here; the copies
 * themselves are tested in recovery, and going back through them in the core.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionEffects, ToolCallInspection } from "@zhiyin/contract";
import type { RunBackup as FolderCopyResult } from "@zhiyin/rewind";
import type { ModelRequest } from "@zhiyin/model-client";
import { heldForRun } from "../src/tools/held-for-run.js";
import { loopAndHost, stubDependencies } from "./support.js";

const sealedScript: ActionEffects = {
  reads: "workspace",
  changes: "workspace",
  sends: "none",
  actsAsPerson: "none",
  runs: "sealed",
  lasting: false,
  brings: "none",
};

function callsScriptOnce() {
  let turn = 0;
  return async function* (request: ModelRequest) {
    void request;
    turn += 1;
    if (turn === 1)
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "call-1",
        name: "run_python",
        argumentsDelta: "{}",
      };
    else yield { kind: "textDelta" as const, text: "Done." };
    yield { kind: "done" as const };
  };
}

/** A loop whose one tool is a sealed-off script, copying as `copies` answer in turn. */
function scripted(copies: readonly FolderCopyResult[]) {
  const deps = stubDependencies(() => {});
  const decided: (ActionEffects | undefined)[] = [];
  const ran: unknown[] = [];
  let copy = 0;
  const { host } = loopAndHost({
    ...deps,
    workspace: { ...deps.workspace, workspaceRoot: () => process.cwd() },
    recovery: {
      ...deps.recovery,
      copyFolder: async () =>
        copies[Math.min(copy++, copies.length - 1)] as FolderCopyResult,
    },
    tools: {
      list: () => [
        {
          name: "run_python",
          description: "Run a Python script.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Run a Python script",
        target: "a script",
        command: "print(1)",
        effects: sealedScript,
        changesAnyFile: { writable: [] },
      }),
      execute: async (_name, args) => {
        ran.push(args);
        return { ok: true, value: { exitCode: 0 } };
      },
    },
    permissions: {
      decide: async (request) => {
        decided.push(request.effects);
        return { outcome: "allow" as const, reason: "Test policy." };
      },
    },
    model: { ...deps.model, send: callsScriptOnce() },
  });
  return { loop: host.app, decided, ran };
}

describe("a sealed-off script", () => {
  it("is decided as it says, a change that can be undone, when its folder is copied", async () => {
    const { loop, decided, ran } = scripted([{ ok: true, uncopied: [] }]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Clean the table");

    expect(decided).toEqual([sealedScript]);
    expect(ran).toHaveLength(1);
  });

  it("is decided as a change that cannot be undone when its folder cannot be copied", async () => {
    const { loop, decided } = scripted([
      { ok: false, reason: "This folder has too many files." },
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Clean the table");

    expect(decided).toEqual([
      { ...sealedScript, changes: "workspace-for-good" },
    ]);
  });

  it("does not run when its folder cannot be copied again just before it runs, and the model is told why", async () => {
    const { loop, ran } = scripted([
      { ok: true, uncopied: [] },
      { ok: false, reason: "The recovery store could not be written." },
    ]);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Clean the table");

    const action = loop.snapshot().tasks[0]?.actions?.[0];
    expect(ran).toEqual([]);
    expect(action).toMatchObject({
      status: "failed",
      reason: expect.stringContaining(
        "The recovery store could not be written.",
      ),
    });
  });
});

describe("a sealed-off script given a folder outside the workspace", () => {
  const elsewhere = tmpdir();
  const changesElsewhere: ActionEffects = {
    ...sealedScript,
    reads: "elsewhere",
    changes: "elsewhere",
  };

  /** A loop whose one tool is such a script; `copies` answers each folder's copy. */
  function scriptedElsewhere(
    copies: (folder: string, outside: boolean) => FolderCopyResult,
  ) {
    const deps = stubDependencies(() => {});
    const decided: (ActionEffects | undefined)[] = [];
    const copied: { folder: string; outside: boolean; begins: boolean }[] = [];
    const ran: unknown[] = [];
    const { host } = loopAndHost({
      ...deps,
      workspace: { ...deps.workspace, workspaceRoot: () => process.cwd() },
      recovery: {
        ...deps.recovery,
        copyFolder: async (_actionId, folder, _conversationId, options) => {
          const outside = options?.outside === true;
          copied.push({ folder, outside, begins: options?.begins === true });
          return copies(folder, outside);
        },
      },
      tools: {
        list: () => [
          {
            name: "run_python",
            description: "Run a Python script.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: true,
          action: "Run a Python script",
          target: "a script",
          command: "print(1)",
          effects: changesElsewhere,
          changesAnyFile: { writable: [], outside: [elsewhere] },
        }),
        execute: async (_name, args) => {
          ran.push(args);
          return { ok: true, value: { exitCode: 0 } };
        },
      },
      permissions: {
        decide: async (request) => {
          decided.push(request.effects);
          return { outcome: "allow" as const, reason: "Test policy." };
        },
      },
      model: { ...deps.model, send: callsScriptOnce() },
    });
    return { loop: host.app, decided, copied, ran };
  }

  it("has that folder copied with the workspace before approval and as it runs, and is decided as a change elsewhere that can be undone", async () => {
    const { loop, decided, copied, ran } = scriptedElsewhere(() => ({
      ok: true,
      uncopied: [],
    }));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Tidy the exports");

    expect(decided).toEqual([changesElsewhere]);
    expect(copied.filter((copy) => copy.outside)).toEqual([
      expect.objectContaining({ outside: true, begins: false }),
      expect.objectContaining({ outside: true, begins: true }),
    ]);
    expect(copied.filter((copy) => !copy.outside)).toHaveLength(2);
    expect(ran).toHaveLength(1);
  });

  it("is decided as a change that cannot be undone when that folder cannot be copied", async () => {
    const { loop, decided } = scriptedElsewhere((_folder, outside) =>
      outside
        ? { ok: false, reason: "This folder has too many files." }
        : { ok: true, uncopied: [] },
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Tidy the exports");

    expect(decided).toEqual([
      { ...changesElsewhere, changes: "workspace-for-good" },
    ]);
  });
});

describe("what the model is told of the files a script could only read", () => {
  const held = [
    {
      path: "data/big.parquet",
      reason: "It is larger than the 10 MiB recovery limit.",
    },
    {
      path: ".git/config",
      reason:
        "Git's configuration and hooks decide what a later git run starts.",
    },
  ];

  it("names each, says why, and how to change one, when the run failed", () => {
    const told = heldForRun(
      held,
      { ok: false, reason: "PermissionError: [Errno 13]" },
      "change_locked",
    );

    expect(told).toContain("data/big.parquet: It is larger than");
    expect(told).toContain(".git/config");
    expect(told).toContain("`change_locked`");
  });

  it("names only the held files the answer mentions", () => {
    const told = heldForRun(
      held,
      { ok: true, value: { stderr: "could not write big.parquet" } },
      "change_locked",
    );

    expect(told).toContain("data/big.parquet");
    expect(told).not.toContain(".git/config:");
  });

  it("is nothing when the run went well and mentions none of them", () => {
    expect(
      heldForRun(held, { ok: true, value: { stdout: "42" } }, "change_locked"),
    ).toBeUndefined();
  });

  it("names a file in a folder outside the workspace by its whole path, when the answer mentions it", () => {
    const outside = join("D:", "Exports", "huge.exr");

    const told = heldForRun(
      [
        {
          path: outside,
          reason: "It is larger than the 10 MiB recovery limit.",
          kind: "uncopied",
        },
      ],
      { ok: true, value: { stderr: "could not write huge.exr" } },
      "change_locked",
    );

    expect(told).toContain(`${outside}: It is larger than`);
    expect(told).toContain("`change_locked`");
  });

  it("says a Startup folder can only be read, and offers no way to change it", () => {
    const startup = join("C:", "Users", "x", "Startup");

    const told = heldForRun(
      [
        {
          path: startup,
          reason: "Windows starts what is put there.",
          kind: "startup",
        },
      ],
      { ok: false, reason: "PermissionError: [Errno 13]" },
      "change_locked",
    );

    expect(told).toContain(startup);
    expect(told).toContain("A Startup folder can only be read");
    expect(told).not.toContain("`change_locked`");
  });
});
