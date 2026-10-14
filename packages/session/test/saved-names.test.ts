import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type ActionDetail,
  type FileChange,
  type SpecialistRun,
  type TaskAction,
  type TaskPhase,
  type TaskPlanItem,
  type WorkspaceTask,
  type WorkStep,
} from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { FileSessions, type SavedWorkspace } from "../src/index.js";
import { plantHistory } from "./planted-history.js";

/**
 * A conversation opens again whatever status or kind its entries have, and one
 * that does not read says which part of it is at fault.
 *
 * Each list below is written as an object keyed by the type's own names, so a
 * status or kind the type gains has no entry here until one is written, and
 * this file stops compiling until it is.
 */

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-saved-names-");
}

const at = "2026-10-05T09:00:00.000Z";

const details: { readonly [Kind in ActionDetail["kind"]]: ActionDetail } = {
  text: { kind: "text", label: "Output", text: "Done." },
  facts: { kind: "facts", items: [{ label: "Exit code", value: "0" }] },
  matches: {
    kind: "matches",
    items: [{ path: "notes.md", line: 3, text: "launch" }],
  },
  list: { kind: "list", label: "Entries", items: ["notes.md"] },
  image: {
    kind: "image",
    label: "Chart",
    mediaType: "image/png",
    source: "picture-1.png",
    alt: "A chart of sales by month.",
  },
};

const changes: { readonly [Kind in FileChange["change"]]: FileChange } = {
  created: { path: "new.md", change: "created" },
  updated: { path: "notes.md", change: "updated" },
  recycled: { path: "old.md", change: "recycled" },
  deleted: { path: "gone.md", change: "deleted" },
};

const actionStatuses: { readonly [Status in TaskAction["status"]]: true } = {
  running: true,
  completed: true,
  reported: true,
  failed: true,
  denied: true,
  blocked: true,
  cancelled: true,
};

const planStatuses: { readonly [Status in TaskPlanItem["status"]]: true } = {
  pending: true,
  in_progress: true,
  done: true,
  skipped: true,
};

const stepStatuses: { readonly [Status in WorkStep["status"]]: true } = {
  complete: true,
  active: true,
  queued: true,
  failed: true,
};

const specialist: SpecialistRun["specialist"] = {
  id: "research/reader",
  name: "Reader",
  description: "Reads what it is given.",
  instructions: "Read it.",
  provenance: { source: "plugin", pluginId: "research" },
};

function run(
  status: SpecialistRun["status"],
  rest: Partial<SpecialistRun>,
): SpecialistRun {
  return {
    id: `run-${status}`,
    specialist,
    task: "Read the notes.",
    depth: 1,
    status,
    startedAt: at,
    sequence: 20,
    actionIds: [],
    ...rest,
  };
}

const runs: { readonly [Status in SpecialistRun["status"]]: SpecialistRun } = {
  running: run("running", {}),
  completed: run("completed", {
    finishedAt: at,
    handoff: {
      summary: "Read.",
      findings: [],
      recommendations: [],
      limitations: [],
    },
  }),
  failed: run("failed", { finishedAt: at, reason: "The model stopped." }),
  interrupted: run("interrupted", { finishedAt: at, reason: "Stopped." }),
};

const steps: readonly WorkStep[] = Object.keys(stepStatuses).map(
  (status, index) => ({
    id: `step-${index}`,
    label: `Step ${index}`,
    status: status as WorkStep["status"],
  }),
);

const phases: { readonly [Kind in TaskPhase["kind"]]: TaskPhase } = {
  draft: { kind: "draft" },
  loading: { kind: "loading" },
  working: { kind: "working", steps },
  approval: {
    kind: "approval",
    steps,
    prompt: {
      id: "approval-1",
      action: "Write",
      target: "notes.md",
      reason: "The file is outside what was allowed.",
      command: "write_file notes.md",
      changes: Object.values(changes),
    },
  },
  input: {
    kind: "input",
    steps,
    prompt: {
      id: "input-1",
      kind: "workBudget",
      title: "Carry on?",
      completedRounds: 40,
      reached: ["toolRounds", "elapsed", "providerCost"],
      elapsedMs: 60_000,
      allowance: { toolRounds: 40, elapsedMs: 60_000, providerCostUsd: 1 },
    },
  },
  browser: { kind: "browser", steps },
  completed: {
    kind: "completed",
    outcome: { title: "Done", summary: "The plan is written." },
  },
  failed: { kind: "failed", reason: "The model could not be reached." },
  interrupted: { kind: "interrupted" },
};

const conversation: WorkspaceTask = {
  id: "task-1",
  title: "Plan the launch",
  titleSource: "generated",
  updatedAt: at,
  updatedLabel: "Now",
  messages: [{ id: "message-1", role: "user", text: "Plan it.", sequence: 0 }],
  ...emptyConversationLists,
  actions: Object.keys(actionStatuses).map((status, index) => ({
    id: `action-${index}`,
    action: "Read",
    target: "notes.md",
    sequence: index + 1,
    status: status as TaskAction["status"],
    details: Object.values(details),
    changes: Object.values(changes),
  })),
  plan: Object.keys(planStatuses).map((status, index) => ({
    id: `plan-${index + 1}`,
    title: `Item ${index + 1}`,
    status: status as TaskPlanItem["status"],
  })),
  specialistRuns: Object.values(runs),
  phase: { kind: "draft" },
};

function saved(task: unknown): SavedWorkspace {
  return {
    recentWorkspaces: [],
    selectedTaskId: "task-1",
    tasks: [task as WorkspaceTask],
  };
}

async function opened(task: unknown) {
  const root = await temporaryRoot();
  await plantHistory(root, saved(task));
  const sessions = new FileSessions(root);
  await sessions.loadIndex();
  return sessions.openConversation("task-1");
}

describe("the statuses and kinds a saved conversation holds", () => {
  it("opens with an action in every status, each detail and file change of every kind, a plan item and a specialist run in every status", async () => {
    await expect(opened(conversation)).resolves.toMatchObject({
      task: conversation,
    });
  });

  it.each(Object.entries(phases))(
    "opens as it was left while %s",
    async (_kind, phase) => {
      const left = { ...conversation, phase };

      await expect(opened(left)).resolves.toMatchObject({ task: left });
    },
  );
});

describe("a saved conversation that does not read", () => {
  it.each([
    [
      "actions",
      { actions: [{ ...conversation.actions[0], status: "paused" }] },
    ],
    ["plan", { plan: [{ id: "plan-1", title: "Item", status: "late" }] }],
    ["phase", { phase: { kind: "resting" } }],
    [
      "views",
      {
        views: [
          {
            id: "view-1",
            callId: "call-1",
            title: "Sales",
            kind: "hologram",
            source: "{}",
            sequence: 30,
          },
        ],
      },
    ],
    ["messages", { messages: [{ id: "message-1", role: "user", text: "Hi" }] }],
  ])("says that its %s is the part at fault", async (part, damage) => {
    await expect(opened({ ...conversation, ...damage })).rejects.toMatchObject({
      code: "corrupted",
      message: `This conversation is damaged and cannot be opened safely: what it holds as “${part}” is not what Zhiyin saves there.`,
    });
  });
});
