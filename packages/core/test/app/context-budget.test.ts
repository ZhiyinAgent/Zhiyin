/**
 * The budget a conversation is kept under, as the person chose it: their own
 * default for every conversation, and a conversation's own choice over it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL, emptyConversationLists } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies, until } from "./support.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function appAt(root: string) {
  let created = 0;
  const app = loopFrom({
    ...stubDependencies(() => {}),
    newTaskId: () => `task-${++created}`,
    sessions: new FileSessions(root),
    revealDelayMs: 0,
  });
  await app.initialize();
  return app;
}

describe("the context budget a person chooses", () => {
  it("is kept for one conversation, while the others follow the default, across a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-budget-"));
    roots.push(root);
    const app = await appAt(root);
    const chosen = await app.createTask();
    const following = await app.createTask();

    await app.setDefaultContextBudget("ultra");
    await app.setContextBudget(chosen, "low");
    await app.shutdown();

    const reopened = await appAt(root);
    await reopened.selectTask(chosen);
    await reopened.selectTask(following);
    const snapshot = reopened.snapshot();
    expect(snapshot.contextBudget).toBe("ultra");
    expect(
      snapshot.tasks.find((task) => task.id === chosen)?.contextBudget,
    ).toBe("low");
    expect(
      snapshot.tasks.find((task) => task.id === following)?.contextBudget,
    ).toBeUndefined();
  });

  it("is refused from the window unless it is one of the three budgets", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      commands: {
        runningCommands: () => [],
        commandOutput: async () => undefined,
        stopCommandForPerson: async () => {},
        onCommandsChanged: () => {},
      },
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
      showInFolder: async () => {},
      version: "1.0.0",
    });
    const taskId = await app.createTask();

    await expect(
      core.receive(CHANNEL.setContextBudget, [taskId, "huge"]),
    ).rejects.toThrow();
    await expect(
      core.receive(CHANNEL.setDefaultContextBudget, ["huge"]),
    ).rejects.toThrow();
    await core.receive(CHANNEL.setContextBudget, [taskId, "medium"]);

    expect(app.snapshot().tasks[0]?.contextBudget).toBe("medium");
  });

  it("tells the window a conversation is compacting, and when it has finished", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-budget-"));
    roots.push(root);
    const taskId = "task-1";
    await new FileSessions(root).saveWorkspace({
      tasks: [
        {
          id: taskId,
          title: "Release notes",
          titleSource: "manual",
          updatedAt: "2026-10-07T09:00:00.000Z",
          updatedLabel: "Earlier",
          ...emptyConversationLists,
          messages: [
            { id: "m1", role: "user", text: "Read it", sequence: 0 },
            {
              id: "m2",
              role: "assistant",
              text: "OLDER MATERIAL ".repeat(800),
              sequence: 1,
            },
            { id: "m3", role: "user", text: "Next", sequence: 2 },
            { id: "m4", role: "assistant", text: "Done.", sequence: 3 },
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Done", summary: "Done." },
          },
        },
      ],
      selectedTaskId: taskId,
      recentWorkspaces: [],
    });
    const told: (readonly string[] | undefined)[] = [];
    // What the window is told, whole or as a change.
    const deps = stubDependencies((event) => {
      if (event.kind === "workspaceSnapshot") told.push(event.data.compacting);
      if (event.kind === "workspaceChanged") {
        if (event.data.fields?.compacting)
          told.push(event.data.fields.compacting);
        if (event.data.cleared?.includes("compacting")) told.push(undefined);
      }
    });
    const app = loopFrom({
      ...deps,
      sessions: new FileSessions(root),
      revealDelayMs: 0,
      model: {
        ...deps.model,
        // A small window, so the older reply is worth summarising.
        settings: async () => ({
          ...(await deps.model.settings()),
          contextWindow: 16_000,
          maximumOutputTokens: 100,
        }),
        send: async function* () {
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({ summary: "It was read." }),
          };
          yield { kind: "done" as const };
        },
      },
    });
    await app.initialize();
    await until(() => app.settings.current()?.contextWindow === 16_000);

    await app.turns.condenseNow(taskId);

    expect(app.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({ outcome: "condensed" }),
    ]);
    expect(told).toContainEqual([taskId]);
    expect(told.at(-1)).toBeUndefined();
    expect(app.snapshot().compacting).toBeUndefined();
  });

  it("has a conversation condensed when the window asks, and refuses a request naming none", async () => {
    const app = loopFrom(stubDependencies(() => {}));
    await app.initialize();
    const core = new Core({
      workspace: app,
      ownership: { claim: async () => {}, release: async () => {} },
      viewChecks: { answer: () => {}, abandon: () => {} },
      commands: {
        runningCommands: () => [],
        commandOutput: async () => undefined,
        stopCommandForPerson: async () => {},
        onCommandsChanged: () => {},
      },
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
      showInFolder: async () => {},
      version: "1.0.0",
    });
    const taskId = await app.createTask();

    await expect(core.receive(CHANNEL.condenseNow, [])).rejects.toThrow();
    await core.receive(CHANNEL.condenseNow, [taskId]);

    expect(app.snapshot().tasks[0]?.condensings).toEqual([
      expect.objectContaining({
        outcome: "failed",
        reason: "nothing-to-condense",
      }),
    ]);
  });
});
