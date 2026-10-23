/**
 * The person's standing instructions: their own, set in Custom instructions, and a
 * folder's AGENTS.md once they approve it. They reach the model as one
 * `instructions` notice, sent when they change, and never grant permission.
 * ADR 0017.
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

describe("a folder's AGENTS.md", () => {
  it("reaches each conversation's turn from that conversation's own folder", async () => {
    const requests: ModelRequest[] = [];
    const base = stubDependencies(() => {});
    const folders = new Map<string, string>();
    const files = new Map<string, FolderInstructions>([
      ["/work/reports", agents("Invoices live in /finance.")],
      ["/work/notes", agents("Notes are in Markdown.")],
    ]);
    const { host } = loopAndHost({
      ...base,
      workspace: {
        ...base.workspace,
        workspaceRoot: (conversationId) => folders.get(conversationId),
        folderInstructions: async (conversationId) =>
          files.get(folders.get(conversationId) ?? ""),
      },
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    for (const [root, file] of files) host.approveFolder(root, file.hash);
    const reports = await host.app.createTask();
    const notes = await host.app.createTask();
    folders.set(reports, "/work/reports");
    folders.set(notes, "/work/notes");

    await host.app.start(reports, "Summarise the reports");
    await host.app.start(notes, "Tidy the notes");

    expect(instructionsIn(requests[0]).join(" ")).toContain(
      "Invoices live in /finance.",
    );
    expect(instructionsIn(requests[0]).join(" ")).not.toContain(
      "Notes are in Markdown.",
    );
    expect(instructionsIn(requests[1]).join(" ")).toContain(
      "Notes are in Markdown.",
    );
    expect(instructionsIn(requests[1]).join(" ")).not.toContain(
      "Invoices live in /finance.",
    );
  });
});

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

  // Past any budget's share: 5% of the largest is 50,000 tokens.
  const paragraphs = (end: string) =>
    [
      ...Array.from(
        { length: 40 },
        (_, index) => `Rule ${index + 1}. ${"Keep it short. ".repeat(300)}`,
      ),
      end,
    ].join("\n\n");

  it("are cut at a paragraph break past their share of the budget, and the model is told where", async () => {
    const { host, loop, requests } = turnWith({});
    host.personal = paragraphs("END-OF-TEXT");
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the reports");

    const sent = instructionsIn(requests[0])[0] ?? "";
    expect(sent).not.toContain("END-OF-TEXT");
    expect(sent).toMatch(
      /Keep it short\.\n\(shortened after line \d+, about [\d,]+ of [\d,]+ tokens\)/,
    );
    // One line a rule, a blank line between: the last rule kept is on line 2R-1.
    const lastRule = Math.max(
      ...[...sent.matchAll(/^Rule (\d+)\./gm)].map((rule) => Number(rule[1])),
    );
    expect(sent).toContain(`(shortened after line ${2 * lastRule - 1},`);
    expect(loop.snapshot().tasks[0]?.standingInstructions?.[0]).toMatchObject({
      source: "personal",
      truncated: true,
    });
  });

  it("are sent whole on a large budget where a small one cuts them", async () => {
    // About 30,000 tokens: past the 8,000 a small budget gives, within the
    // 42,500 of Ultra on a million-token window.
    const long = [
      ...Array.from(
        { length: 20 },
        (_, index) => `Rule ${index + 1}. ${"Keep it short. ".repeat(300)}`,
      ),
      "END-OF-TEXT",
    ].join("\n\n");
    const small = turnWith({});
    small.host.personal = long;
    const large = turnWith({});
    large.host.personal = long;
    large.host.window = { model: "large", contextWindow: 1_000_000 };
    large.host.contextBudget = "ultra";

    await small.loop.start(await small.loop.createTask(), "Summarise");
    await large.loop.start(await large.loop.createTask(), "Summarise");

    expect(instructionsIn(small.requests[0])[0]).not.toContain("END-OF-TEXT");
    expect(instructionsIn(large.requests[0])[0]).toContain("END-OF-TEXT");
    expect(instructionsIn(large.requests[0])[0]).not.toContain("shortened");
  });

  it("show the person all of a folder's instructions they approve, and the line this conversation sends them up to", async () => {
    const { loop, requests } = turnWith({
      folder: () => agents(paragraphs("END-OF-AGENTS")),
    });
    const taskId = await loop.createTask();

    const started = loop.start(taskId, "Summarise the reports");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    const phase = loop.snapshot().tasks[0]?.phase;
    const prompt = phase?.kind === "input" ? phase.prompt : undefined;
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
    await started;

    if (prompt?.kind !== "folderInstructions") throw new Error("No question.");
    expect(prompt.text).toContain("END-OF-AGENTS");
    expect(prompt.truncated).toBe(false);
    const through = prompt.sentThroughLine ?? 0;
    const sent = instructionsIn(requests[0])[0] ?? "";
    expect(sent).toContain(`(shortened after line ${through},`);
    expect(sent).toContain(
      // Spaces at the end of the cut are not sent.
      prompt.text.split("\n").slice(0, through).join("\n").trimEnd(),
    );
    expect(sent).not.toContain("END-OF-AGENTS");
  });

  it("cut a folder's instructions the same way", async () => {
    const { loop, requests } = turnWith({
      folder: () => agents(paragraphs("END-OF-AGENTS")),
    });
    const taskId = await loop.createTask();

    const started = loop.start(taskId, "Summarise the reports");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "input");
    await loop.resolveUserInput(taskId, "folder-question", {
      answers: [{ questionId: "folder-instructions", answerIds: ["use"] }],
    });
    await started;

    const sent = instructionsIn(requests[0])[0] ?? "";
    expect(sent).toContain("Rule 1.");
    expect(sent).not.toContain("END-OF-AGENTS");
    expect(sent).toMatch(/shortened after line \d+/);
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
