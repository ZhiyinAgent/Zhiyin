/**
 * When the turn now running began, as the window is told it. The window counts
 * "Working" from it, so it has to belong to this conversation and to this
 * turn: a later turn counts from its own start, and a conversation with no
 * turn running carries none.
 */

import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function clockedLoop() {
  const clock = { now: new Date("2026-10-19T09:00:00.000Z") };
  const requests: ModelRequest[] = [];
  const held: (() => void)[] = [];
  const deps = stubDependencies(() => {});
  const app = loopFrom({
    ...deps,
    revealDelayMs: 0,
    now: () => clock.now,
    model: {
      ...deps.model,
      // Every answer comes in two parts, each held until the test lets it go.
      send: async function* (request) {
        requests.push(request);
        yield { kind: "textDelta" as const, text: "Done." };
        await new Promise<void>((resolve) => held.push(resolve));
        yield { kind: "textDelta" as const, text: " More." };
        await new Promise<void>((resolve) => held.push(resolve));
        yield { kind: "done" as const };
      },
    },
  });
  const conversation = (taskId: string) =>
    app.snapshot().tasks.find((task) => task.id === taskId);
  const advance = (seconds: number) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1_000);
  };
  const letGo = async () => {
    await until(() => held.length > 0);
    held.shift()?.();
  };
  const finishAnswer = async (taskId: string) => {
    while (conversation(taskId)?.phase.kind !== "completed") {
      await until(
        () =>
          held.length > 0 || conversation(taskId)?.phase.kind === "completed",
      );
      held.shift()?.();
    }
  };
  return { app, conversation, advance, letGo, finishAnswer, requests };
}

describe("when the turn now running began", () => {
  it("is when the person's message started it, kept while the turn works, and gone once it ends", async () => {
    const { app, conversation, advance, letGo, finishAnswer } = clockedLoop();
    await app.initialize();
    const taskId = await app.createTask();
    expect(conversation(taskId)?.turnStartedAt).toBeUndefined();

    void app.start(taskId, "Write the notes");
    await until(() => conversation(taskId)?.messages.at(-1)?.text === "Done.");
    advance(90);
    // A later revision of the same turn keeps its start.
    await letGo();
    await until(
      () => conversation(taskId)?.messages.at(-1)?.text === "Done. More.",
    );

    expect(conversation(taskId)?.phase.kind).toBe("working");
    expect(conversation(taskId)?.turnStartedAt).toBe(
      "2026-10-19T09:00:00.000Z",
    );

    await finishAnswer(taskId);
    expect(conversation(taskId)?.turnStartedAt).toBeUndefined();
  });

  it("is a later turn's own start, not the earlier turn's", async () => {
    const { app, conversation, advance, finishAnswer, requests } =
      clockedLoop();
    await app.initialize();
    const taskId = await app.createTask();

    void app.start(taskId, "Write the notes");
    await until(() => requests.length === 1);
    await finishAnswer(taskId);
    advance(180);
    void app.start(taskId, "Shorter, please");
    await until(() => requests.length === 2);

    expect(conversation(taskId)?.turnStartedAt).toBe(
      "2026-10-19T09:03:00.000Z",
    );
    await finishAnswer(taskId);
  });

  it("belongs to each conversation alone", async () => {
    const { app, conversation, advance, finishAnswer, requests } =
      clockedLoop();
    await app.initialize();
    const first = await app.createTask();
    const second = await app.createTask();

    void app.start(first, "Write the notes");
    await until(() => requests.length === 1);
    advance(180);
    void app.start(second, "Check the figures");
    await until(() => requests.length === 2);

    expect(conversation(first)?.turnStartedAt).toBe("2026-10-19T09:00:00.000Z");
    expect(conversation(second)?.turnStartedAt).toBe(
      "2026-10-19T09:03:00.000Z",
    );
    await finishAnswer(first);
    await finishAnswer(second);
  });

  it("is gone from a turn the app closed during, once it is opened again", async () => {
    const root = await folders.make("zhiyin-turn-time-");
    await new FileSessions(root).saveWorkspace({
      tasks: [
        {
          id: "task-1",
          title: "Release notes",
          titleSource: "manual",
          updatedAt: "2026-10-19T09:00:00.000Z",
          updatedLabel: "Earlier",
          ...emptyConversationLists,
          messages: [
            { id: "m1", role: "user", text: "Write the notes", sequence: 0 },
          ],
          phase: { kind: "working", steps: [] },
          turnStartedAt: "2026-10-19T09:00:00.000Z",
        },
      ],
      selectedTaskId: "task-1",
      recentWorkspaces: [],
    });
    const app = loopFrom({
      ...stubDependencies(() => {}),
      sessions: new FileSessions(root),
    });

    await app.initialize();

    const reopened = app.snapshot().tasks[0];
    expect(reopened?.phase.kind).toBe("interrupted");
    expect(reopened?.turnStartedAt).toBeUndefined();
  });
});
