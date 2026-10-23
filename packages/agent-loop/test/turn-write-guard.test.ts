/**
 * A durable write belongs to the turn that made it (ADR 0007). Once that turn
 * is stopped, nothing it writes lands, whoever holds the conversation by then
 * and whether or not its own code remembered to check: the stop and the end a
 * stopped specialist records are written on no turn's behalf.
 */

import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../src/dependencies.js";
import { TurnOwnership } from "../src/turn/turn-ownership.js";
import { TurnRecords } from "../src/turn/turn-records.js";
import { turnWriteGuard } from "../src/turn/turn-write-guard.js";

function conversation() {
  let saved: WorkspaceTask = {
    id: "conversation",
    title: "Conversation",
    titleSource: "generated",
    updatedLabel: "Now",
    updatedAt: "2026-10-16T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
  };
  const ownership = new TurnOwnership();
  const host = {
    find: (id: string) => (id === saved.id ? saved : undefined),
    store: async (
      task: WorkspaceTask,
      options: { readonly commit: () => boolean },
    ) => {
      if (options.commit()) saved = task;
    },
  };
  const records = new TurnRecords(
    { host } as unknown as AgentLoopDependencies,
    turnWriteGuard(ownership),
  );
  /** Writes what the conversation says now, with a note of who wrote it. */
  const write = (note: string) =>
    records.replaceTask({ ...records.task("conversation"), title: note });
  /** Saves a conversation as the store does once a write commits. */
  const put = (task: WorkspaceTask) => {
    saved = task;
  };
  return { ownership, records, write, put, title: () => saved.title };
}

/** A promise and the function that settles it. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

describe("a write a turn makes", () => {
  it("lands while its turn holds the conversation", async () => {
    const { ownership, write, title } = conversation();
    const turn = ownership.start("conversation");

    await ownership.within(turn, () => write("by the turn"));

    expect(title()).toBe("by the turn");
  });

  it("stays out once its turn was stopped and the next turn has the conversation", async () => {
    const { ownership, write, title } = conversation();
    const stopped = ownership.start("conversation");
    const late = gate();
    const writing = ownership.within(stopped, async () => {
      await late.opened;
      await write("by the stopped turn");
    });

    ownership.cancel("conversation");
    const next = ownership.start("conversation");
    await ownership.within(next, () => write("by the next turn"));
    late.open();
    await writing;

    expect(title()).toBe("by the next turn");
  });

  it("stays out once its turn was stopped, with nothing else running", async () => {
    const { ownership, write, title } = conversation();
    const stopped = ownership.start("conversation");
    const late = gate();
    const writing = ownership.within(stopped, async () => {
      await late.opened;
      await write("by the stopped turn");
    });

    ownership.cancel("conversation");
    late.open();
    await writing;

    expect(title()).toBe("Conversation");
  });

  it("stays out when its turn is stopped while the write is being saved", async () => {
    const { ownership, records, put, title } = conversation();
    const turn = ownership.start("conversation");
    const saving = gate();
    // A save that is slow to finish: the stop arrives before it commits.
    const slow = new TurnRecords(
      {
        host: {
          find: () => records.task("conversation"),
          store: async (
            task: WorkspaceTask,
            options: { readonly commit: () => boolean },
          ) => {
            await saving.opened;
            if (options.commit()) put(task);
          },
        },
      } as unknown as AgentLoopDependencies,
      turnWriteGuard(ownership),
    );
    const writing = ownership.within(turn, () =>
      slow.replaceTask({
        ...records.task("conversation"),
        title: "by the turn",
      }),
    );

    ownership.cancel("conversation");
    saving.open();
    await writing;

    expect(title()).toBe("Conversation");
  });

  it.each([
    ["its own turn", false],
    ["a specialist, whose parent turn", true],
  ])(
    "from %s finishing on its own while the write is being saved still lands",
    async (_who, bySpecialist) => {
      const { ownership, records, title } = conversation();
      const turn = ownership.start("conversation");
      const author = bySpecialist
        ? ownership.start("conversation:specialist:one", "conversation")
        : turn;
      const saving = gate();
      const slow = new TurnRecords(
        {
          host: {
            find: () => records.task("conversation"),
            store: async (
              task: WorkspaceTask,
              options: { readonly commit: () => boolean },
            ) => {
              await saving.opened;
              if (options.commit()) await records.replaceTask(task);
            },
          },
        } as unknown as AgentLoopDependencies,
        turnWriteGuard(ownership),
      );
      const writing = ownership.within(author, () =>
        slow.replaceTask({
          ...records.task("conversation"),
          title: "while finishing",
        }),
      );

      ownership.finish("conversation", turn);
      saving.open();
      await writing;

      expect(title()).toBe("while finishing");
    },
  );

  it("made on no turn's behalf is made again when the stop, begun from the conversation as saved, lands over it", async () => {
    let saved: WorkspaceTask = {
      id: "conversation",
      title: "Conversation",
      titleSource: "generated",
      updatedLabel: "Now",
      updatedAt: "2026-10-16T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "working", steps: [] },
    };
    // Saves commit in the order they began, the first only once let go.
    const first = gate();
    let begun = 0;
    let previous: Promise<void> = Promise.resolve();
    const records = new TurnRecords(
      {
        host: {
          find: (id: string) => (id === saved.id ? saved : undefined),
          store: (
            task: WorkspaceTask,
            options: { readonly commit: () => boolean },
          ) => {
            const waitFor = begun++ === 0 ? first.opened : Promise.resolve();
            const committed = previous.then(async () => {
              await waitFor;
              if (options.commit()) saved = task;
            });
            previous = committed;
            return committed;
          },
        },
      } as unknown as AgentLoopDependencies,
      turnWriteGuard(new TurnOwnership()),
    );

    const ending = records.changeOutsideTurns("conversation", (task) =>
      task.title === "ended" ? undefined : { ...task, title: "ended" },
    );
    const stopping = records.interrupt("conversation");
    first.open();
    await Promise.all([ending, stopping]);

    expect(saved.title).toBe("ended");
    expect(saved.phase.kind).toBe("interrupted");
  });

  it("from a turn that finished on its own still lands while the next turn runs", async () => {
    // Work a turn left running in the background, such as naming an action,
    // is the finished turn's, and was not stopped.
    const { ownership, write, title } = conversation();
    const finished = ownership.start("conversation");
    const late = gate();
    const naming = ownership.within(finished, async () => {
      await late.opened;
      await write("named in the background");
    });

    ownership.finish("conversation", finished);
    ownership.start("conversation");
    late.open();
    await naming;

    expect(title()).toBe("named in the background");
  });

  it("from a specialist that outlived its turn lands while it runs", async () => {
    const { ownership, write, title } = conversation();
    const turn = ownership.start("conversation");
    const specialist = ownership.start(
      "conversation:specialist:one",
      "conversation",
    );
    ownership.finish("conversation", turn);

    await ownership.within(specialist, () => write("by the specialist"));

    expect(title()).toBe("by the specialist");
  });
});

describe("a write made on no turn's behalf", () => {
  it("lands after a stop, as the stop itself and a stopped specialist's end do", async () => {
    const { ownership, write, title } = conversation();
    const stopped = ownership.start("conversation");

    ownership.cancel("conversation");
    await ownership.within(stopped, () =>
      ownership.outside(() => write("the stop")),
    );

    expect(title()).toBe("the stop");
  });
});
