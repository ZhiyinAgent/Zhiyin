/** A save that fails for one conversation leaves no other half-saved. */

import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions, historyFiles } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function conversation(id: string, said: readonly string[]): WorkspaceTask {
  return {
    id,
    title: id,
    titleSource: "generated",
    updatedAt: "2026-09-10T12:00:00.000Z",
    updatedLabel: "Now",
    messages: said.map((text, sequence) => ({
      id: `${id}-${sequence}`,
      role: "user" as const,
      text,
      sequence,
    })),
    ...emptyConversationLists,
    phase: { kind: "draft" },
  };
}

function workspace(...tasks: WorkspaceTask[]): WorkspaceSnapshot {
  return {
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: tasks[0]?.id ?? null,
    recentWorkspaces: [],
    plugins: [],
    tasks,
    mcpServers: [],
    usage: { status: "unavailable", reason: "No usage." },
  };
}

describe("a save one conversation's write fails in", () => {
  it("finishes the others before it fails, so the next save writes each edit once", async () => {
    const root = await folders.make("zhiyin-save-after-failure-");
    await new FileSessions(root).saveWorkspace(
      workspace(
        conversation("first", ["An answer"]),
        conversation("second", ["An answer"]),
      ),
    );

    // The first conversation's write fails at once; the second's is still on
    // its way to the disk when it does.
    let failFirst = true;
    let letSecondFinish = () => {};
    const secondHeld = new Promise<void>((resolve) => {
      letSecondFinish = resolve;
    });
    let holdSecond = true;
    let secondLanded = () => {};
    const landed = new Promise<void>((resolve) => {
      secondLanded = resolve;
    });
    const sessions = new FileSessions(root, {
      historyFiles: {
        ...historyFiles,
        append: async (path, text) => {
          if (path.includes("c-first") && failFirst) {
            failFirst = false;
            throw new Error("Disk busy");
          }
          if (path.includes("c-second") && holdSecond) {
            holdSecond = false;
            await secondHeld;
            await historyFiles.append(path, text);
            secondLanded();
            return;
          }
          await historyFiles.append(path, text);
        },
      },
    });
    await sessions.loadWorkspace();
    // Each answer grew, as a streamed one does: saved as what was added.
    const edited = workspace(
      conversation("first", ["An answer that grew"]),
      conversation("second", ["An answer that grew"]),
    );

    const failed = sessions.saveWorkspace(edited);
    const retried = sessions.saveWorkspace(edited);
    setTimeout(letSecondFinish, 50);
    await expect(failed).rejects.toThrow("Task history could not be saved.");
    await retried;
    await landed;

    const reopened = (await new FileSessions(root).loadWorkspace())!;
    expect(
      reopened.tasks.map((task) => [
        task.id,
        task.messages.map((message) => message.text),
      ]),
    ).toEqual([
      ["first", ["An answer that grew"]],
      ["second", ["An answer that grew"]],
    ]);
  });
});

describe("two saves asked for together", () => {
  it("write one after the other: none of the second's writes starts before the first's have ended", async () => {
    const root = await folders.make("zhiyin-saves-in-turn-");
    await new FileSessions(root).saveWorkspace(
      workspace(
        conversation("first", ["One"]),
        conversation("second", ["One"]),
      ),
    );
    const seen: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = true;
    const sessions = new FileSessions(root, {
      historyFiles: {
        ...historyFiles,
        append: async (path, text) => {
          const which = `${path.includes("c-first") ? "first" : "second"} ${
            text.includes("Three") ? "save 2" : "save 1"
          }`;
          seen.push(`${which} starts`);
          // The first save's write to the first conversation is slow.
          if (holding && which === "first save 1") {
            holding = false;
            await held;
          }
          await historyFiles.append(path, text);
          seen.push(`${which} ends`);
        },
      },
    });
    await sessions.loadWorkspace();

    const first = sessions.saveWorkspace(
      workspace(
        conversation("first", ["Two"]),
        conversation("second", ["Two"]),
      ),
    );
    const second = sessions.saveWorkspace(
      workspace(
        conversation("first", ["Three"]),
        conversation("second", ["Three"]),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.filter((event) => event.includes("save 2"))).toEqual([]);
    release();
    await Promise.all([first, second]);

    const lastOfFirst = Math.max(
      ...seen.flatMap((event, at) => (event.includes("save 1") ? [at] : [])),
    );
    const firstOfSecond = seen.findIndex((event) => event.includes("save 2"));
    expect(firstOfSecond).toBeGreaterThan(lastOfFirst);
    expect(
      (await new FileSessions(root).loadWorkspace())!.tasks.map(
        (task) => task.messages[0]?.text,
      ),
    ).toEqual(["Three", "Three"]);
  });
});
