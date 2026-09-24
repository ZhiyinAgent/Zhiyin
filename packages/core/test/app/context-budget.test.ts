/**
 * The budget a conversation is kept under, as the person chose it: their own
 * default for every conversation, and a conversation's own choice over it.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { Core } from "../../src/index.js";
import { loopFrom, stubDependencies } from "./support.js";

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
      chooseFolder: async () => undefined,
      chooseSaveLocation: async () => undefined,
      openExternal: async () => {},
      openPath: async () => {},
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
});
