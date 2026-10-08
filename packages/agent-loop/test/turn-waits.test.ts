/**
 * Two children running at once can each need a person's approval at the same
 * moment. `task.phase` holds one prompt at a time, so a second request must
 * wait its turn rather than silently overwriting the first's visible prompt.
 */

import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type ToolCallInspection,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { TurnWaits } from "../src/turn/turn-waits.js";
import type { TurnRecords } from "../src/turn/turn-records.js";

function recordsStub(taskId: string): {
  readonly records: TurnRecords;
  readonly phases: string[];
} {
  let task: WorkspaceTask = {
    id: taskId,
    title: "Task",
    titleSource: "generated",
    updatedLabel: "Now",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "working", steps: [] },
  };
  const phases: string[] = [];
  const records = {
    task: () => task,
    visibleSteps: () => [],
    replaceTask: async (next: WorkspaceTask) => {
      task = next;
      if (next.phase.kind === "approval") phases.push(next.phase.prompt.target);
    },
  } as unknown as TurnRecords;
  return { records, phases };
}

const inspection: Extract<ToolCallInspection, { readonly ok: true }> = {
  ok: true,
  action: "Do it",
  target: "file.txt",
  command: "do_it()",
};

describe("TurnWaits prompt slot", () => {
  it("holds a second concurrent approval back until the first resolves", async () => {
    const { records, phases } = recordsStub("task-1");
    let approvalNumber = 0;
    const waits = new TurnWaits(
      { newApprovalId: () => `approval-${++approvalNumber}` } as never,
      { records },
    );
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const first = waits.waitForApproval(
      "task-1",
      { ...inspection, target: "first.txt" },
      { title: "Do it" },
      undefined,
      controllerA.signal,
    );
    // Give the first call's own `replaceTask` a turn to run before the second
    // is issued, so ordering below reflects the slot, not call order alone.
    await Promise.resolve();
    const second = waits.waitForApproval(
      "task-1",
      { ...inspection, target: "second.txt" },
      { title: "Do it" },
      undefined,
      controllerB.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(phases).toEqual(["first.txt"]);

    await waits.resolveApproval("task-1", "approval-1", "allow");
    expect(await first).toBe("allow");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(phases).toEqual(["first.txt", "second.txt"]);

    await waits.resolveApproval("task-1", "approval-2", "allow");
    expect(await second).toBe("allow");
  });
});
