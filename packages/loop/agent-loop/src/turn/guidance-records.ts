/**
 * What the person says while a turn works, as the conversation keeps it:
 * queued, delivered into the conversation once the model has it, or released
 * when the turn ends without it; and a specialist's hand-off, once delivered.
 */

import type { TaskGuidance } from "@zhiyin/contract";
import { settleGuidance } from "./turn-guidance.js";
import type { TaskStore } from "./task-store.js";
import { nextTimelineSequence } from "./timeline.js";

export class GuidanceRecords {
  readonly #store: TaskStore;

  constructor(store: TaskStore) {
    this.#store = store;
  }

  async queue(taskId: string, guidance: TaskGuidance): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      guidance: [...task.guidance, guidance],
    });
  }

  async deliver(taskId: string, guidanceId: string): Promise<void> {
    const task = this.#store.task(taskId);
    const guidance = task.guidance.find((item) => item.id === guidanceId);
    if (!guidance || guidance.status !== "pending") return;
    if (
      !task.modelHistory.some(
        (entry) => entry.kind === "notice" && entry.messageId === guidanceId,
      )
    )
      throw new Error("Guidance was not recorded in model history.");
    await this.#store.replaceTask({
      ...task,
      guidance: task.guidance.filter((item) => item.id !== guidanceId),
      messages: [
        ...task.messages,
        {
          id: guidance.id,
          role: "user",
          text: guidance.text,
          ...(guidance.attachments?.length
            ? { attachments: guidance.attachments }
            : {}),
          sequence: nextTimelineSequence(task),
        },
      ],
    });
  }

  async release(taskId: string, onlyId?: string): Promise<void> {
    const task = this.#store.task(taskId);
    const settled = settleGuidance(task, onlyId);
    if (settled !== task) await this.#store.replaceTask(settled);
  }

  async handoffDelivered(taskId: string, runId: string): Promise<void> {
    const task = this.#store.task(taskId);
    await this.#store.replaceTask({
      ...task,
      specialistRuns: task.specialistRuns.map((run) =>
        run.id === runId ? { ...run, handoffDelivered: true } : run,
      ),
    });
  }
}
