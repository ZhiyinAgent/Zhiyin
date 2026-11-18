import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  FileSessions,
  SessionStoreError,
  type SavedWorkspace,
} from "../src/index.js";
import { plantHistory } from "./planted-history.js";

/**
 * A saved conversation has one shape: every list present, every entry placed
 * on the timeline, and nothing the app does not write. Anything else is
 * refused as damaged rather than read in part.
 */

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function temporaryRoot(): Promise<string> {
  return folders.make("zhiyin-saved-shape-");
}

const conversation: WorkspaceTask = {
  id: "task-1",
  title: "Plan the launch",
  titleSource: "generated",
  updatedAt: "2026-10-05T09:00:00.000Z",
  updatedLabel: "Now",
  messages: [
    {
      id: "message-1",
      role: "user",
      text: "Plan the launch",
      sequence: 0,
      attachments: [
        { kind: "pastedText", id: "paste-1", bytes: 1200, lines: 40 },
        {
          kind: "picture",
          id: "picture-1",
          name: "chart.png",
          mediaType: "image/png",
          bytes: 2048,
          source: "picture-1.png",
        },
      ],
    },
  ],
  ...emptyConversationLists,
  guidance: [{ id: "guidance-1", text: "Keep it short.", status: "pending" }],
  modelHistory: [
    { id: "entry-1", kind: "message", messageId: "message-1" },
    {
      id: "entry-2",
      kind: "calls",
      text: "",
      calls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
    },
    {
      id: "entry-3",
      kind: "result",
      callId: "call-1",
      name: "read_file",
      content: "notes",
    },
    { id: "entry-4", kind: "notice", content: "Today is Monday." },
    {
      id: "entry-5",
      kind: "pictures",
      text: "The picture you took.",
      pictures: [{ mediaType: "image/png", source: "picture-1.png" }],
    },
  ],
  conversationPermissions: [
    {
      id: "permission-1",
      label: "Change files in D:/notes",
      at: "2026-10-05T09:01:00.000Z",
      kind: "outside-folder",
      toolName: "write_file",
      folder: "D:/notes",
    },
  ],
  runningJobs: [{ id: "job-1", command: "npm test" }],
  activatedPlugins: ["software-engineering"],
  undos: [
    {
      id: "undo-1",
      messageId: "message-1",
      actionIds: [],
      at: "2026-10-05T09:02:00.000Z",
      files: [{ path: "notes/plan.md", status: "restored" }],
      told: true,
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

async function loads(task: unknown): Promise<SavedWorkspace | undefined> {
  const root = await temporaryRoot();
  await plantHistory(root, saved(task));
  return new FileSessions(root).loadWorkspace();
}

/**
 * Refused: the whole read fails, or the conversation is set aside without
 * being read. It is never loaded in part.
 */
async function refused(task: unknown): Promise<boolean> {
  try {
    const loaded = await loads(task);
    return !loaded?.tasks.some((item) => item.id === "task-1");
  } catch (error) {
    return error instanceof SessionStoreError;
  }
}

function without(key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...conversation };
  delete copy[key];
  return copy;
}

describe("a saved conversation's shape", () => {
  it("restores every list as it was saved", async () => {
    await expect(loads(conversation)).resolves.toMatchObject({
      tasks: [conversation],
    });
  });

  it("restores the reasoning and replay record kept with the model's turns", async () => {
    const replay = {
      provider: "deepseek",
      format: "chat-completions",
      data: { signature: "abc" },
    };
    const withReasoning = {
      ...conversation,
      modelHistory: [
        {
          id: "entry-1",
          kind: "message",
          messageId: "message-1",
          reasoning: "The person wants a short plan.",
          replay,
        },
        {
          id: "entry-2",
          kind: "calls",
          text: "",
          calls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
          reasoning: "Read the notes first.",
          replay,
        },
      ],
    };

    await expect(loads(withReasoning)).resolves.toMatchObject({
      tasks: [withReasoning],
    });
  });

  it("restores the round each request's record and the model's turns name", async () => {
    const withRounds = {
      ...conversation,
      modelHistory: [
        {
          id: "entry-1",
          kind: "calls",
          roundId: "round-1",
          text: "",
          calls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
        },
        {
          id: "entry-2",
          kind: "message",
          messageId: "message-1",
          roundId: "round-2",
        },
      ],
      modelResponses: [
        {
          roundId: "round-1",
          finishReason: "tool_calls",
          termination: "finishReason",
          complete: true,
        },
      ],
    };

    await expect(loads(withRounds)).resolves.toMatchObject({
      tasks: [withRounds],
    });
  });

  const specialistRun = {
    id: "run-1",
    specialist: {
      id: "engineering/reviewer",
      name: "Reviewer",
      description: "Reviews work.",
      instructions: "Review the evidence.",
      provenance: { source: "plugin", pluginId: "engineering" },
    },
    task: "Review the plan.",
    depth: 1,
    status: "completed",
    startedAt: "2026-10-05T09:00:00.000Z",
    finishedAt: "2026-10-05T09:01:00.000Z",
    sequence: 2,
    actionIds: [],
    handoff: { report: "The plan holds." },
  };

  it("restores what a specialist said and was answered, and its requests' records", async () => {
    const withRun = {
      ...conversation,
      specialistRuns: [
        {
          ...specialistRun,
          transcript: [
            {
              id: "e1",
              kind: "calls",
              roundId: "round-1",
              text: "Reading the plan.",
              calls: [{ id: "call-1", name: "read_file", arguments: "{}" }],
            },
            {
              id: "e2",
              kind: "result",
              callId: "call-1",
              name: "read_file",
              content: "plan",
            },
            { id: "e3", kind: "notice", content: "Report now." },
            {
              id: "e4",
              kind: "pictures",
              text: "look made 1 picture",
              pictures: [{ mediaType: "image/png", source: "picture-1" }],
            },
          ],
          modelResponses: [
            {
              roundId: "round-1",
              finishReason: "tool_calls",
              termination: "finishReason",
              complete: true,
            },
          ],
        },
      ],
    };

    await expect(loads(withRun)).resolves.toMatchObject({ tasks: [withRun] });
  });

  it.each([
    ["transcript", [{ id: "e1", kind: "message", messageId: "message-1" }]],
    ["transcript", [{ id: "e1", kind: "pictures", text: "" }]],
    ["transcript", [{ id: "e1", kind: "notice" }]],
    ["modelResponses", [{ finishReason: "stop" }]],
  ])(
    "refuses a specialist's %s it could not have written",
    async (field, value) => {
      expect(
        await refused({
          ...conversation,
          specialistRuns: [{ ...specialistRun, [field]: value }],
        }),
      ).toBe(true);
    },
  );

  it.each(Object.keys(emptyConversationLists))(
    "refuses a conversation saved without its %s list",
    async (list) => {
      await expect(loads(without(list))).rejects.toBeInstanceOf(
        SessionStoreError,
      );
    },
  );

  it.each(["titleSource", "updatedAt", "updatedLabel"])(
    "refuses a conversation saved without its %s",
    async (field) => {
      expect(await refused(without(field))).toBe(true);
    },
  );

  it("refuses a message with no place on the timeline", async () => {
    await expect(
      loads({
        ...conversation,
        messages: [{ id: "message-1", role: "user", text: "Plan the launch" }],
      }),
    ).rejects.toBeInstanceOf(SessionStoreError);
  });

  it.each([
    ["modelHistory", { id: "entry-1", kind: "summary", content: "?" }],
    ["modelHistory", { id: "entry-1", kind: "message" }],
    [
      "modelHistory",
      {
        id: "entry-1",
        kind: "calls",
        text: "",
        calls: [],
        replay: "not a record",
      },
    ],
    [
      "modelHistory",
      {
        id: "entry-1",
        kind: "calls",
        text: "",
        calls: [],
        reasoning: 7,
      },
    ],
    [
      "modelHistory",
      { id: "entry-1", kind: "calls", text: "", calls: [], roundId: 7 },
    ],
    [
      "modelHistory",
      { id: "entry-1", kind: "message", messageId: "message-1", roundId: 7 },
    ],
    [
      "modelResponses",
      {
        roundId: 7,
        finishReason: null,
        termination: "usage",
        complete: true,
      },
    ],
    ["guidance", { id: "guidance-1", text: "Keep it short.", status: "sent" }],
    [
      "conversationPermissions",
      {
        id: "permission-1",
        label: "Everything",
        at: "2026-10-05T09:01:00.000Z",
        kind: "anything",
        toolName: "write_file",
      },
    ],
    ["runningJobs", { id: "job-1" }],
    ["activatedPlugins", 7],
    [
      "undos",
      {
        id: "undo-1",
        messageId: "message-1",
        actionIds: [],
        at: "2026-10-05T09:02:00.000Z",
        files: [{ path: "notes/plan.md", status: "deleted" }],
      },
    ],
  ])("refuses a %s entry it could not have written", async (list, entry) => {
    await expect(
      loads({ ...conversation, [list]: [entry] }),
    ).rejects.toBeInstanceOf(SessionStoreError);
  });

  it("refuses a message attachment it could not have written", async () => {
    await expect(
      loads({
        ...conversation,
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "Plan the launch",
            sequence: 0,
            attachments: [{ kind: "file", id: "file-1" }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(SessionStoreError);
  });
});
