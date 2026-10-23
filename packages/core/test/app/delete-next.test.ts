/** Which conversation opens after the one on screen is deleted. */

import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists } from "@zhiyin/contract";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { loopFrom, stubDependencies, until } from "./support.js";

const made = new TemporaryFolders();
afterEach(() => made.removeAll());

function conversation(index: number) {
  return {
    id: `task-${index}`,
    title: `Conversation ${index}`,
    titleSource: "manual" as const,
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedLabel: "Earlier",
    ...emptyConversationLists,
    messages: [],
    actions: [],
    phase: {
      kind: "completed" as const,
      outcome: { title: "Done", summary: "Done." },
    },
    workspace: { path: `C:/work/f${index}`, name: `f${index}` },
  };
}

async function readingHeld() {
  const root = await made.make("zr11-");
  await new FileSessions(root).saveWorkspace({
    tasks: [0, 1, 2].map(conversation),
    selectedTaskId: "task-1",
    recentWorkspaces: [],
  });
  const sessions = new FileSessions(root);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const reading: string[] = [];
  const slow = new Proxy(sessions, {
    get(target, key) {
      if (key === "openConversation")
        return async (id: string) => {
          reading.push(id);
          if (id === "task-2") await held;
          return target.openConversation(id);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const loop = loopFrom({
    ...stubDependencies(() => {}),
    sessions: slow,
    revealDelayMs: 0,
    newTaskId: () => "fresh-task",
    workspace: {
      workspaceRoot: () => undefined,
      describeWorkspace: async () => ({
        rootName: "folder",
        entries: [],
        truncated: false,
      }),
      enterFolder: async (_id: string, path: string) =>
        path.split("/").pop() ?? path,
      checkFolder: async (path: string) => path.split("/").pop() ?? path,
      leaveFolder: () => {},
    },
  });
  await loop.initialize();
  return { loop, release, reading };
}

describe("AgentLoop deleting the conversation on screen, then the one that would open next while it is read", () => {
  it("opens the conversation next in order after both", async () => {
    const { loop, release, reading } = await readingHeld();
    expect(loop.snapshot().selectedTaskId).toBe("task-1");

    const first = loop.deleteTask("task-1");
    await until(() => reading.includes("task-2"));
    const second = loop.deleteTask("task-2");
    release();
    await first;
    await second;

    expect(
      (loop.snapshot().conversations ?? []).map((item) => item.id),
    ).toEqual(["task-0"]);
    // README: deleting the open conversation opens the next in that order.
    expect(loop.snapshot().selectedTaskId).toBe("task-0");
  });
});
