import { afterEach, describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type ActionApproval,
  type ActionDetail,
  type CommandFileChanges,
  type FileChange,
  type SpecialistRun,
  type TaskAction,
  type TaskPhase,
  type TaskPlanItem,
  type TurnRemedy,
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

const approvals: { readonly [By in ActionApproval["by"]]: ActionApproval } = {
  you: { by: "you", at },
  "conversation-permission": {
    by: "conversation-permission",
    at,
    permissionId: "permission-1",
    label: "Edit files in this folder",
  },
  "no-approval-needed": { by: "no-approval-needed", at },
  blocked: { by: "blocked", at, reason: "Outside the folder." },
};

const commandChanges: {
  readonly [Status in CommandFileChanges["status"]]: CommandFileChanges;
} = {
  checked: {
    status: "checked",
    files: [{ path: "out.txt", change: "created" }],
    more: 2,
    job: "job-1",
  },
  running: { status: "running", job: "job-1" },
  unchecked: { status: "unchecked", reason: "The folder was too large." },
};

const remedies: { readonly [Remedy in TurnRemedy]: true } = {
  tryAgain: true,
  continue: true,
  updateApiKey: true,
  openSettings: true,
  chooseModel: true,
  chooseLargerModel: true,
  addCredits: true,
  editMessage: true,
};

const recovery = {
  files: [
    { path: "notes.md", status: "protected" as const },
    { path: "big.bin", status: "unprotected" as const, reason: "Too large." },
  ],
};

const invocation = {
  name: "run_command",
  via: "a connector",
  arguments: [
    { name: "command", value: '"dir"', runs: true as const },
    { name: "size", value: "2000 × 2000 pixels", readable: true as const },
    { name: "text", value: '"ab…yz"', omitted: 40, described: "The text." },
  ],
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
  tools: ["read_file"],
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
  running: run("running", {
    specialist: { ...specialist, access: "change" },
  }),
  completed: run("completed", {
    finishedAt: at,
    handoff: {
      report: "Read.",
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
      reasonByModel: true,
      invocation,
      recovery,
      conversationRule: { label: "Edit files in this folder" },
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
  completed: {
    kind: "completed",
    outcome: { title: "Done", summary: "The plan is written." },
    backgroundSpecialistIds: ["run-running"],
  },
  failed: {
    kind: "failed",
    reason: "The model could not be reached.",
    remedies: Object.keys(remedies) as TurnRemedy[],
  },
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
    approval: Object.values(approvals)[index % 4]!,
    commandChanges: Object.values(commandChanges)[index % 3]!,
    recovery,
    invocation,
    readOnly: true,
    specialistRunId: "run-running",
  })),
  plan: Object.keys(planStatuses).map((status, index) => ({
    id: `plan-${index + 1}`,
    title: `Item ${index + 1}`,
    status: status as TaskPlanItem["status"],
  })),
  specialistRuns: Object.values(runs),
  artifacts: [
    {
      path: "brief.md",
      name: "brief.md",
      change: "created",
      bytes: 5,
      updatedAt: at,
      folder: "C:\\work\\launch",
    },
    {
      path: "notes.md",
      name: "notes.md",
      change: "updated",
      bytes: 7,
      updatedAt: at,
    },
  ],
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
  it.each<[string, object]>([
    ["turnStartedAt", { turnStartedAt: "nine o'clock" }],
    [
      "actions",
      { actions: [{ ...conversation.actions[0], status: "paused" }] },
    ],
    ["plan", { plan: [{ id: "plan-1", title: "Item", status: "late" }] }],
    ["phase", { phase: { kind: "resting" } }],
    ["artifacts", { artifacts: [{ ...conversation.artifacts[0], folder: 5 }] }],
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
    ...[
      { approval: { by: "nobody", at } },
      { recovery: { files: 5 } },
      { recovery: { files: [{ path: "a", status: "kept" }] } },
      { commandChanges: { status: "checked", files: 5 } },
      { commandChanges: { status: "whatever" } },
      { commandChanges: { ...commandChanges.checked, more: "lots" } },
      { readOnly: "yes" },
      { invocation: { name: "run", arguments: 5 } },
      { specialistRunId: 7 },
      { folder: 7 },
    ].map(
      (change) =>
        [
          "actions",
          { actions: [{ ...conversation.actions[0], ...change }] },
        ] as [string, object],
    ),
    ["phase", { phase: { kind: "failed", reason: "x", remedies: "tryAgain" } }],
    [
      "phase",
      {
        phase: {
          ...phases.approval,
          prompt: {
            ...(phases.approval as { prompt: object }).prompt,
            conversationRule: { label: 5 },
          },
        },
      },
    ],
    [
      "specialistRuns",
      {
        specialistRuns: [
          run("running", {
            specialist: { ...specialist, tools: [5] } as never,
          }),
        ],
      },
    ],
    [
      "specialistRuns",
      {
        specialistRuns: [run("running", { handoffDelivered: "yes" } as never)],
      },
    ],
    [
      "phase",
      { phase: { kind: "failed", reason: "x", remedies: ["format-disk"] } },
    ],
    [
      "phase",
      {
        phase: {
          ...phases.completed,
          backgroundSpecialistIds: [1],
        },
      },
    ],
    [
      "phase",
      {
        phase: {
          ...phases.approval,
          prompt: {
            ...(phases.approval as { prompt: object }).prompt,
            recovery: { files: 5 },
          },
        },
      },
    ],
    [
      "phase",
      {
        phase: {
          ...phases.approval,
          prompt: {
            ...(phases.approval as { prompt: object }).prompt,
            reasonByModel: "yes",
          },
        },
      },
    ],
    [
      "specialistRuns",
      {
        specialistRuns: [
          run("running", {
            specialist: { ...specialist, access: "write" } as never,
          }),
        ],
      },
    ],
  ])("says that its %s is the part at fault", async (part, damage) => {
    await expect(opened({ ...conversation, ...damage })).rejects.toMatchObject({
      code: "corrupted",
      message: `This conversation is damaged and cannot be opened safely: what it holds as “${part}” is not what Zhiyin saves there.`,
    });
  });
});
