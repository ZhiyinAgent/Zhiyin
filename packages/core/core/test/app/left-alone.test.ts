/**
 * A conversation's browser and Blender each hold hundreds of megabytes, so
 * they are closed once the conversation has been left alone for a while. The
 * conversation keeps everything else, and both open again on their next use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelEvent } from "@zhiyin/model-client";
import { loopFrom, stubDependencies, until } from "./support.js";

const leftAlone = 15 * 60_000;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The app, with each conversation's browser and Blender saying when they close. */
function app() {
  const closed: string[] = [];
  const deps = stubDependencies(() => {});
  let held: Promise<void> = Promise.resolve();
  let taskNumber = 0;
  const loop = loopFrom({
    ...deps,
    newTaskId: () => `task-${++taskNumber}`,
    browsers: {
      ...deps.browsers,
      close: async (taskId) => {
        closed.push(`browser of ${taskId}`);
      },
    },
    scenes: {
      existing: () => undefined,
      onScene: () => () => true,
      close: async (taskId) => {
        closed.push(`Blender of ${taskId}`);
      },
      putAway: async () => {},
      forget: async () => {},
      closeAll: async () => {},
    },
    model: {
      ...deps.model,
      send: async function* (): AsyncGenerator<ModelEvent> {
        await held;
        yield { kind: "textDelta", text: "Done" };
        yield { kind: "done" };
      },
    },
  });
  return {
    loop,
    closed,
    /** The next answer waits until the returned function is called. */
    holdAnswer(): () => void {
      let answer!: () => void;
      held = new Promise<void>((resolve) => (answer = resolve));
      return answer;
    },
  };
}

describe("a conversation left alone", () => {
  it("closes its browser and Blender fifteen minutes after its turn ended and another was opened", async () => {
    const { loop, closed } = app();
    await loop.initialize();
    const first = await loop.createTask();
    await loop.start(first, "Look it up");
    await loop.createTask();

    await vi.advanceTimersByTimeAsync(leftAlone - 1_000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(closed).toEqual(["browser of task-1", "Blender of task-1"]);
  });

  it("keeps them while the conversation is the one on screen, however long it is left", async () => {
    const { loop, closed } = app();
    await loop.initialize();
    const shown = await loop.createTask();
    await loop.start(shown, "Look it up");

    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);

    expect(closed).toEqual([]);
  });

  it("keeps them while its turn runs, and closes them fifteen minutes after it ends", async () => {
    const { loop, closed, holdAnswer } = app();
    await loop.initialize();
    const working = await loop.createTask();
    const answer = holdAnswer();
    const turn = loop.start(working, "Take your time");
    await until(() => loop.turns.running(working));
    await loop.createTask();

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(closed).toEqual([]);
    answer();
    await turn;
    await vi.advanceTimersByTimeAsync(leftAlone - 1_000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(closed).toEqual(["browser of task-1", "Blender of task-1"]);
  });

  it("counts the fifteen minutes again from when the person comes back and leaves", async () => {
    const { loop, closed } = app();
    await loop.initialize();
    const first = await loop.createTask();
    await loop.start(first, "Look it up");
    await loop.createTask();

    await vi.advanceTimersByTimeAsync(leftAlone - 60_000);
    await loop.selectTask(first);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await loop.selectNothing();
    const ofFirst = () => closed.filter((what) => what.endsWith(first));
    await vi.advanceTimersByTimeAsync(leftAlone - 1_000);
    expect(ofFirst()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(ofFirst()).toEqual(["browser of task-1", "Blender of task-1"]);
  });

  it("closes nothing for a conversation that was deleted", async () => {
    const { loop, closed } = app();
    await loop.initialize();
    const first = await loop.createTask();
    await loop.start(first, "Look it up");
    await loop.createTask();
    await loop.deleteTask(first);

    await vi.advanceTimersByTimeAsync(2 * leftAlone);

    expect(closed).toEqual([]);
  });
});
