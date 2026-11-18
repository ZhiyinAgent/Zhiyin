/**
 * Memory in a conversation (ADR 0026): what the model is sent of it, the
 * `remember` and `recall` calls the loop answers itself, a turn that ends on
 * keeping something, and the look back over a work turn that kept nothing.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActionEffects,
  AppEvent,
  ModelWindow,
  ToolCallInspection,
} from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { FileMemory } from "@zhiyin/memory";
import { TemporaryFolders } from "@zhiyin/test-support";
import { notices, resultOf } from "./plan-fixture.js";
import { loopAndHost, stubDependencies, until, wordsOf } from "./support.js";
import type { AfterCallHook } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

type Call = { readonly name: string; readonly args: Record<string, unknown> };
/** What the working model does in one request: words, calls, or both. */
type Step = {
  readonly text?: string;
  readonly calls?: readonly Call[];
  /** Held until this settles, as a slow answer is. */
  readonly wait?: Promise<void>;
};

const nothing: ActionEffects = {
  reads: "workspace",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/**
 * A turn whose model follows `script`, with a real memory in a folder of its
 * own. `list_directory` reads the workspace; `fetch_page` brings outside
 * content.
 */
async function withMemory(options: {
  readonly script: (request: number, sent: ModelRequest) => Step;
  readonly hooks?: readonly AfterCallHook[];
  readonly folder?: string;
  /** What list_directory answers. */
  readonly listing?: string;
  readonly modelWindow?: ModelWindow & { readonly model: string };
  /** Where memory is kept; a folder of its own when left out. */
  readonly memoryFolder?: string;
  /** Hears each of Zhiyin's own errors. */
  readonly defects?: unknown[];
  /** Tells the window of each change. */
  readonly emit?: (event: AppEvent) => void;
}) {
  const memory = new FileMemory({
    folder:
      options.memoryFolder ??
      join(await folders.make("zhiyin-loop-memory-"), "memory"),
    now: () => new Date("2026-10-31T09:00:00.000Z"),
    newId: (() => {
      let id = 0;
      return () => `write-${(id += 1)}`;
    })(),
    broadFolders: [],
    recycle: async () => {},
  });
  const requests: ModelRequest[] = [];
  const executed: string[] = [];
  const base = stubDependencies(options.emit ?? (() => {}));
  const inspection = (name: string, args: unknown): ToolCallInspection => ({
    ok: true,
    action: name === "fetch_page" ? "Open a page" : "List a folder",
    target: name === "fetch_page" ? "https://forum.example/thread" : ".",
    command: `${name}(${JSON.stringify(args)})`,
    effects:
      name === "fetch_page"
        ? { ...nothing, reads: "none", brings: "outside" }
        : nothing,
  });
  const { host } = loopAndHost({
    ...base,
    memory,
    ...(options.hooks ? { afterCalls: options.hooks } : {}),
    ...(options.defects
      ? { recordDefect: ({ error }) => void options.defects?.push(error) }
      : {}),
    ...(options.modelWindow ? { modelWindow: options.modelWindow } : {}),
    workspace: {
      ...base.workspace,
      workspaceRoot: () => options.folder,
    },
    tools: {
      list: () =>
        ["list_directory", "fetch_page"].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object" },
          access: "read" as const,
        })),
      inspect: async (name: string, args: unknown) => inspection(name, args),
      execute: async (name: string) => {
        executed.push(name);
        return {
          ok: true as const,
          value:
            name === "fetch_page" ? "A page." : (options.listing ?? "a.txt"),
        };
      },
    } as never,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Reads." }),
    } as never,
    model: {
      ...base.model,
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        requests.push(request);
        const step = options.script(requests.length, request);
        if (step.wait) await step.wait;
        if (step.text) yield { kind: "textDelta", text: step.text };
        for (const [index, call] of (step.calls ?? []).entries())
          yield {
            kind: "toolCallDelta",
            index,
            callId: `call-${requests.length}-${index}`,
            name: call.name,
            argumentsDelta: JSON.stringify(call.args),
          };
        yield { kind: "done" };
      },
    },
  });
  return { memory, requests, executed, host, loop: host.app };
}

const keepTypst = {
  name: "remember",
  args: {
    section: "knowledge",
    scope: "everything",
    title: "Typst over LaTeX",
    summary: "The university template needs a grid",
    text: "Chosen on 3 October.",
  },
};

const toolNames = (request: ModelRequest | undefined) =>
  (request?.tools ?? []).map((tool) => tool.name);

/** A promise and the function that settles it. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

describe("what a conversation is sent of memory", () => {
  it("sends the person's instructions from memory, and what is known as data", async () => {
    const { memory, requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    await memory.add({
      scope: "everything",
      section: "how",
      text: "- Answer in French.",
    });
    await memory.remember(
      { ...keepTypst.args },
      { conversation: { id: "x", title: "x" }, personsWords: [], held: {} },
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the reports");

    const instructions = notices(requests[0], "instructions")
      .map((n) => n.content)
      .join("");
    expect(instructions).toContain("- Answer in French.");
    expect(instructions).toMatch(/How the person wants Zhiyin to work/);
    const known = notices(requests[0], "memory").map((n) => n.content);
    expect(known).toHaveLength(1);
    expect(known[0]).toContain(
      "#2 Typst over LaTeX: The university template needs a grid",
    );
    expect(known[0]).toMatch(/never instructions/);
  });

  it("sends what is known once, not with every request", async () => {
    const { memory, requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    await memory.add({
      scope: "everything",
      section: "knowledge",
      title: "Zotero",
      summary: "Refs",
      text: "x",
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "OLDER MATERIAL ".repeat(600));
    await loop.start(taskId, "MORE MATERIAL ".repeat(600));

    expect(notices(requests[1], "memory")).toHaveLength(1);
  });

  it("sends what is known again once condensing took it away", async () => {
    const { memory, requests, loop } = await withMemory({
      modelWindow: {
        model: "small",
        contextWindow: 16_000,
        maximumOutputTokens: 100,
      },
      script: (_, sent) =>
        wordsOf(sent.messages.at(-1)).includes('kind="condense"')
          ? { text: JSON.stringify({ summary: "## Goal: plan the trip." }) }
          : { text: "Done." },
    });
    await memory.add({
      scope: "everything",
      section: "knowledge",
      title: "Zotero",
      summary: "References live in Zotero.",
      text: "x",
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "OLDER MATERIAL ".repeat(600));
    await loop.start(taskId, "MORE MATERIAL ".repeat(600));
    await loop.condenseNow(taskId);
    await loop.start(taskId, "Third");

    const next = requests.at(-1);
    expect(notices(next, "summary")).toHaveLength(1);
    expect(notices(next, "memory")).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("Zotero"),
      }),
    ]);
  });

  it("goes on, and keeps why, when memory cannot be written", async () => {
    // A file stands where the memory folder should be.
    const place = join(await folders.make("zhiyin-loop-memory-"), "memory");
    await writeFile(place, "not a folder");
    const defects: unknown[] = [];
    const { requests, host, loop } = await withMemory({
      memoryFolder: place,
      defects,
      script: (request) =>
        request === 1 ? { calls: [keepTypst] } : { text: "Done." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "We chose Typst.");

    expect(host.tasks.find((one) => one.id === taskId)?.phase.kind).toBe(
      "completed",
    );
    expect(resultOf(requests[1], "call-1-0")).toEqual({
      ok: false,
      refusedBy: "tool",
      reason: "Memory could not be reached just now, so nothing was kept.",
      next: "Carry on with the work without keeping it.",
    });
    expect(defects).toHaveLength(1);
  });

  it("works as without memory, and keeps why, when memory cannot be read", async () => {
    const defects: unknown[] = [];
    const { requests, host, loop } = await withMemory({
      // A path no folder can have.
      memoryFolder: join(
        await folders.make("zhiyin-loop-memory-"),
        "mem\u0000ory",
      ),
      defects,
      script: () => ({ text: "Done." }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hello");

    expect(host.tasks.find((one) => one.id === taskId)?.phase.kind).toBe(
      "completed",
    );
    expect(requests[0]?.tools?.map((tool) => tool.name)).not.toContain(
      "recall",
    );
    expect(notices(requests[0], "instructions")).toEqual([]);
    expect(defects).not.toEqual([]);
  });

  it("stops the turn on an error of Zhiyin's own while it notes what memory sends, rather than going on without memory", async () => {
    const defects: unknown[] = [];
    let failed = false;
    const { requests, host, loop } = await withMemory({
      defects,
      // Telling the window that the conversation holds what memory sends
      // fails, once.
      emit: (event) => {
        if (event.kind !== "taskChanged" || !event.data.memorySent || failed)
          return;
        failed = true;
        throw new Error("The window could not be told.");
      },
      script: () => ({ text: "Done." }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hello");

    expect(host.tasks.find((one) => one.id === taskId)?.phase).toEqual({
      kind: "failed",
      reason: "Zhiyin stopped on an error of its own. Try again.",
      remedies: ["tryAgain"],
    });
    expect(requests).toEqual([]);
    expect(defects).toEqual([new Error("The window could not be told.")]);
  });

  it("keeps a write whose card the disk refused, the card still shown for its Undo", async () => {
    const { memory, loop, host } = await withMemory({
      script: (request) =>
        request === 1 ? { calls: [keepTypst] } : { text: "Done." },
    });
    // The disk refuses the save that records the card, once.
    let refused = false;
    host.refusesSave = (task) => {
      if (refused || !task.actions.some((action) => action.memory))
        return false;
      refused = true;
      return true;
    };
    const taskId = await loop.createTask();

    await loop.start(taskId, "We chose Typst.");

    expect((await memory.state()).entries).toHaveLength(1);
    expect(
      host.tasks
        .find((one) => one.id === taskId)
        ?.actions.find((action) => action.memory)?.memory,
    ).toMatchObject({ title: "Typst over LaTeX", change: "added" });
  });

  it("offers remember and recall, and nothing of memory while it is off", async () => {
    const { memory, requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    await memory.add({
      scope: "everything",
      section: "how",
      text: "- Answer in French.",
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "OLDER MATERIAL ".repeat(600));
    await memory.switch(false);
    await loop.start(taskId, "MORE MATERIAL ".repeat(600));

    expect(toolNames(requests[0])).toEqual(
      expect.arrayContaining(["remember", "recall"]),
    );
    expect(toolNames(requests[1])).not.toContain("remember");
    expect(toolNames(requests[1])).not.toContain("recall");
  });

  it("offers remember with this conversation's own scope outside a project, and the project's in one", async () => {
    const linked = await folders.make("zhiyin-loop-project-");
    const { memory, requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
      folder: linked,
    });
    const scopesOffered = (request: ModelRequest | undefined) =>
      (
        request?.tools?.find((tool) => tool.name === "remember")
          ?.inputSchema as { properties: { scope: { enum: string[] } } }
      ).properties.scope.enum;

    await loop.start(await loop.createTask(), "First");
    await memory.createProject("Thesis", [linked]);
    await loop.start(await loop.createTask(), "Second");

    expect(scopesOffered(requests[0])).toEqual(["everything", "conversation"]);
    expect(scopesOffered(requests[1])).toEqual(["everything", "project"]);
  });

  it("sends a conversation outside any project what it kept for itself", async () => {
    const { memory, requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    const taskId = await loop.createTask();
    await memory.remember(
      {
        section: "knowledge",
        scope: "conversation",
        title: "Flights booked",
        summary: "Land Pudong Friday morning",
        text: "Home Monday night.",
      },
      {
        conversation: { id: taskId, title: "Shanghai trip" },
        personsWords: [],
        held: {},
      },
    );

    await loop.start(taskId, "Plan the days");

    const known = notices(requests[0], "memory")
      .map((n) => n.content)
      .join("");
    expect(known).toContain(
      "Knowledge for this conversation:\n#1 Flights booked: Land Pudong Friday morning",
    );
  });

  it("offers only recall in a conversation the person keeps nothing from", async () => {
    const { requests, loop, host } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    const taskId = await loop.createTask();
    const task = host.tasks.find((one) => one.id === taskId)!;
    host.tasks = host.tasks.map((one) =>
      one === task ? { ...one, memoryOff: true } : one,
    );

    await loop.start(taskId, "OLDER MATERIAL ".repeat(600));

    expect(toolNames(requests[0])).toContain("recall");
    expect(toolNames(requests[0])).not.toContain("remember");
  });

  it("keeps nothing a model asks to keep where remember is not offered", async () => {
    const { memory, requests, loop, host } = await withMemory({
      script: (request) =>
        request === 1 ? { calls: [keepTypst] } : { text: "Done." },
    });
    const taskId = await loop.createTask();
    host.tasks = host.tasks.map((one) =>
      one.id === taskId ? { ...one, memoryOff: true } : one,
    );

    await loop.start(taskId, "We chose Typst.");

    expect((await memory.state()).entries).toEqual([]);
    expect(resultOf(requests[1], "call-1-0")).toMatchObject({
      ok: false,
      reason: "The tool “remember” is not available.",
    });
  });

  it("keeps nothing once the person asks, mid-turn, to keep nothing from the conversation", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { memory, requests, loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? { calls: [{ name: "list_directory", args: {} }], wait: held }
          : request === 2
            ? { calls: [keepTypst] }
            : { text: "Done." },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "We chose Typst.");
    await until(() => requests.length === 1);
    host.tasks = host.tasks.map((one) =>
      one.id === taskId ? { ...one, memoryOff: true } : one,
    );
    release();
    await running;

    expect((await memory.state()).entries).toEqual([]);
  });

  it("sends the project's memory again once the conversation moves to another project", async () => {
    const { memory, requests, loop, host } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    const thesis = (await memory.createProject("Thesis")).project!.id;
    const kitchen = (await memory.createProject("Kitchen")).project!.id;
    const context = (project: string) => ({
      conversation: { id: "x", title: "x" },
      project,
      personsWords: [],
      held: {},
    });
    await memory.remember(
      { section: "brief", summary: "Chapter 3", text: "Goal: June." },
      context(thesis),
    );
    await memory.remember(
      { section: "brief", summary: "Quotes in", text: "Goal: March." },
      context(kitchen),
    );
    const taskId = await loop.createTask();
    const choose = (project: string) => {
      host.tasks = host.tasks.map((one) =>
        one.id === taskId ? { ...one, project } : one,
      );
    };

    choose(thesis);
    await loop.start(taskId, "OLDER MATERIAL ".repeat(600));
    choose(kitchen);
    await loop.start(taskId, "MORE MATERIAL ".repeat(600));

    const sent = notices(requests[1], "memory").map((n) => n.content);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("Goal: June.");
    expect(sent[1]).toContain(
      "This conversation is now in the project Kitchen.",
    );
    expect(sent[1]).toContain("Goal: March.");
  });
});

describe("keeping and reading memory in a turn", () => {
  it("keeps an entry, answers with its number, and records it for the conversation's card", async () => {
    const { memory, requests, loop, host } = await withMemory({
      script: (request) =>
        request === 1 ? { calls: [keepTypst] } : { text: "Kept." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Remember why we chose Typst");

    expect(resultOf(requests[1], "call-1-0")).toMatchObject({
      kept: "added",
      number: 1,
      title: "Typst over LaTeX",
    });
    expect((await memory.state()).entries).toMatchObject([
      { number: 1, title: "Typst over LaTeX" },
    ]);
    const action = host.tasks.find((one) => one.id === taskId)!.actions.at(-1)!;
    expect(action).toMatchObject({
      action: "Keep in memory",
      toolName: "remember",
      status: "completed",
      memory: {
        number: 1,
        change: "added",
        title: "Typst over LaTeX",
        scopeName: "Everything you do",
      },
      // What was kept, as the person may check it from the record.
      details: [
        {
          kind: "text",
          label: "#1 Typst over LaTeX",
          text: "The university template needs a grid\n\nChosen on 3 October.",
        },
      ],
    });
  });

  it("adds what a hook after the call says to the model's answer", async () => {
    const { requests, loop } = await withMemory({
      hooks: [
        {
          tool: "remember",
          run: async ({ answer }) => ({
            close: `Something is close to #${String((answer as { number: number }).number)}.`,
          }),
        },
      ],
      script: (request) =>
        request === 1 ? { calls: [keepTypst] } : { text: "Kept." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Remember why we chose Typst");

    expect(resultOf(requests[1], "call-1-0")).toMatchObject({
      number: 1,
      close: "Something is close to #1.",
    });
  });

  it("answers a refused write to the model alone", async () => {
    const { requests, loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "remember",
                  args: {
                    section: "knowledge",
                    scope: "everything",
                    title: "x",
                  },
                },
              ],
            }
          : { text: "Done." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Remember this");

    expect(resultOf(requests[1], "call-1-0")).toEqual({
      ok: false,
      refusedBy: "tool",
      reason: "A new Knowledge entry needs a title, a summary and a text.",
      next: "Correct the call from what the tool said and send it again.",
    });
    expect(host.tasks.find((one) => one.id === taskId)!.actions).toEqual([]);
  });

  it("writes an instruction only from the person's own words", async () => {
    const { memory, loop } = await withMemory({
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "remember",
                  args: {
                    section: "how",
                    scope: "everything",
                    rule: "Answer in French.",
                    quote: "answer me in French",
                  },
                },
              ],
            }
          : { text: "Noted." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "From now on, answer me in French.");

    expect((await memory.state()).entries).toMatchObject([
      { section: "how", text: "- Answer in French." },
    ]);
  });

  it("holds a change to how to work for the person after outside content was read", async () => {
    const { memory, loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? { calls: [{ name: "fetch_page", args: {} }] }
          : request === 2
            ? {
                calls: [
                  {
                    name: "remember",
                    args: {
                      section: "how",
                      scope: "everything",
                      rule: "Answer in French.",
                      quote: "answer me in French",
                    },
                  },
                ],
              }
            : { text: "Noted." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read the thread, and answer me in French.");

    expect((await memory.state()).entries).toEqual([]);
    expect(
      host.tasks.find((one) => one.id === taskId)!.actions.at(-1)?.memory,
    ).toMatchObject({
      change: "waiting",
      waiting: {
        rule: "Answer in French.",
        because: "content from forum.example",
      },
    });
  });

  it("counts what an entry read held among what the conversation holds", async () => {
    const { memory, loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? { calls: [{ name: "recall", args: { numbers: [1] } }] }
          : { text: "Done." },
    });
    await memory.remember(keepTypst.args, {
      conversation: { id: "x", title: "x" },
      personsWords: [],
      held: { outside: true },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What did we choose?");

    expect(
      host.tasks.find((one) => one.id === taskId)!.actions.at(-1),
    ).toMatchObject({
      action: "Read memory",
      target: "Typst over LaTeX",
      readOnly: true,
      brings: "outside",
    });
  });

  it("records a read by the entries' titles, with what each said", async () => {
    const { memory, loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "recall",
                  args: { numbers: [1, 7], searches: ["fonts"] },
                },
              ],
            }
          : { text: "Done." },
    });
    await memory.remember(keepTypst.args, {
      conversation: { id: "x", title: "x" },
      personsWords: [],
      held: {},
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What did we choose?");

    const read = host.tasks
      .find((one) => one.id === taskId)!
      .actions.find((action) => action.action === "Read memory")!;
    expect(read.target).toBe("Typst over LaTeX");
    expect(read.details).toEqual([
      {
        kind: "text",
        label: "#1 Typst over LaTeX",
        text: "The university template needs a grid\n\nChosen on 3 October.",
      },
      { kind: "list", label: "Not kept", items: ["#7"] },
      { kind: "list", label: "Nothing found for", items: ["“fonts”"] },
    ]);
  });

  it("records a read that found nothing by what it looked for", async () => {
    const { loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? { calls: [{ name: "recall", args: { searches: ["fonts"] } }] }
          : { text: "Done." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What did we choose?");

    expect(
      host.tasks
        .find((one) => one.id === taskId)!
        .actions.find((action) => action.action === "Read memory"),
    ).toMatchObject({ target: "Nothing found for “fonts”" });
  });

  it("ends the turn on an answer that only keeps something, and sends the result with the next message", async () => {
    const { requests, loop } = await withMemory({
      script: (request) =>
        request === 1
          ? { text: "Typst it is.", calls: [keepTypst] }
          : { text: "Hello." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Use Typst");
    expect(requests).toHaveLength(1);
    await loop.start(taskId, "Next question");

    const sent = requests[1]!.messages;
    const result = sent.findIndex((message) => message.role === "tool");
    const question = sent.findIndex(
      (message) => wordsOf(message) === "Next question",
    );
    expect(result).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(result);
  });

  it("goes on after an answer whose write was refused, so the model can write it again", async () => {
    const { requests, loop } = await withMemory({
      script: (request) =>
        request === 1
          ? {
              text: "Noted.",
              calls: [
                {
                  name: "remember",
                  args: {
                    section: "knowledge",
                    scope: "everything",
                    title: "x",
                  },
                },
              ],
            }
          : { text: "Done." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Use Typst");

    expect(requests).toHaveLength(2);
  });
});

describe("looking back over a work turn", () => {
  /** Three rounds of work, then an answer; then whatever the look back does. */
  const workThen =
    (review: (request: number) => Step) =>
    (request: number): Step =>
      request <= 3
        ? { calls: [{ name: "list_directory", args: {} }] }
        : request === 4
          ? { text: "Here is the summary." }
          : review(request);

  it("asks once more, from the turn's own request, whether anything should last", async () => {
    const { requests, loop } = await withMemory({
      script: workThen(() => ({ text: "" })),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 5);

    const review = requests[4]!;
    const turn = requests[3]!;
    expect(review.messages.slice(0, turn.messages.length)).toEqual(
      turn.messages,
    );
    expect(notices(review, "review")).toHaveLength(1);
    expect(review.tools).toEqual(turn.tools);
  });

  it("lets the model call only remember and recall from its notice on, round after round, while the turn's tools stay for the cache", async () => {
    const { requests, loop } = await withMemory({
      script: workThen((request) =>
        request === 5 ? { calls: [keepTypst] } : { text: "" },
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 6);

    for (const round of [requests[4]!, requests[5]!]) {
      expect(round.tools).toEqual(requests[3]!.tools);
      expect([...(round.callable?.tools ?? [])].sort()).toEqual([
        "recall",
        "remember",
      ]);
      expect(JSON.stringify(round.messages[round.callable!.after])).toContain(
        'kind=\\"review\\"',
      );
    }
    expect(requests[5]!.callable).toEqual(requests[4]!.callable);
  });

  it("takes six rounds at most", async () => {
    const recallTrip = { name: "recall", args: { searches: ["trip"] } };
    const { requests, loop } = await withMemory({
      script: workThen(() => ({ calls: [recallTrip] })),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length >= 10);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests).toHaveLength(4 + 6);
  });

  it("keeps what it is told, shows it in the conversation, and tells the model at its next request", async () => {
    const { memory, requests, loop, host } = await withMemory({
      script: (request) =>
        request <= 3
          ? { calls: [{ name: "list_directory", args: {} }] }
          : request === 4
            ? { text: "Here is the summary." }
            : request === 5
              ? { calls: [keepTypst] }
              : request === 6
                ? { text: "" }
                : { text: "Hello." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(
      () =>
        host.tasks.find((one) => one.id === taskId)!.memoryKept !== undefined,
    );
    await loop.start(taskId, "Next");

    expect((await memory.state()).entries).toHaveLength(1);
    expect(
      host.tasks
        .find((one) => one.id === taskId)!
        .actions.some((action) => action.memory?.change === "added"),
    ).toBe(true);
    const kept = notices(requests[6], "kept")
      .map((n) => n.content)
      .join("");
    expect(kept).toContain("#1 Typst over LaTeX (Everything you do): added");
    expect(notices(requests[6], "review")).toEqual([]);
  });

  it("tells the model once what it kept, when the next turn told it while the look back's write was still being saved", async () => {
    const { requests, loop, host } = await withMemory({
      script: (request) =>
        request <= 3 || request === 7
          ? { calls: [{ name: "list_directory", args: {} }] }
          : request === 4
            ? { text: "Here is the summary." }
            : request === 5
              ? { calls: [keepTypst] }
              : request === 6
                ? { text: "" }
                : { text: "Done." },
    });
    const taskId = await loop.createTask();
    // The look back's write is held, and so is the next turn's write that
    // takes what was kept off the conversation once it has told the model.
    const kept = gate();
    const told = gate();
    let keptSaving = false;
    let toldSaving = false;
    host.holdsSave = (task) => {
      if (task.id !== taskId) return undefined;
      if (!keptSaving && task.memoryKept) {
        keptSaving = true;
        return kept.opened;
      }
      if (keptSaving && !toldSaving && !task.memoryKept) {
        toldSaving = true;
        return told.opened;
      }
      return undefined;
    };

    await loop.start(taskId, "Summarise the folder");
    await until(() => keptSaving);
    const next = loop.start(taskId, "Next");
    await until(() => toldSaving);
    kept.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    told.open();
    await next;

    expect(requests).toHaveLength(8);
    expect(notices(requests[7], "kept")).toHaveLength(1);
  });

  it("marks its reads and writes as the look back's, and the turn's own as the turn's", async () => {
    const recallTrip = { name: "recall", args: { searches: ["trip"] } };
    const { loop, host } = await withMemory({
      script: (request) =>
        request === 1
          ? { calls: [recallTrip] }
          : request <= 3
            ? { calls: [{ name: "list_directory", args: {} }] }
            : request === 4
              ? { text: "Here is the summary." }
              : request === 5
                ? { calls: [recallTrip, keepTypst] }
                : { text: "" },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(
      () =>
        host.tasks.find((one) => one.id === taskId)!.memoryKept !== undefined,
    );

    const memoryActions = host.tasks
      .find((one) => one.id === taskId)!
      .actions.filter((action) => action.toolName !== "list_directory")
      .map(({ action, lookBack }) => ({ action, lookBack }));
    expect(memoryActions).toEqual([
      { action: "Read memory", lookBack: undefined },
      { action: "Read memory", lookBack: true },
      { action: "Keep in memory", lookBack: true },
    ]);
  });

  it("refuses any other call while looking back", async () => {
    const { requests, executed, loop } = await withMemory({
      script: workThen((request) =>
        request === 5
          ? { calls: [{ name: "list_directory", args: {} }] }
          : { text: "" },
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 6);

    expect(executed).toEqual([
      "list_directory",
      "list_directory",
      "list_directory",
    ]);
    expect(resultOf(requests[5], "call-5-0")).toEqual({
      ok: false,
      refusedBy: "input-check",
      reason:
        "The turn is over: its work waits for the person's next message. Only remember and recall can be called while looking back.",
      next: "Call remember or recall, or call nothing.",
    });
  });

  it("sends back no call without a name while looking back", async () => {
    const { requests, loop } = await withMemory({
      script: workThen((request) =>
        request === 5
          ? { calls: [{ name: "", args: {} }, keepTypst] }
          : { text: "" },
      ),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 6);

    const sentBack = (requests[5]?.messages ?? []).flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    );
    expect(sentBack.map((call) => call.name)).toContain("remember");
    expect(sentBack.some((call) => !call.name)).toBe(false);
  });

  it("does not look back over a turn that kept something, or one of little work", async () => {
    const kept = await withMemory({
      script: (request) =>
        request <= 2
          ? { calls: [{ name: "list_directory", args: {} }] }
          : request === 3
            ? { calls: [keepTypst] }
            : { text: "Done." },
    });
    const short = await withMemory({
      script: (request) =>
        request <= 2
          ? { calls: [{ name: "list_directory", args: {} }] }
          : { text: "Done." },
    });

    await kept.loop.start(await kept.loop.createTask(), "Work");
    await short.loop.start(await short.loop.createTask(), "Work");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(kept.requests).toHaveLength(4);
    expect(short.requests).toHaveLength(3);
  });

  it("is stopped by the next turn, keeping nothing", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { memory, requests, loop } = await withMemory({
      script: (request) =>
        request <= 3
          ? { calls: [{ name: "list_directory", args: {} }] }
          : request === 4
            ? { text: "Here is the summary." }
            : request === 5
              ? { calls: [keepTypst], wait: held }
              : { text: "Next answer." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 5);
    await loop.start(taskId, "Something else");
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await memory.state()).entries).toEqual([]);
    expect(requests).toHaveLength(6);
  });

  it("keeps nothing once the person asks to keep nothing from the conversation", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { memory, requests, loop, host } = await withMemory({
      script: workThen(() => ({ calls: [keepTypst], wait: held })),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 5);
    host.tasks = host.tasks.map((one) =>
      one.id === taskId ? { ...one, memoryOff: true } : one,
    );
    release();
    await until(() => requests.length === 6);

    expect((await memory.state()).entries).toEqual([]);
  });

  it("is stopped by Stop, keeping nothing", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { memory, requests, loop } = await withMemory({
      script: workThen(() => ({ calls: [keepTypst], wait: held })),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Summarise the folder");
    await until(() => requests.length === 5);
    await loop.cancel(taskId);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await memory.state()).entries).toEqual([]);
    expect(requests).toHaveLength(5);
  });

  it("looks back over the work about to be condensed, from the request before it", async () => {
    let work = 0;
    const { requests, loop } = await withMemory({
      modelWindow: {
        model: "small",
        contextWindow: 16_000,
        maximumOutputTokens: 100,
      },
      listing: "file.txt ".repeat(1_500),
      script: (_, sent) => {
        const last = wordsOf(sent.messages.at(-1));
        if (last.includes('kind="review"')) return { text: "" };
        if (last.includes('kind="condense"'))
          return { text: JSON.stringify({ summary: "## Goal: summarise." }) };
        work += 1;
        return work <= 6
          ? { calls: [{ name: "list_directory", args: {} }] }
          : { text: "Done." };
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "OLDER MATERIAL ".repeat(1600));
    await until(() =>
      requests.some((request) => notices(request, "review").length > 0),
    );

    const condensed = requests.findIndex((request) =>
      wordsOf(request.messages.at(-1)).includes('kind="condense"'),
    );
    const review = requests.find(
      (request) => notices(request, "review").length > 0,
    )!;
    expect(condensed).toBeGreaterThan(-1);
    expect(notices(review, "summary")).toEqual([]);
    expect(review.messages.length).toBeGreaterThan(
      requests[condensed]!.messages.length - 2,
    );
  });
});

describe("hooks after a call", () => {
  it("add their note to any tool's answer, and a failing one adds nothing", async () => {
    const { requests, loop } = await withMemory({
      hooks: [
        { tool: "list_directory", run: async () => ({ note: "Listed." }) },
        {
          tool: "list_directory",
          run: () => Promise.reject(new Error("broken")),
        },
        { tool: "fetch_page", run: async () => ({ never: true }) },
      ],
      script: (request) =>
        request === 1
          ? { calls: [{ name: "list_directory", args: {} }] }
          : { text: "Done." },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "List the folder");

    const answer = resultOf(requests[1], "call-1-0");
    expect(answer).toMatchObject({ ok: true, note: "Listed." });
    expect(answer).not.toHaveProperty("never");
  });
});

describe("the system prompt", () => {
  it("tells the model to look in memory before working, and to keep what will matter", async () => {
    const { requests, loop } = await withMemory({
      script: () => ({ text: "Done." }),
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Hello");

    const prompt = wordsOf(requests[0]!.messages[0]);
    expect(prompt).toMatch(
      /When a task starts, recall what may already be known/,
    );
    expect(prompt).toMatch(
      /Keep what will matter in later conversations with remember/,
    );
  });
});
