/**
 * What a turn leaves behind when it does not finish, and how it is settled.
 *
 * A turn cannot outlive the process running it, and reasoning cannot still be
 * arriving once a turn has ended. Both rules belong to the turn, so they are
 * written here rather than wherever a conversation happens to be read or saved.
 */

import { randomUUID } from "node:crypto";
import type { TaskAction, WorkspaceTask } from "@zhiyin/contract";
import { harnessNotice } from "./notices.js";
import { settleGuidance } from "./turn-guidance.js";

/** The phases a turn passes through while it is still going. */
const unfinished = ["loading", "working", "approval", "input", "browser"];

const stoppedReasoning = (
  task: WorkspaceTask,
  status: "interrupted" | "complete",
): WorkspaceTask["messages"] =>
  task.messages.map((message) =>
    message.reasoning?.status === "streaming"
      ? { ...message, reasoning: { ...message.reasoning, status } }
      : message,
  );

/**
 * Commands that were running as jobs when the app closed, told to the model
 * as Zhiyin. The notices join what the model was sent, so its next request
 * carries them, before whatever the person says next. The job's name is left
 * out: names start again after a restart, and the next job may take it.
 */
function stoppedJobs(task: WorkspaceTask): WorkspaceTask {
  if (!task.runningJobs.length) return task;
  return {
    ...task,
    runningJobs: [],
    modelHistory: [
      ...task.modelHistory,
      ...task.runningJobs.map((job) => ({
        id: randomUUID(),
        kind: "notice" as const,
        content: harnessNotice(
          "job",
          `The command ${job.command}, running as a job, was stopped when Zhiyin closed. What it printed is no longer available, and what it had already done stays done.`,
        ),
      })),
    ],
  };
}

/**
 * An action whose job was still running when the app closed. The job stopped
 * with the app, and nothing listed its folder after, so what it changed is
 * not known.
 */
function uncheckedJob(action: TaskAction): TaskAction {
  return action.commandChanges?.status === "running"
    ? {
        ...action,
        commandChanges: {
          status: "unchecked",
          reason:
            "Zhiyin closed before this command finished, so what it changed was not checked.",
        },
      }
    : action;
}

/**
 * A conversation as it is found after a restart. An action that was running
 * stopped when the app closed, a turn still under way is interrupted, and the
 * model is told of the commands that stopped with the app.
 *
 * A conversation with nothing to settle comes back as the same object, so the
 * caller can tell whether anything needed settling without comparing fields.
 */
export function settledAfterRestart(task: WorkspaceTask): WorkspaceTask {
  task = stoppedJobs(settleGuidance(task));
  const actions = task.actions.map((action) =>
    uncheckedJob(
      action.status === "running"
        ? {
            ...action,
            status: "cancelled" as const,
            reason: "The app closed before this action completed.",
          }
        : action,
    ),
  );
  const stoppedAction = actions.some(
    (action, index) => action !== task.actions[index],
  );
  const specialistRuns = task.specialistRuns.map((run) =>
    run.status === "running"
      ? {
          ...run,
          status: "interrupted" as const,
          finishedAt: new Date().toISOString(),
          reason: "The app closed before this specialist completed.",
          handoffDelivered: false,
        }
      : run,
  );
  const stoppedSpecialist = specialistRuns.some(
    (run, index) => run !== task.specialistRuns[index],
  );
  const interrupted = unfinished.includes(task.phase.kind);
  if (!interrupted && !stoppedAction && !stoppedSpecialist) return task;
  return interrupted
    ? {
        ...task,
        actions,
        specialistRuns,
        messages: stoppedReasoning(task, "interrupted"),
        // A stop with no reason is one the person asked for; this one is not.
        phase: {
          kind: "interrupted" as const,
          reason: "Zhiyin closed before this was finished.",
        },
      }
    : { ...task, actions, specialistRuns };
}

/**
 * A conversation whose turn has ended. Reasoning still marked as arriving is
 * settled with the turn: finished when the turn completed, interrupted when it
 * did not. A turn still running is left alone.
 */
export function settledWhenTurnEnded(task: WorkspaceTask): WorkspaceTask {
  if (!["failed", "interrupted", "completed"].includes(task.phase.kind))
    return task;
  return {
    ...task,
    messages: stoppedReasoning(
      task,
      task.phase.kind === "completed" ? "complete" : "interrupted",
    ),
  };
}
