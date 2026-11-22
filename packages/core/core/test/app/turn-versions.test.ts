/**
 * Going back through the app to the files as each message found them (ADR
 * 0031), with file recovery's real watch: from each turn's start, a file of
 * the conversation's folder is held, and its first write in the turn waits
 * until it is saved, whatever program writes it.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { FileRecovery } from "@zhiyin/recovery";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import { WorkspaceTools } from "@zhiyin/tools";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { RunningCommand } from "@zhiyin/contract";
import { jobsWith, loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();
const open: FileRecovery[] = [];

afterEach(async () => {
  for (const recovery of open.splice(0)) await recovery.close();
  await folders.removeAll();
});

/** A picture's bytes, unlike text in every byte. */
const ink = (shade: number) =>
  Buffer.from(Array.from({ length: 64 * 1024 }, (_, at) => (at * shade) % 251));

describe("going back to a message", { timeout: 60_000 }, () => {
  it("puts a file back as the message found it: as the turn before made it, or not there at all", async () => {
    const root = await folders.make("zhiyin-turn-versions-");
    const storage = await folders.make("zhiyin-turn-versions-store-");
    await writeFile(join(root, "notes.txt"), "the person's notes");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const asked: string[] = [];
    const recovery = new FileRecovery(storage, {
      list: workspace.listWorkspace,
      watch: sourceWatchThread,
      ask: async ({ path }) => {
        asked.push(path);
        return "refuse";
      },
    });
    open.push(recovery);
    const deps = stubDependencies(() => {});
    // Each turn runs one script, which writes the picture as run_python
    // does: what it changes is said nowhere in its call.
    const shades = [3, 7];
    let request = 0;
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: {
        list: () => [
          {
            name: "run_python",
            description: "Run a Python script.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Run a Python script",
          target: "a script",
          command: "from PIL import Image",
          effects: {
            reads: "workspace" as const,
            changes: "workspace" as const,
            sends: "none" as const,
            actsAsPerson: "none" as const,
            runs: "sealed" as const,
            lasting: false,
            brings: "none" as const,
          },
          changesAnyFile: { writable: [] },
        }),
        execute: async () => {
          await writeFile(join(root, "ink.tif"), ink(shades.shift()!));
          return { ok: true as const, value: { exitCode: 0 } };
        },
      },
      workspace,
      recovery,
      rewind: new ConversationRewind(() => `rewind-${request}`),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request % 2 === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: `script-${request}`,
              name: "run_python",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta", text: "Done" };
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "Draw the ink");
    await agent.start(taskId, "Darken the ink");
    expect(await readFile(join(root, "ink.tif"))).toEqual(ink(7));
    // The budget holds the picture, so the person was asked nothing.
    expect(asked).toEqual([]);
    const message = (text: string) =>
      agent.snapshot().tasks[0]!.messages.find((each) => each.text === text)!;

    const second = await agent.rewinds.preview(
      taskId,
      message("Darken the ink").id,
    );
    const toSecond = await agent.commitRewind(taskId, second.id, "restore");

    expect(toSecond.files).toEqual([{ path: "ink.tif", status: "restored" }]);
    expect(await readFile(join(root, "ink.tif"))).toEqual(ink(3));

    const first = await agent.rewinds.preview(
      taskId,
      message("Draw the ink").id,
    );
    const toFirst = await agent.commitRewind(taskId, first.id, "restore");

    expect(toFirst.files).toEqual([{ path: "ink.tif", status: "removed" }]);
    expect(await readdir(root)).toEqual(["notes.txt"]);
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
      "the person's notes",
    );
  });

  it("keeps a file a job wrote after its turn ended as the turn found it, so going back puts it back", async () => {
    const root = await folders.make("zhiyin-job-versions-");
    const storage = await folders.make("zhiyin-job-versions-store-");
    await writeFile(join(root, "data.csv"), "as the first turn found it");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const recovery = new FileRecovery(storage, {
      list: workspace.listWorkspace,
      watch: sourceWatchThread,
    });
    open.push(recovery);
    const deps = stubDependencies(() => {});
    let running: RunningCommand[] = [];
    let request = 0;
    const app = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: {
        list: () => [
          {
            name: "run_command",
            description: "Run a command.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Run a command",
          target: "the folder",
          command: "python clean.py",
          effects: {
            reads: "workspace" as const,
            changes: "workspace" as const,
            sends: "none" as const,
            actsAsPerson: "none" as const,
            runs: "sealed" as const,
            lasting: false,
            brings: "none" as const,
          },
          changesAnyFile: { writable: [] },
        }),
        // It carries on as a job after the call returns.
        execute: async () => {
          running = [
            {
              id: "J1",
              command: "python clean.py",
              explanation: "Cleans the data.",
              startedAt: 1_000,
            },
          ];
          return {
            ok: true as const,
            value: "Carried on as job J1.",
            commandChanges: { status: "running" as const, job: "J1" },
          };
        },
      },
      commands: jobsWith({ runningCommands: () => running }),
      workspace,
      recovery,
      rewind: new ConversationRewind(() => `rewind-${request}`),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "command-1",
              name: "run_command",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta", text: "Done" };
          yield { kind: "done" };
        },
      },
    });
    await app.selectWorkspace(root);
    const taskId = await app.createTask();
    await app.start(taskId, "Clean the data");
    // As the app tells the loop of the job it started.
    await app.commandsChanged(taskId);

    // The turn is over; the job goes on, rewrites the file, then ends.
    await writeFile(join(root, "data.csv"), "as the job left it");
    running = [];
    await app.commandsChanged(taskId);
    await app.jobChanged(taskId, "J1", {
      status: "checked",
      job: "J1",
      files: [{ path: "data.csv", change: "updated" }],
    });
    const first = app
      .snapshot()
      .tasks[0]!.messages.find((each) => each.text === "Clean the data")!;
    const back = await app.rewinds.preview(taskId, first.id);
    const result = await app.commitRewind(taskId, back.id, "restore");

    expect(result.files).toEqual([{ path: "data.csv", status: "restored" }]);
    expect(await readFile(join(root, "data.csv"), "utf8")).toBe(
      "as the first turn found it",
    );
  });

  it("puts a file back as a message the person added during a turn found it, not as the turn did", async () => {
    const root = await folders.make("zhiyin-added-message-versions-");
    const storage = await folders.make("zhiyin-added-message-store-");
    await writeFile(join(root, "data.txt"), "zero");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const recovery = new FileRecovery(storage, {
      list: workspace.listWorkspace,
      watch: sourceWatchThread,
    });
    open.push(recovery);
    const deps = stubDependencies(() => {});
    const written = ["one", "two"];
    let request = 0;
    let taskId = "";
    const app = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: {
        list: () => [
          {
            name: "run_python",
            description: "Run a Python script.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Run a Python script",
          target: "a script",
          command: "open('data.txt', 'w')",
          effects: {
            reads: "workspace" as const,
            changes: "workspace" as const,
            sends: "none" as const,
            actsAsPerson: "none" as const,
            runs: "sealed" as const,
            lasting: false,
            brings: "none" as const,
          },
          changesAnyFile: { writable: [] },
        }),
        execute: async () => {
          const text = written.shift()!;
          await writeFile(join(root, "data.txt"), text);
          // The person adds a message while the first script runs.
          if (text === "one")
            await app.start(taskId, "Make it two", undefined, [], "guidance");
          return { ok: true as const, value: { exitCode: 0 } };
        },
      },
      workspace,
      recovery,
      rewind: new ConversationRewind(() => `rewind-${request}`),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request <= 2)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: `script-${request}`,
              name: "run_python",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta", text: "Done" };
          yield { kind: "done" };
        },
      },
    });
    await app.selectWorkspace(root);
    taskId = await app.createTask();
    await app.start(taskId, "Write one");
    expect(await readFile(join(root, "data.txt"), "utf8")).toBe("two");
    const message = (text: string) =>
      app.snapshot().tasks[0]!.messages.find((each) => each.text === text)!;

    const added = await app.rewinds.preview(taskId, message("Make it two").id);
    await app.commitRewind(taskId, added.id, "restore");
    expect(await readFile(join(root, "data.txt"), "utf8")).toBe("one");

    const first = await app.rewinds.preview(taskId, message("Write one").id);
    await app.commitRewind(taskId, first.id, "restore");
    expect(await readFile(join(root, "data.txt"), "utf8")).toBe("zero");
  });

  it("keeps the files of a folder outside the conversation's, granted for its changes, as each turn found them", async () => {
    const parent = await folders.make("zhiyin-granted-versions-");
    const root = join(parent, "workspace");
    const elsewhere = join(parent, "elsewhere");
    const storage = await folders.make("zhiyin-granted-versions-store-");
    await mkdir(root);
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "table.csv"), "as the person left it");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const recovery = new FileRecovery(storage, {
      list: workspace.listWorkspace,
      watch: sourceWatchThread,
    });
    open.push(recovery);
    const deps = stubDependencies(() => {});
    const written = ["as the first script left it", "as the second left it"];
    let request = 0;
    const app = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: {
        list: () => [
          {
            name: "run_python",
            description: "Run a Python script.",
            inputSchema: { type: "object" },
          },
        ],
        // A script given the folder outside to change, as run_python is.
        inspect: async () => ({
          ok: true as const,
          action: "Run a Python script",
          target: "a script",
          command: "import csv",
          effects: {
            reads: "workspace" as const,
            changes: "elsewhere" as const,
            sends: "none" as const,
            actsAsPerson: "none" as const,
            runs: "sealed" as const,
            lasting: false,
            brings: "none" as const,
          },
          changesAnyFile: { writable: [], outside: [elsewhere] },
        }),
        execute: async () => {
          await writeFile(join(elsewhere, "table.csv"), written.shift()!);
          return { ok: true as const, value: { exitCode: 0 } };
        },
      },
      workspace,
      recovery,
      rewind: new ConversationRewind(() => `rewind-${request}`),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          // In the second turn, before its script, something else writes it.
          if (request === 3)
            await writeFile(join(elsewhere, "table.csv"), "written meanwhile");
          if (request % 2 === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: `script-${request}`,
              name: "run_python",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta", text: "Done" };
          yield { kind: "done" };
        },
      },
    });
    await app.selectWorkspace(root);
    const taskId = await app.createTask();
    let finished = false;
    const first = app.start(taskId, "Fill the table").finally(() => {
      finished = true;
    });
    await until(
      () => finished || app.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = app.snapshot().tasks[0]!.phase;
    if (phase.kind === "approval")
      await app.resolveApproval(taskId, phase.prompt.id, "allow-folder");
    await first;
    await app.start(taskId, "Fill it again");
    expect(await readFile(join(elsewhere, "table.csv"), "utf8")).toBe(
      "as the second left it",
    );
    const message = (text: string) =>
      app.snapshot().tasks[0]!.messages.find((each) => each.text === text)!;

    const back = await app.rewinds.preview(taskId, message("Fill it again").id);
    await app.commitRewind(taskId, back.id, "restore");

    expect(await readFile(join(elsewhere, "table.csv"), "utf8")).toBe(
      "as the first script left it",
    );
  });

  it("offers prepare_change, which saves a file of the conversation's folder and refuses one outside it", async () => {
    const root = await folders.make("zhiyin-prepare-change-");
    const storage = await folders.make("zhiyin-prepare-change-store-");
    await writeFile(join(root, "scan.tif"), ink(5));
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const recovery = new FileRecovery(storage, {
      list: workspace.listWorkspace,
      watch: sourceWatchThread,
    });
    open.push(recovery);
    const deps = stubDependencies(() => {});
    const sent: string[] = [];
    const offered: string[][] = [];
    let request = 0;
    const agent = loopFrom({
      ...deps,
      tools: workspace,
      workspace,
      recovery,
      rewind: new ConversationRewind(() => "rewind"),
      model: {
        ...deps.model,
        send: async function* (asked) {
          request += 1;
          offered.push((asked.tools ?? []).map((tool) => tool.name));
          sent.push(JSON.stringify(asked.messages.at(-1)));
          if (request < 3)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: `prepare-${request}`,
              name: "prepare_change",
              argumentsDelta: JSON.stringify({
                path: request === 1 ? "scan.tif" : "../elsewhere.tif",
              }),
            };
          else yield { kind: "textDelta", text: "Done" };
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "Get the scan ready");

    expect(offered[0]).toContain("prepare_change");
    expect(sent[1]).toContain("scan.tif");
    expect(sent[1]).toContain("Run the command that changes it now.");
    expect(sent[2]).toContain(
      "../elsewhere.tif is not a file inside the folder.",
    );
    expect(await readFile(join(root, "scan.tif"))).toEqual(ink(5));
  });
});

describe(
  "a first write the undo budget has no room for",
  { timeout: 60_000 },
  () => {
    /** A turn whose script rewrites a picture past the budget, and the app around it. */
    async function scripted() {
      const root = await folders.make("zhiyin-undo-room-");
      const storage = await folders.make("zhiyin-undo-room-store-");
      await writeFile(join(root, "big.tif"), ink(3));
      const workspace = new WorkspaceTools(root, { shell: undefined });
      const recovery = new FileRecovery(storage, {
        list: workspace.listWorkspace,
        watch: sourceWatchThread,
        // Less room than the picture takes.
        limits: { totalBytes: 16 * 1024 },
        ask: async ({ conversationId, path, bytes, roomBytes, budgetBytes }) =>
          app.askUndoRoom(conversationId!, {
            path,
            bytes,
            roomBytes,
            budgetBytes,
          }),
      });
      open.push(recovery);
      const deps = stubDependencies(() => {});
      const written: string[] = [];
      let request = 0;
      const app = loopFrom({
        ...deps,
        permissions: {
          decide: async () => ({ outcome: "allow", reason: "Test policy." }),
        },
        tools: {
          list: () => [
            {
              name: "run_python",
              description: "Run a Python script.",
              inputSchema: { type: "object" },
            },
          ],
          inspect: async () => ({
            ok: true as const,
            action: "Run a Python script",
            target: "a script",
            command: "from PIL import Image",
            effects: {
              reads: "workspace" as const,
              changes: "workspace" as const,
              sends: "none" as const,
              actsAsPerson: "none" as const,
              runs: "sealed" as const,
              lasting: false,
              brings: "none" as const,
            },
            changesAnyFile: { writable: [] },
          }),
          execute: async () => {
            const wrote = await writeFile(join(root, "big.tif"), ink(7)).then(
              () => "written",
              (error: NodeJS.ErrnoException) => error.code ?? "failed",
            );
            written.push(wrote);
            return { ok: true as const, value: { exitCode: 0 } };
          },
        },
        workspace,
        recovery,
        rewind: new ConversationRewind(() => "rewind"),
        model: {
          ...deps.model,
          send: async function* () {
            request += 1;
            if (request === 1)
              yield {
                kind: "toolCallDelta",
                index: 0,
                callId: "script-1",
                name: "run_python",
                argumentsDelta: "{}",
              };
            else yield { kind: "textDelta", text: "Done" };
            yield { kind: "done" };
          },
        },
      });
      await app.selectWorkspace(root);
      const taskId = await app.createTask();
      const running = app.start(taskId, "Darken the picture");
      await until(() => app.snapshot().tasks[0]?.phase.kind === "input");
      const phase = app.snapshot().tasks[0]!.phase;
      if (phase.kind !== "input") throw new Error("No question was asked.");
      return { app, root, taskId, running, prompt: phase.prompt, written };
    }

    it("asks in the conversation, naming the file, its size and the room left, while the program waits", async () => {
      const { app, taskId, running, prompt, written } = await scripted();

      expect(prompt).toMatchObject({
        kind: "undoRoom",
        path: "big.tif",
        bytes: 64 * 1024,
        budgetBytes: 16 * 1024,
      });
      expect(written).toEqual([]);
      await app.resolveUserInput(taskId, prompt.id, {
        answers: [{ questionId: "undo-room", answerIds: ["refuse"] }],
      });
      await running;
    });

    it("refuses, asking nobody, a write that needs room while no turn of its conversation runs", async () => {
      const deps = stubDependencies(() => {}, [
        { kind: "textDelta", text: "Done" },
        { kind: "done" },
      ]);
      const app = loopFrom({
        ...deps,
        rewind: new ConversationRewind(() => "rewind"),
      });
      const taskId = await app.createTask();
      await app.start(taskId, "Hello");

      expect(
        await app.askUndoRoom(taskId, {
          path: "big.tif",
          bytes: 64 * 1024,
          roomBytes: 0,
          budgetBytes: 16 * 1024,
        }),
      ).toBe("refuse");
      expect(app.snapshot().tasks[0]!.phase.kind).toBe("completed");
    });

    it("lets the program change the file without a backup when the person says so", async () => {
      const { app, root, taskId, running, prompt, written } = await scripted();

      await app.resolveUserInput(taskId, prompt.id, {
        answers: [{ questionId: "undo-room", answerIds: ["without"] }],
      });
      await running;

      expect(written).toEqual(["written"]);
      expect(await readFile(join(root, "big.tif"))).toEqual(ink(7));
    });

    it("refuses the program's change when the person refuses, leaving the file as it was", async () => {
      const { app, root, taskId, running, prompt, written } = await scripted();

      await app.resolveUserInput(taskId, prompt.id, {
        answers: [{ questionId: "undo-room", answerIds: ["refuse"] }],
      });
      await running;

      expect(written).toEqual(["EBUSY"]);
      expect(await readFile(join(root, "big.tif"))).toEqual(ink(3));
    });
  },
);
