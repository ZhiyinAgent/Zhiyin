/**
 * A workspace document the main agent reads is shown beside the
 * conversation, and the read's answer says what the person sees (ADR 0018).
 * A specialist reads in the background, and shows nothing.
 */

import { describe, expect, it } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

/**
 * A reading tool that names the document it reads, as read_document does, and
 * a closing tool that says it closes the document, as close_document does.
 */
function readingTools(
  document?: { path: string; page?: number },
  read: { ok: true; value: unknown } | { ok: false; reason: string } = {
    ok: true,
    value: { text: "Page two says the margin widened." },
  },
) {
  return {
    list: () => [
      {
        name: "read_document",
        description: "Read one document.",
        inputSchema: { type: "object" },
      },
      {
        name: "close_document",
        description: "Close the document.",
        inputSchema: { type: "object" },
      },
    ],
    inspect: async (name: string): Promise<ToolCallInspection> =>
      name === "close_document"
        ? {
            ok: true,
            action: "Close document",
            target: "",
            command: "close_document",
            access: "read",
            scope: "workspace",
            closesDocument: true,
          }
        : {
            ok: true,
            action: "Read a workspace document",
            target: document?.path ?? "../elsewhere.pdf",
            command: "read_document",
            access: "read",
            scope: document ? "workspace" : "outside",
            ...(document ? { document } : {}),
          },
    execute: async (name: string) =>
      name === "close_document" ? { ok: true as const, value: {} } : read,
  };
}

const call = (callId: string, name: string, args: unknown): ModelEvent => ({
  kind: "toolCallDelta",
  index: 0,
  callId,
  name,
  argumentsDelta: JSON.stringify(args),
});

/** Makes each call in turn, then answers with what the model was told. */
function calls(heard: string[], names: readonly string[]) {
  let round = 0;
  return async function* (request: ModelRequest): AsyncGenerator<ModelEvent> {
    round += 1;
    const name = names[round - 1];
    if (name) yield call(`call-${round}`, name, { path: "q3.pdf" });
    else {
      heard.push(JSON.stringify(request.messages));
      yield { kind: "textDelta", text: "Done." };
    }
    yield { kind: "done" };
  };
}

function app(
  document?: { path: string; page?: number },
  options: {
    names?: readonly string[];
    read?: Parameters<typeof readingTools>[1];
  } = {},
) {
  const heard: string[] = [];
  const base = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...base,
    tools: readingTools(document, options.read),
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Read only" }),
    },
    model: {
      ...base.model,
      send: calls(heard, options.names ?? ["read_document"]),
    },
  });
  return { loop: host.app, host, heard };
}

describe("a document the main agent reads", () => {
  it("is shown, from the page read, and the read's answer says what the person sees", async () => {
    const { loop, host, heard } = app({ path: "reports/q3.pdf", page: 2 });
    const taskId = await loop.createTask();
    await loop.start(taskId, "What does page 2 say?");

    expect(host.readDocuments).toEqual([
      { taskId, path: "reports/q3.pdf", page: 2 },
    ]);
    expect(heard.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 2.",
    );
    expect(heard.at(-1)).toContain("Page two says the margin widened.");
  });

  it("tells the agent the exact link to cite a page of it with, its path encoded so nothing in it breaks the link", async () => {
    const { loop, heard } = app({ path: "reports/q3 (final).pdf", page: 1 });
    const taskId = await loop.createTask();
    await loop.start(taskId, "What does it say?");

    expect(heard.at(-1)).toContain(
      "Cite a page of this document as [page N](reports/q3%20%28final%29.pdf#page=N), with N the page.",
    );
  });

  it("tells the agent the exact link to cite a picture with", async () => {
    const { loop, heard } = app({ path: "charts/visits 2025.png" });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Look at the chart");

    expect(heard.at(-1)).toContain(
      "Cite this picture as [visits 2025.png](charts/visits%202025.png).",
    );
  });

  it("is shown when the read fails, and the failure says so", async () => {
    const { loop, host, heard } = app(
      { path: "locked.pdf", page: 1 },
      { read: { ok: false, reason: "locked.pdf is protected by a password." } },
    );
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the locked one");

    expect(host.readDocuments).toEqual([
      { taskId, path: "locked.pdf", page: 1 },
    ]);
    expect(heard.at(-1)).toContain("locked.pdf is protected by a password.");
    expect(heard.at(-1)).toContain(
      "Shown to the person beside the conversation, at page 1.",
    );
    // A page that could not be read is not one to cite.
    expect(heard.at(-1)).not.toContain("Cite a page");
  });

  it("shows nothing when the read names no workspace document", async () => {
    const { loop, host } = app();
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read that one");
    expect(host.readDocuments).toEqual([]);
  });
});

describe("a document a specialist reads", () => {
  it("is read in the background, shows nothing, and a close it asks for is refused as a tool it was not offered", async () => {
    const base = stubDependencies(() => {});
    let specialistRound = 0;
    const { host } = loopAndHost({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "research",
          specialists: [
            {
              id: "reader",
              name: "Reader",
              description: "Reads documents.",
              instructions: "Read what you are given.",
            },
          ],
        }),
      ]),
      tools: readingTools({ path: "q3.pdf", page: 1 }),
      permissions: {
        decide: async () => ({
          outcome: "allow" as const,
          reason: "Read only",
        }),
      },
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reader specialist")) {
            specialistRound += 1;
            yield specialistRound === 1
              ? call("read-1", "read_document", { path: "q3.pdf" })
              : specialistRound === 2
                ? call("close-1", "close_document", {})
                : call("finish-1", "finish_specialist", {
                    summary: "Read it.",
                    findings: [],
                    recommendations: [],
                    limitations: [],
                  });
          } else if (!text.includes("Read the report.")) {
            yield call("delegate-1", "delegate_specialist", {
              id: "research/reader",
              task: "Read the report.",
            });
          } else {
            yield {
              kind: "textDelta",
              text: text.includes("finished in the background")
                ? "All read."
                : "Waiting for the reader.",
            };
          }
          yield { kind: "done" };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const loop = host.app;
    const taskId = await loop.createTask(["research"]);
    await loop.start(taskId, "Have the report read");
    await until(
      () =>
        loop.snapshot().tasks[0]?.specialistRuns?.[0]?.status === "completed",
    );

    const specialistActions = (loop.snapshot().tasks[0]?.actions ?? []).filter(
      (action) => action.specialistRunId === "specialist-1",
    );
    expect(specialistActions.length).toBeGreaterThan(0);
    expect(host.readDocuments).toEqual([]);
    expect(host.closedDocuments).toEqual([]);
    expect(JSON.stringify(specialistActions)).toContain(
      "This specialist is not allowed to use this tool.",
    );
  });
});

describe("close_document, called by the main agent", () => {
  it("closes the document beside the conversation, and says what the person sees", async () => {
    const { loop, host, heard } = app(undefined, { names: ["close_document"] });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Close it");

    expect(host.closedDocuments).toEqual([taskId]);
    expect(heard.at(-1)).toContain(
      "Closed. The space beside the conversation goes back to the conversation.",
    );
  });
});

describe("what the agent is told about the space beside the conversation", () => {
  const line =
    "The space beside the conversation shows one thing at a time: the browser or a document. A document you read with read_document, or write, is shown there. When you cite a page of a workspace document, write the citation as a Markdown link to the document's workspace path ending in #page=N, like [page 24](reports/q3.pdf#page=24), or to a picture's path with no page, and write a space in the path as %20; the person opens it beside the conversation by clicking it. When you no longer need the browser or a document, close it with browser_close or close_document, but leave open the page your answer rests on.";

  it("is told the space is shared, word for word, when read_document is offered", async () => {
    const { loop, heard } = app({ path: "q3.pdf", page: 1 });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Read the report");
    expect(heard.at(-1)).toContain(JSON.stringify(line).slice(1, -1));
  });

  it("tells a specialist, word for word, that what it reads is not shown, and offers it nothing to close", async () => {
    const base = stubDependencies(() => {});
    const told: { messages: string; tools: string[] }[] = [];
    const { host } = loopAndHost({
      ...base,
      plugins: pluginsOffering([
        pluginOffering({
          name: "research",
          specialists: [
            {
              id: "reader",
              name: "Reader",
              description: "Reads documents.",
              instructions: "Read what you are given.",
            },
          ],
        }),
      ]),
      tools: readingTools({ path: "q3.pdf", page: 1 }),
      model: {
        ...base.model,
        send: async function* (request) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Reader specialist")) {
            told.push({
              messages: text,
              tools: request.tools.map((tool) => tool.name),
            });
            yield call("finish-1", "finish_specialist", {
              summary: "Read it.",
              findings: [],
              recommendations: [],
              limitations: [],
            });
          } else if (!text.includes("Read the report.")) {
            yield call("delegate-1", "delegate_specialist", {
              id: "research/reader",
              task: "Read the report.",
            });
          } else {
            yield { kind: "textDelta", text: "Done." };
          }
          yield { kind: "done" };
        },
      },
      newSpecialistRunId: () => "specialist-1",
    });
    const taskId = await host.app.createTask(["research"]);
    await host.app.start(taskId, "Have the report read");
    await until(() => told.length > 0);

    expect(told[0]!.tools).toContain("read_document");
    expect(told[0]!.tools).not.toContain("close_document");
    expect(told[0]!.messages).not.toContain(
      "The space beside the conversation",
    );
    expect(told[0]!.messages).toContain(
      "You work in the background. A document you read or write is not shown to the person, and you have no space beside the conversation to open or close: never say the person can see something because you read it.",
    );
  });

  it("is told nothing of it when read_document is not offered", async () => {
    const heard: string[] = [];
    const base = stubDependencies(() => {});
    const { host } = loopAndHost({
      ...base,
      model: {
        ...base.model,
        send: async function* (request) {
          heard.push(JSON.stringify(request.messages));
          yield { kind: "textDelta", text: "Hello." };
          yield { kind: "done" };
        },
      },
    });
    const taskId = await host.app.createTask();
    await host.app.start(taskId, "Hello");
    expect(heard.at(-1)).not.toContain("The space beside the conversation");
  });
});
