/**
 * When long work stops to ask whether to go on, as the person sets it in
 * Settings: saved with their other choices, and what every turn after it is
 * held to.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CHANNEL,
  defaultWorkPauses,
  type ToolCallInspection,
} from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { Core } from "../../src/index.js";
import { calls, loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** An app whose model looks at the folder again and again, allowed each time. */
async function looking(root?: string) {
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    ...(root ? { sessions: new FileSessions(root) } : {}),
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Reads." }),
    },
    tools: {
      list: () => [
        {
          name: "look",
          description: "Look at the folder.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Look at the folder",
        target: "workspace",
        command: "look({})",
        access: "read",
        scope: "workspace",
      }),
      execute: async () => ({ ok: true, value: "seen" }),
    },
    model: {
      ...deps.model,
      send: calls(
        ...Array.from(
          { length: 80 },
          () => ["look", {}] as [string, Record<string, unknown>],
        ),
      ),
    },
  });
  await app.initialize();
  return app;
}

function coreFor(app: Awaited<ReturnType<typeof looking>>) {
  return new Core({
    workspace: app,
    dataFolder: "C:/data",
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
}

const chosen = { rounds: 6, minutes: 90, dollars: 25, yuan: 180 };

describe("when long work stops to ask", () => {
  it("is set from the window with every limit a whole number in its range, and nothing else", async () => {
    const app = await looking();
    const core = coreFor(app);

    await core.receive(CHANNEL.setWorkPauses, [chosen]);
    expect(app.snapshot().workPauses).toEqual(chosen);
    await core.receive(CHANNEL.setWorkPauses, [defaultWorkPauses]);
    expect(app.snapshot().workPauses).toBeUndefined();

    for (const refused of [
      { ...chosen, rounds: 0 },
      { ...chosen, rounds: 6.5 },
      { ...chosen, minutes: 1_441 },
      { ...chosen, dollars: "25" },
      { rounds: 6, minutes: 90, dollars: 25 },
      { ...chosen, tokens: 1_000 },
      null,
    ])
      await expect(
        core.receive(CHANNEL.setWorkPauses, [refused]),
      ).rejects.toThrow();
    expect(app.snapshot().workPauses).toBeUndefined();
  });

  it("is kept across a restart", async () => {
    const root = await folders.make("zhiyin-pauses-");
    const before = await looking(root);
    await before.choices.setWorkPauses(chosen);
    await before.shutdown();

    const after = await looking(root);

    expect(after.snapshot().workPauses).toEqual(chosen);
  });

  it("holds the next task to the rounds set", async () => {
    const app = await looking();
    await app.choices.setWorkPauses(chosen);
    const taskId = await app.createTask();

    const running = app.start(taskId, "Look around");
    await until(() => app.snapshot().tasks.at(-1)?.phase.kind === "input");

    const phase = app.snapshot().tasks.at(-1)?.phase;
    expect(phase).toMatchObject({
      kind: "input",
      prompt: {
        kind: "workBudget",
        completedRounds: 6,
        reached: ["toolRounds"],
        allowance: { toolRounds: 12, elapsedMs: 90 * 60_000 },
      },
    });
    if (phase?.kind !== "input") throw new Error("Not waiting.");
    await app.resolveUserInput(taskId, phase.prompt.id, {
      answers: [{ questionId: "work-budget", answerIds: ["pause"] }],
    });
    await running;
  });
});
