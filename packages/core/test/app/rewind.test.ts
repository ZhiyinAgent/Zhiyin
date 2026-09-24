import { describe, expect, it } from "vitest";
import { ConversationRewind } from "@zhiyin/conversation-rewind";
import { FileRecovery } from "@zhiyin/recovery";
import { WorkspaceTools } from "@zhiyin/tools";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDependencies, loopFrom } from "./support.js";

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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-loop-rewind-"));
    const storage = await mkdtemp(join(tmpdir(), "zhiyin-loop-recovery-"));
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
                text: "agent result",
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
