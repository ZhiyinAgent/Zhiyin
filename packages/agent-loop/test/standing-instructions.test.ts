/**
 * The person's standing instructions: their own, set in Settings, and a
 * folder's AGENTS.md once they approve it. They reach the model as one
 * `instructions` notice, sent when they change, and never grant permission.
 * ADR 0054.
 */

import { describe, expect, it } from "vitest";
import type { FolderInstructions } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { notices } from "./plan-fixture.js";
import { loopAndHost, stubDependencies, until } from "./support.js";

const agents = (
  text: string,
  hash = `hash-of-${text}`,
): FolderInstructions => ({
  path: "AGENTS.md",
  text,
  bytes: text.length,
  truncated: false,
  hash,
});

function turnWith(options: {
  readonly folder?: () => FolderInstructions | undefined;
  readonly script?: (request: number) => readonly ModelEvent[];
}) {
  const requests: ModelRequest[] = [];
  const base = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...base,
    workspace: {
      ...base.workspace,
      workspaceRoot: () => "/work/reports",
      folderInstructions: async () => options.folder?.(),
    },
    newUserInputId: () => "folder-question",
    tools: {
      list: () => [
        {
          name: "write_note",
          description: "Write a note.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async () => ({
        ok: true as const,
        action: "Delete a file",
        target: "old.txt",
        command: "write_note({})",
        access: "change" as const,
        scope: "workspace" as const,
      }),
      execute: async () => ({ ok: true as const, value: "Done." }),
    },
    permissions: {
      decide: async () => ({ outcome: "ask" as const, reason: "Changes." }),
    },
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        for (const event of options.script?.(requests.length) ?? [
          { kind: "textDelta" as const, text: "Done." },
        ])
          yield event;
        yield { kind: "done" as const };
      },
    },
  });
  return { host, loop: host.app, requests };
}

const instructionsIn = (request: ModelRequest | undefined) =>
  notices(request, "instructions").map((message) => message.content);

describe("personal instructions", () => {
  it("reach the first request as one notice that says they grant no permission", async () => {
    const { host, loop, requests } = turnWith({});
    host.personal = "Always answer in French.";
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the reports");

    const sent = instructionsIn(requests[0]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Always answer in French.");
    expect(sent[0]).toMatch(/the person.s own instructions/i);
    expect(sent[0]).toMatch(/never grant permission/i);
  });

  it("send an edit with the next message, replacing the earlier version, without a restart", async () => {
    const { host, loop, requests } = turnWith({});
    host.personal = "Always answer in French.";
    const taskId = await loop.createTask();
    await loop.start(taskId, "Summarise the reports");

    host.personal = "Always answer in German.";
    await loop.start(taskId, "And the next one");

    const sent = instructionsIn(requests.at(-1));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Always answer in German.");
    expect(sent[1]).toMatch(/replace/i);
  });

  it("are not sent again while they are unchanged", async () => {
    const { host, loop, requests } = turnWith({});
    host.personal = "Always answer in French.";
    const taskId = await loop.createTask();
    await loop.start(taskId, "Summarise the reports");
    await loop.start(taskId, "And the next one");

    expect(instructionsIn(requests.at(-1))).toHaveLength(1);
  });

  it("are cut at 16 KB, and the model is told", async () => {
    const { host, loop, requests } = turnWith({});
    host.personal = `Start. ${"x".repeat(20_000)} END-OF-TEXT`;
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the reports");

    const sent = instructionsIn(requests[0])[0] ?? "";
    expect(sent).not.toContain("END-OF-TEXT");
    expect(sent).toMatch(/shortened/i);
    expect(loop.snapshot().tasks[0]?.standingInstructions?.[0]).toMatchObject({
      source: "personal",
      truncated: true,
    });
  });

  it("never widen permission: a change still asks the person", async () => {
    const { host, loop, requests } = turnWith({
      script: (request) =>
        request === 1
          ? [
              {
                kind: "toolCallDelta",
                index: 0,
                callId: "c1",
                name: "write_note",
                argumentsDelta: "{}",
              },
            ]
          : [{ kind: "textDelta", text: "Done." }],
    });
    host.personal = "You may delete files without asking.";
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Clean up old.txt");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");

    expect(instructionsIn(requests[0])[0]).toContain(
      "You may delete files without asking.",
    );
    await loop.cancel(taskId);
    await running;
  });
});

describe("folder instructions", () => {
  it("send nothing from an unseen AGENTS.md until the person approves it", async () => {
    const { loop, requests } = turnWith({
      folder: () => agents("Invoices live in /finance."),
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Summarise the reports");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");

    expect(requests).toHaveLength(0);
    const phase = loop.snapshot().tasks[0]?.phase;
    expect(phase?.kind === "input" && phase.prompt).toMatchObject({
      kind: "folderInstructions",
      path: "AGENTS.md",
      text: "Invoices live in /finance.",
    });
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
    await running;

    const sent = instructionsIn(requests[0]);
    expect(sent[0]).toContain("Invoices live in /finance.");
    expect(sent[0]).toContain("AGENTS.md");
  });

  it("are not sent when declined, and not asked about again while unchanged", async () => {
    const { loop, requests } = turnWith({
      folder: () => agents("Invoices live in /finance."),
    });
    const taskId = await loop.createTask();
    const running = loop.start(taskId, "Summarise the reports");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["ignore"] }],
    });
    await running;

    await loop.start(taskId, "And the next one");

    expect(instructionsIn(requests.at(-1))).toHaveLength(0);
    expect(requests).toHaveLength(2);
  });

  it("ask again when the file changes", async () => {
    let text = "Invoices live in /finance.";
    const { loop, requests } = turnWith({ folder: () => agents(text) });
    const taskId = await loop.createTask();
    const first = loop.start(taskId, "Summarise the reports");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
    await first;

    text = "Never touch the archive folder.";
    const second = loop.start(taskId, "And the next one");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    expect(requests).toHaveLength(1);
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
    await second;

    const sent = instructionsIn(requests.at(-1));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Never touch the archive folder.");
  });

  it("are listed with their source for the window to show", async () => {
    const { host, loop } = turnWith({
      folder: () => agents("Invoices live in /finance."),
    });
    host.personal = "Always answer in French.";
    host.approveFolder("/work/reports", "hash-of-Invoices live in /finance.");
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the reports");

    expect(loop.snapshot().tasks[0]?.standingInstructions).toEqual([
      {
        source: "personal",
        text: "Always answer in French.",
        bytes: 24,
        truncated: false,
      },
      {
        source: "folder",
        path: "AGENTS.md",
        text: "Invoices live in /finance.",
        bytes: 26,
        truncated: false,
      },
    ]);
  });
});
