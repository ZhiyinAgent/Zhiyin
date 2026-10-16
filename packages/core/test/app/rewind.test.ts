import { afterEach, describe, expect, it } from "vitest";
import { documentsConnection } from "@zhiyin/capabilities";
import { ConversationRewind } from "@zhiyin/conversation-rewind";
import { documentCompiler } from "@zhiyin/document-compiler";
import { ModelClientError } from "@zhiyin/model-client";
import { InMemoryMcpCredentials, ManagedMcpServers } from "@zhiyin/mcp";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { FileRecovery } from "@zhiyin/recovery";
import { FileRewindJournal } from "@zhiyin/rewind";
import { FileSessions } from "@zhiyin/session";
import { WorkspaceTools } from "@zhiyin/tools";
import { open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  calls,
  currentApprovalId,
  documentViewerStub,
  pluginStore,
  pluginView,
  stubDependencies,
  loopFrom,
  until,
  type LoopTestDependencies,
  type TestApp,
} from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** The shipped plugin that offers the document compiler, switched on. */
const publishing = {
  ...pluginView({ name: "publishing" }),
  appConnectors: [
    {
      id: "publishing/documents",
      connector: "documents",
      name: "Document compiler",
      description: "Compiles documents to PDF.",
      access: "Writes PDFs in the workspace folder.",
      dataDestination: "Stays on this computer.",
      enabled: true,
    },
  ],
};

/**
 * Runs one request whose call that changes a file a person approves, then
 * rewinds to that request and restores files.
 */
async function approveThenRestore(agent: TestApp, root: string) {
  await agent.selectWorkspace(root);
  const taskId = await agent.createTask();
  const running = agent.start(taskId, "Make the document");
  await until(() => agent.snapshot().tasks[0]?.phase.kind === "approval");
  await agent.resolveApproval(
    taskId,
    currentApprovalId(agent, taskId),
    "allow",
  );
  await running;
  const request = agent.snapshot().tasks[0]!.messages[0]!;
  const preview = await agent.previewRewind(taskId, request.id);
  return agent.commitRewind(taskId, preview.id, "restore");
}

/** A PDF's bytes, not text: a copy that went through a text encoding fails. */
const earlierPdf = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "latin1"),
  Buffer.from([0x00, 0xe2, 0xe3, 0xcf, 0xd3, 0xff, 0x0a]),
]);

function loop() {
  let id = 0;
  return loopFrom({
    ...stubDependencies(() => {}, [
      { kind: "textDelta", text: "Answer" },
      { kind: "done" },
    ]),
    rewind: new ConversationRewind(() => `rewind-${++id}`),
  });
}

describe("conversation rewind composition", () => {
  it("reviews and rewinds the same conversation without starting a model turn", async () => {
    const agent = loop();
    const taskId = await agent.createTask();
    await agent.start(taskId, "First");
    await agent.start(taskId, "Second");
    const messageId = agent
      .snapshot()
      .tasks[0]?.messages.find((message) => message.text === "Second")?.id;
    if (!messageId) throw new Error("Second message missing");
    const discardedIds = agent
      .snapshot()
      .tasks[0]!.messages.filter((message) => message.sequence! >= 2)
      .map((message) => message.id);

    const preview = await agent.previewRewind(taskId, messageId);
    expect(preview.draft).toBe("Second");
    await agent.commitRewind(taskId, preview.id, "keep");

    expect(agent.snapshot().tasks[0]).toMatchObject({
      id: taskId,
      messages: [
        { role: "user", text: "First" },
        { role: "assistant", text: "Answer" },
      ],
      phase: { kind: "draft" },
    });
    expect(agent.snapshot().tasks).toHaveLength(1);

    await agent.start(taskId, "Edited second");
    const replacementIds = agent
      .snapshot()
      .tasks[0]!.messages.filter((message) => message.sequence! >= 2)
      .map((message) => message.id);
    expect(replacementIds.every((id) => !discardedIds.includes(id))).toBe(true);
  });

  it("leaves no compact notice behind when the message before it is rewound and sent again", async () => {
    const agent = loop();
    const taskId = await agent.createTask();
    await agent.start(taskId, "Hello, who are you?");
    await agent.turns.condenseNow(taskId);
    expect(agent.snapshot().tasks[0]?.condensings).toHaveLength(1);
    const messageId = agent.snapshot().tasks[0]?.messages[0]?.id;
    if (!messageId) throw new Error("Message missing");

    const preview = await agent.previewRewind(taskId, messageId);
    await agent.commitRewind(taskId, preview.id, "keep");
    expect(agent.snapshot().tasks[0]?.condensings ?? []).toEqual([]);
    await agent.start(taskId, "Hello, who are you?");

    expect(agent.snapshot().tasks[0]?.condensings ?? []).toEqual([]);
  });

  it("tries a turn that lost its connection again: one copy of the message, and an answer", async () => {
    const base = stubDependencies(() => {});
    let requests = 0;
    let id = 0;
    const agent = loopFrom({
      ...base,
      rewind: new ConversationRewind(() => `rewind-${++id}`),
      model: {
        ...base.model,
        send: async function* () {
          requests += 1;
          if (requests === 1)
            throw new ModelClientError("networkFailure", "Connection reset");
          yield { kind: "textDelta" as const, text: "The summary." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await agent.createTask();
    await agent.start(taskId, "Summarise the notes");
    const failed = agent.snapshot().tasks[0]!;
    expect(failed.phase).toMatchObject({
      kind: "failed",
      remedies: ["tryAgain"],
    });

    // What "Try again" does: go back to the message, then send it again.
    const preview = await agent.previewRewind(taskId, failed.messages[0]!.id);
    expect(preview).toMatchObject({
      discardedActions: [],
      files: [],
      laterUserMessages: 0,
    });
    await agent.commitRewind(taskId, preview.id, "keep");
    await agent.start(taskId, "Summarise the notes");

    expect(agent.snapshot().tasks[0]).toMatchObject({
      phase: { kind: "completed" },
      messages: [
        { role: "user", text: "Summarise the notes" },
        { role: "assistant", text: "The summary." },
      ],
    });
  });

  it("rejects a reviewed rewind after the conversation changes", async () => {
    const agent = loop();
    const taskId = await agent.createTask();
    await agent.start(taskId, "First");
    const messageId = agent.snapshot().tasks[0]?.messages[0]?.id;
    if (!messageId) throw new Error("Message missing");
    const preview = await agent.previewRewind(taskId, messageId);
    await agent.renameTask(taskId, "Changed while reviewing");

    await expect(
      agent.commitRewind(taskId, preview.id, "keep"),
    ).rejects.toThrow(
      "The conversation changed while the rewind was being reviewed. Review it again.",
    );
  });

  it("restores only recorded workspace file effects while rewinding the conversation", async () => {
    const root = await folders.make("zhiyin-loop-rewind-");
    const storage = await folders.make("zhiyin-loop-recovery-");
    await writeFile(join(root, "note.txt"), "before", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let request = 0;
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: workspace,
      workspace,
      recovery: new FileRecovery(storage),
      rewind: new ConversationRewind(() => "rewind-files"),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request === 2) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "write-1",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "note.txt",
                content: "agent result",
              }),
            };
          } else {
            yield { kind: "textDelta", text: "Answer" };
          }
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "First");
    await agent.start(taskId, "Change the note");
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("agent result");

    const selected = agent
      .snapshot()
      .tasks[0]!.messages.find(
        (message) => message.text === "Change the note",
      )!;
    const preview = await agent.previewRewind(taskId, selected.id);
    expect(preview.files).toEqual([
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    const result = await agent.commitRewind(taskId, preview.id, "restore");

    expect(result.files).toEqual([{ path: "note.txt", status: "restored" }]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("before");
    expect(agent.snapshot().tasks[0]!.phase).toEqual({ kind: "draft" });
  });

  it("deletes the copies kept for a conversation's changes with the conversation", async () => {
    const root = await folders.make("zhiyin-delete-");
    const storage = await folders.make("zhiyin-delete-recovery-");
    await writeFile(join(root, "note.txt"), "before", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let request = 0;
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: workspace,
      workspace,
      recovery: new FileRecovery(storage),
      rewind: new ConversationRewind(() => "rewind-files"),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "write-1",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "note.txt",
                content: "agent result",
              }),
            };
          } else {
            yield { kind: "textDelta", text: "Done" };
          }
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "Change the note");
    expect(await readdir(join(storage, "recovery"))).toHaveLength(1);

    await agent.deleteTask(taskId);

    expect(await readdir(join(storage, "recovery"))).toEqual([]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("agent result");
  });

  it("undoes one turn's files and keeps the conversation, leaving a file changed since as it is", async () => {
    const root = await folders.make("zhiyin-undo-");
    const storage = await folders.make("zhiyin-undo-recovery-");
    await writeFile(join(root, "note.txt"), "my note", "utf8");
    await writeFile(join(root, "draft.txt"), "my draft", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let request = 0;
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: workspace,
      workspace,
      recovery: new FileRecovery(storage),
      rewind: new ConversationRewind(() => "undo-files"),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "write-note",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "note.txt",
                content: "agent note",
              }),
            };
            yield {
              kind: "toolCallDelta",
              index: 1,
              callId: "write-draft",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "draft.txt",
                content: "agent draft",
              }),
            };
          } else {
            yield { kind: "textDelta", text: "Both rewritten." };
          }
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "Rewrite the note and the draft");
    await writeFile(join(root, "draft.txt"), "edited by hand", "utf8");
    const before = agent.snapshot().tasks[0]!;

    const preview = await agent.previewUndo(taskId, before.messages[0]!.id);
    expect(byPath(preview.files)).toMatchObject([
      { path: "draft.txt", action: "restore", status: "conflict" },
      { path: "note.txt", action: "restore", status: "recoverable" },
    ]);
    const result = await agent.commitUndo(taskId, preview.id);

    expect(byPath(result.files)).toMatchObject([
      { path: "draft.txt", status: "conflict" },
      { path: "note.txt", status: "restored" },
    ]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("my note");
    expect(await readFile(join(root, "draft.txt"), "utf8")).toBe(
      "edited by hand",
    );
    const after = agent.snapshot().tasks[0]!;
    expect(after.messages).toEqual(before.messages);
    expect(after.actions).toEqual(before.actions);
    expect(after.undos).toEqual([
      expect.objectContaining({
        messageId: before.messages[0]!.id,
        files: result.files,
      }),
    ]);
  });

  it("refuses to review or undo a turn's files while the conversation is working", async () => {
    const root = await folders.make("zhiyin-undo-busy-");
    const storage = await folders.make("zhiyin-undo-busy-recovery-");
    await writeFile(join(root, "note.txt"), "my note", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let request = 0;
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: workspace,
      workspace,
      recovery: new FileRecovery(storage),
      rewind: new ConversationRewind(() => "undo-busy"),
      model: {
        ...deps.model,
        send: async function* () {
          request += 1;
          if (request === 1)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "write-note",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "note.txt",
                content: "agent note",
              }),
            };
          else if (request === 3) await held;
          yield { kind: "textDelta", text: "Done." };
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    await agent.start(taskId, "Rewrite the note");
    const opening = agent.snapshot().tasks[0]!.messages[0]!.id;
    const preview = await agent.previewUndo(taskId, opening);

    const working = agent.start(taskId, "Now something else");
    await until(() => request === 3);
    await expect(agent.previewUndo(taskId, opening)).rejects.toThrow(
      "Stop this task before undoing its changes.",
    );
    await expect(agent.commitUndo(taskId, preview.id)).rejects.toThrow(
      "Stop this task before undoing its changes.",
    );
    release();
    await working;

    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("agent note");
    expect(agent.snapshot().tasks[0]!.undos).toEqual([]);
  });

  it("does not start new model work while a restore is still running", async () => {
    let finishRestore!: () => void;
    const restoring = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    const deps = stubDependencies(() => {}, [
      { kind: "textDelta", text: "Answer" },
      { kind: "done" },
    ]);
    const agent = loopFrom({
      ...deps,
      workspace: {
        ...deps.workspace,
        selectWorkspace: async () => {},
        workspaceRoot: () => "C:\\workspace",
      },
      rewind: new ConversationRewind(() => "rewind-pending"),
      recovery: {
        ...deps.recovery,
        review: async (id, workspaceRoot) => ({
          id,
          workspaceRoot,
          files: [],
          targets: [],
        }),
        restore: async () => {
          await restoring;
          return { files: [] };
        },
      },
    });
    await agent.selectWorkspace("C:\\workspace");
    const taskId = await agent.createTask();
    await agent.start(taskId, "First");
    const messageId = agent.snapshot().tasks[0]!.messages[0]!.id;
    const preview = await agent.previewRewind(taskId, messageId);

    const committing = agent.commitRewind(taskId, preview.id, "restore");
    await expect(agent.start(taskId, "Too soon")).rejects.toThrow(
      "Wait for file recovery to finish",
    );
    finishRestore();
    await committing;
  });
});

/**
 * A turn that writes `note.txt` once per entry in `contents`, one write a
 * round, with `between` run before each round after the first.
 */
async function turnWritingNote(
  prefix: string,
  contents: readonly string[],
  between: (round: number, root: string) => Promise<void> = async () => {},
) {
  const root = await folders.make(`zhiyin-${prefix}-`);
  const storage = await folders.make(`zhiyin-${prefix}-recovery-`);
  await writeFile(join(root, "note.txt"), "my note", "utf8");
  const workspace = new WorkspaceTools(root, { shell: undefined });
  const deps = stubDependencies(() => {});
  let request = 0;
  const agent = loopFrom({
    ...deps,
    permissions: {
      decide: async () => ({ outcome: "allow", reason: "Test policy." }),
    },
    tools: workspace,
    workspace,
    recovery: new FileRecovery(storage),
    rewind: new ConversationRewind(() => `${prefix}-${request}`),
    model: {
      ...deps.model,
      send: async function* () {
        request += 1;
        const content = contents[request - 1];
        if (request > 1) await between(request, root);
        if (content !== undefined)
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: `write-${request}`,
            name: "write_file",
            argumentsDelta: JSON.stringify({ path: "note.txt", content }),
          };
        else yield { kind: "textDelta", text: "Done." };
        yield { kind: "done" };
      },
    },
  });
  await agent.selectWorkspace(root);
  const taskId = await agent.createTask();
  await agent.start(taskId, "Rewrite the note");
  const opening = agent.snapshot().tasks[0]!.messages[0]!.id;
  return { agent, root, taskId, opening };
}

describe("undoing a turn's files", () => {
  it("can be tried again for a file that could not be put back", async () => {
    const { agent, root, taskId, opening } = await turnWritingNote(
      "undo-again",
      ["agent note"],
    );

    // Another program holds the note open for writing, so it cannot be
    // put back this time.
    const held = await open(join(root, "note.txt"), "r+");
    let first;
    try {
      const preview = await agent.previewUndo(taskId, opening);
      first = await agent.commitUndo(taskId, preview.id);
    } finally {
      await held.close();
    }
    expect(first.files).toMatchObject([
      { path: "note.txt", status: "unprotected" },
    ]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("agent note");

    const again = await agent.previewUndo(taskId, opening);
    expect(again.files).toMatchObject([
      { path: "note.txt", status: "recoverable" },
    ]);
    const second = await agent.commitUndo(taskId, again.id);

    expect(second.files).toMatchObject([
      { path: "note.txt", status: "restored" },
    ]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("my note");
  });

  it("leaves a file as it is when the person edited it between two of the turn's changes", async () => {
    const { agent, root, taskId, opening } = await turnWritingNote(
      "undo-between",
      ["agent one", "agent two"],
      async (round, folder) => {
        if (round === 2)
          await writeFile(join(folder, "note.txt"), "edited by hand", "utf8");
      },
    );

    const preview = await agent.previewUndo(taskId, opening);

    expect(preview.files).toMatchObject([
      { path: "note.txt", status: "conflict" },
    ]);
    await agent.commitUndo(taskId, preview.id);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("agent two");
  });
});

/**
 * The app as it runs, on one data folder: history, file copies and the rewind
 * journal all on disk, so a second one built on the folder is a restart. The
 * history can be made to refuse saving, as when Zhiyin closes mid-save.
 */
async function savedApp(data: string, root: string) {
  const real = new FileSessions(data);
  const refusing = { now: false };
  const sessions = new Proxy(real, {
    get(target, key) {
      if (key === "saveWorkspace" && refusing.now)
        return async () => {
          throw new Error("Zhiyin closed before the conversation was saved.");
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const workspace = new WorkspaceTools(root, { shell: undefined });
  const deps = stubDependencies(() => {});
  let request = 0;
  let rewinds = 0;
  const agent = loopFrom({
    ...deps,
    sessions,
    permissions: {
      decide: async () => ({ outcome: "allow", reason: "Test policy." }),
    },
    tools: workspace,
    workspace,
    recovery: new FileRecovery(data),
    journal: new FileRewindJournal(data),
    rewind: new ConversationRewind(() => `rewind-${++rewinds}`),
    model: {
      ...deps.model,
      send: async function* () {
        request += 1;
        if (request === 2)
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: "write-1",
            name: "write_file",
            argumentsDelta: JSON.stringify({
              path: "note.txt",
              content: "agent result",
            }),
          };
        else yield { kind: "textDelta", text: "Answer" };
        yield { kind: "done" };
      },
    },
  });
  await agent.initialize();
  return { agent, refusing };
}

describe("a rewind and the saved history", () => {
  async function changedNote() {
    const root = await folders.make("zhiyin-saved-rewind-work-");
    const data = await folders.make("zhiyin-saved-rewind-data-");
    await writeFile(join(root, "note.txt"), "before", "utf8");
    const first = await savedApp(data, root);
    await first.agent.selectWorkspace(root);
    const taskId = await first.agent.createTask();
    await first.agent.start(taskId, "First");
    await first.agent.start(taskId, "Change the note");
    const message = first.agent
      .snapshot()
      .tasks[0]!.messages.find((item) => item.text === "Change the note")!;
    return { root, data, first, taskId, message };
  }

  it("is finished at the next start when Zhiyin closed after the files went back but before the conversation was saved", async () => {
    const { root, data, first, taskId, message } = await changedNote();
    const preview = await first.agent.previewRewind(taskId, message.id);
    first.refusing.now = true;
    await expect(
      first.agent.commitRewind(taskId, preview.id, "restore"),
    ).rejects.toThrow("Zhiyin closed before the conversation was saved.");
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("before");

    const next = await savedApp(data, root);

    const reopened = next.agent.snapshot();
    expect(reopened.issues ?? []).toEqual([]);
    await next.agent.selectTask(taskId);
    expect(
      next.agent
        .snapshot()
        .tasks.find((task) => task.id === taskId)!
        .messages.map((item) => item.text),
    ).toEqual(["First", "Answer"]);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe("before");
    expect(await new FileRewindJournal(data).pending()).toEqual([]);
    // Nothing is left blocked: the conversation can be rewound again.
    const again = next.agent
      .snapshot()
      .tasks.find((task) => task.id === taskId)!.messages[0]!;
    await expect(
      next.agent.previewRewind(taskId, again.id),
    ).resolves.toMatchObject({ taskId });
  });

  it("whose save failed stays on screen as not yet stored, and is kept by the next save that succeeds", async () => {
    const { root, data, first, taskId, message } = await changedNote();
    const preview = await first.agent.previewRewind(taskId, message.id);
    first.refusing.now = true;
    await expect(
      first.agent.commitRewind(taskId, preview.id, "keep"),
    ).rejects.toThrow("Zhiyin closed before the conversation was saved.");

    const texts = (agent: TestApp) =>
      agent
        .snapshot()
        .tasks.find((task) => task.id === taskId)!
        .messages.map((item) => item.text);
    expect(texts(first.agent)).toEqual(["First", "Answer"]);
    expect(
      (first.agent.snapshot().issues ?? []).map((issue) =>
        typeof issue === "string" ? issue : issue.message,
      ),
    ).toContainEqual(expect.stringContaining("not yet stored"));

    first.refusing.now = false;
    await first.agent.renameTask(taskId, "The note");
    const next = await savedApp(data, root);
    await next.agent.selectTask(taskId);
    expect(texts(next.agent)).toEqual(["First", "Answer"]);
  });
});

describe("files a connection changes", () => {
  it("restores a PDF the built-in document compiler wrote over, byte for byte, and draws it again", async () => {
    const root = await folders.make("zhiyin-loop-compile-");
    const { agent, documents } = await compilingApp(root);

    const result = await approveThenRestore(agent, root);

    expect(result.files).toEqual([{ path: "paper.pdf", status: "restored" }]);
    expect(await readFile(join(root, "paper.pdf"))).toEqual(earlierPdf);
    // The compiled PDF was shown, and is drawn again as it was put back.
    const taskId = agent.snapshot().tasks[0]!.id;
    expect(documents.state(taskId)).toMatchObject({ path: "paper.pdf" });
    expect(documents.redrawn).toEqual([taskId]);
  });

  it("shows what a compile changed in a PDF as its words before and after the turn, until the PDF changes again", async () => {
    const root = await folders.make("zhiyin-loop-compare-");
    const { agent } = await compilingApp(root);
    await agent.selectWorkspace(root);
    const taskId = await agent.createTask();
    const running = agent.start(taskId, "Make the document");
    await until(() => agent.snapshot().tasks[0]?.phase.kind === "approval");
    await agent.resolveApproval(
      taskId,
      currentApprovalId(agent, taskId),
      "allow",
    );
    await running;
    const request = agent.snapshot().tasks[0]!.messages[0]!.id;

    expect(await agent.compareDocument(taskId, request, "paper.pdf")).toEqual({
      before: [earlierPdf.toString("latin1")],
      after: ["%PDF-1.7\nrecompiled\n"],
    });

    await writeFile(join(root, "paper.pdf"), "%PDF-1.7\nedited by hand\n");
    await expect(
      agent.compareDocument(taskId, request, "paper.pdf"),
    ).rejects.toThrow(
      "paper.pdf has changed since, so the change can no longer be shown.",
    );
  });

  it("keeps no copy for a connection that is not built in, whatever it says it changes, and still asks", async () => {
    const root = await folders.make("zhiyin-loop-remote-");
    await writeFile(join(root, "paper.pdf"), earlierPdf);
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const agent = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      // Whatever a connection's inspection carries, only the connection
      // feature can say it is built in, and this one does not.
      mcp: {
        ...deps.mcp,
        availableTools: async () => [
          {
            name: "mcp__remote__compile",
            description: "Compile a document.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Remote · Compile",
          target: "Remote",
          command: "compile()",
          access: "change",
          scope: "workspace",
          changes: [{ path: "paper.pdf", change: "updated" }],
        }),
        execute: async () => {
          await writeFile(join(root, "paper.pdf"), "%PDF-1.7\nremote\n");
          return { ok: true, value: { content: [] } };
        },
      },
      recovery: new FileRecovery(await folders.make("zhiyin-loop-recovery-")),
      rewind: new ConversationRewind(() => "rewind-remote"),
      model: {
        ...deps.model,
        send: calls(["mcp__remote__compile", {}]),
      },
    } satisfies LoopTestDependencies);

    // Reaching the approval at all shows the declaration bought no
    // automatic permission.
    await approveThenRestore(agent, root);

    expect(await readFile(join(root, "paper.pdf"), "utf8")).toBe(
      "%PDF-1.7\nremote\n",
    );
  });
});

/**
 * The app with the built-in document compiler switched on, a model that
 * compiles paper.typ over an earlier paper.pdf, and real file recovery. A
 * PDF's words are read here as its bytes, one page.
 */
async function compilingApp(root: string) {
  await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
  await writeFile(join(root, "paper.pdf"), earlierPdf);
  const compiler = documentCompiler({
    workspaceRoot: () => root,
    programs: async () => ({ typst: "C:/programs/typst.exe" }),
    run: async () => {
      await writeFile(join(root, "paper.pdf"), "%PDF-1.7\nrecompiled\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const workspace = new WorkspaceTools(root, { shell: undefined });
  const deps = stubDependencies(() => {});
  const documents = documentViewerStub();
  const agent = loopFrom({
    ...deps,
    documents,
    pdfWords: async (bytes) => [Buffer.from(bytes).toString("latin1")],
    permissions: new GuardedPermissionEngine(),
    tools: workspace,
    workspace,
    plugins: pluginStore([publishing]),
    mcp: new ManagedMcpServers(
      await folders.make("zhiyin-loop-mcp-"),
      async () => {
        throw new Error("No remote connections here.");
      },
      new InMemoryMcpCredentials(),
      { builtIns: [documentsConnection(compiler)] },
    ),
    recovery: new FileRecovery(await folders.make("zhiyin-loop-recovery-")),
    rewind: new ConversationRewind(() => "rewind-compile"),
    model: {
      ...deps.model,
      send: calls(
        ["activate_plugin", { id: "publishing" }],
        ["mcp__documents__compile_document", { path: "paper.typ" }],
      ),
    },
  } satisfies LoopTestDependencies);
  return { agent, documents };
}

function byPath<T extends { readonly path: string }>(files: readonly T[]) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}
