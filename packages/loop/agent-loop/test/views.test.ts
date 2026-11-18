import { describe, expect, it } from "vitest";
import { fakeCorrectionsLog } from "@zhiyin/corrections-log/testing";
import { stubDependencies, loopFrom } from "./support.js";

function modelRequestingDiagram() {
  let turn = 0;
  return async function* () {
    turn += 1;
    if (turn === 1)
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "diagram-1",
        name: "render_diagram",
        argumentsDelta: JSON.stringify({
          title: "Release flow",
          source: "flowchart LR\nDraft --> Review",
        }),
      };
    else yield { kind: "textDelta" as const, text: "Here is the flow." };
    yield { kind: "done" as const };
  };
}

/**
 * Several drawings in one turn. Each one has to land where it was made, in the
 * order it was made: the timeline is sorted on a single sequence shared by
 * messages, actions and views, so a view numbered as though views did not
 * exist collides with the next action and overtakes it.
 */
function modelRequestingThree() {
  let turn = 0;
  return async function* () {
    turn += 1;
    if (turn === 1) {
      for (const [index, [callId, title]] of [
        ["one", "First"],
        ["two", "Second"],
        ["three", "Third"],
      ].entries()) {
        yield {
          kind: "toolCallDelta" as const,
          index,
          callId: callId as string,
          name: "render_diagram",
          argumentsDelta: JSON.stringify({
            title,
            source: `flowchart LR
${title as string} --> Done`,
          }),
        };
      }
    } else yield { kind: "textDelta" as const, text: "Three drawings." };
    yield { kind: "done" as const };
  };
}

describe("AgentLoop view order", () => {
  it("keeps each drawing where it was made, in the order it was made", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      views: { validate: async () => ({ ok: true as const }) },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async (_name, args) => {
          const input = args as { title: string; source: string };
          return {
            ok: true as const,
            action: "Draw a diagram",
            target: input.title,
            command: "render_diagram(…)",
            requiresApproval: false as const,
            view: { kind: "diagram" as const, ...input },
          };
        },
        execute: async (_name, args) => {
          const input = args as { title: string; source: string };
          return {
            ok: true as const,
            value: null,
            view: { kind: "diagram" as const, ...input },
          };
        },
      },
      model: { ...base.model, send: modelRequestingThree() },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Draw three");

    const task = loop.snapshot().tasks[0];
    const views = task?.views ?? [];
    expect(views.map((view) => view.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    // Every position on the timeline is its own. A shared one is an ordering
    // decided by whichever list happened to be built first.
    const sequences = [
      ...(task?.messages ?? []).map((item) => item.sequence),
      ...(task?.actions ?? []).map((item) => item.sequence),
      ...views.map((item) => item.sequence),
    ];
    expect(new Set(sequences).size).toBe(sequences.length);
    // A drawing that arrived is its own record; the request for it is not kept
    // beside it saying the same thing in the words of the call.
    expect(task?.actions ?? []).toEqual([]);
  });

  /**
   * A drawing takes its request row away with it. Anything numbered from how
   * many rows are left then reuses a name, and two different actions under one
   * id means the record of the first is overwritten by the second.
   */
  it("never gives two actions the same name, even after a drawing removes one", async () => {
    const base = stubDependencies(() => {});
    let turn = 0;
    const loop = loopFrom({
      ...base,
      views: { validate: async () => ({ ok: true as const }) },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Fine" }),
      },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
          {
            name: "write_file",
            description: "Write",
            inputSchema: {},
            role: "writes-file" as const,
          },
        ],
        inspect: async (name) =>
          name === "render_diagram"
            ? {
                ok: true as const,
                action: "Draw a diagram",
                target: "Flow",
                command: "render_diagram(…)",
                requiresApproval: false as const,
                view: {
                  kind: "diagram" as const,
                  title: "Flow",
                  source: "flowchart LR\nA --> B",
                },
              }
            : {
                ok: true as const,
                action: "Create a workspace file",
                target: "notes.md",
                command: "write_file(…)",
              },
        execute: async (name) =>
          name === "render_diagram"
            ? {
                ok: true as const,
                value: null,
                view: {
                  kind: "diagram" as const,
                  title: "Flow",
                  source: "flowchart LR\nA --> B",
                },
              }
            : { ok: true as const, value: {} },
      },
      model: {
        ...base.model,
        send: async function* () {
          turn += 1;
          if (turn <= 2) {
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `call-${turn}`,
              name: turn === 1 ? "render_diagram" : "write_file",
              argumentsDelta: "{}",
            };
          } else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Draw then write");

    const task = loop.snapshot().tasks[0];
    expect(task?.views).toHaveLength(1);
    // The drawing's row is gone; the write kept its own, under its own name.
    expect(task?.actions?.map((action) => action.action)).toEqual([
      "Create a workspace file",
    ]);
    expect(task?.actions?.[0]?.id).not.toBe(`${taskId}-action-0`);
  });

  /**
   * A source the renderer rejects is correctable and is answered to the model
   * alone (ADR 0009), so it leaves no row. A drawing that passed review and
   * then failed to be produced is a different thing: nothing arrived, and the
   * row is the only account of the attempt.
   */
  it("keeps the record of a drawing that never arrived", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      views: { validate: async () => ({ ok: true as const }) },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Draw a diagram",
          target: "Broken",
          command: "render_diagram(…)",
          requiresApproval: false as const,
          view: {
            kind: "diagram" as const,
            title: "Broken",
            source: "flowchart ???",
          },
        }),
        execute: async () => ({
          ok: false as const,
          reason: "The requested view failed while it was being prepared.",
        }),
      },
      model: { ...base.model, send: modelRequestingDiagram() },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Draw something impossible");

    const task = loop.snapshot().tasks[0];
    expect(task?.views ?? []).toEqual([]);
    expect(task?.actions?.map((action) => action.status)).toEqual(["failed"]);
  });
});

describe("what the window decided when it drew a view", () => {
  const picture = { mediaType: "image/png", data: "iVBORw0KGgo=" };
  const fact = "Draft is drawn as a box left of Review.";

  /** What the model was sent after it drew a diagram the window checked and drew. */
  async function answerFor(acceptsImages: boolean) {
    const base = stubDependencies(() => {});
    const sent: unknown[] = [];
    const model = modelRequestingDiagram();
    const loop = loopFrom({
      ...base,
      acceptsImages,
      views: {
        validate: async () => ({
          ok: true as const,
          drawn: { facts: [fact], picture },
        }),
      },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Draw a diagram",
          target: "Release flow",
          command: "render_diagram(…)",
          requiresApproval: false as const,
          view: {
            kind: "diagram" as const,
            title: "Release flow",
            source: "flowchart LR\nDraft --> Review",
          },
        }),
        execute: async () => ({
          ok: true as const,
          value: { shown: true },
          view: {
            kind: "diagram" as const,
            title: "Release flow",
            source: "flowchart LR\nDraft --> Review",
          },
        }),
      },
      model: {
        ...base.model,
        send: (request: { readonly messages: readonly unknown[] }) => {
          sent.push(structuredClone(request.messages));
          return model();
        },
      },
    });
    await loop.start(await loop.createTask(), "Draw the flow");
    return JSON.stringify(sent.at(-1));
  }

  it("is said with the answer, with a picture for a model that sees", async () => {
    const seeing = await answerFor(true);
    const blind = await answerFor(false);

    expect(seeing).toContain(fact);
    expect(seeing).toContain(picture.data);
    expect(blind).toContain(fact);
    expect(blind).not.toContain(picture.data);
  });
});

describe("AgentLoop views", () => {
  it("returns an unvalidated view to the model without showing a broken view", async () => {
    const base = stubDependencies(() => {});
    const loop = loopFrom({
      ...base,
      views: {
        validate: async () => ({ ok: false, reason: "Parse error on line 2" }),
      },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Draw a diagram",
          target: "Broken",
          command: "render_diagram(…)",
          requiresApproval: false as const,
          view: {
            kind: "diagram" as const,
            title: "Broken",
            source: "flowchart ???",
          },
        }),
        execute: async () => ({ ok: true as const, value: null }),
      },
      model: { ...base.model, send: modelRequestingDiagram() },
    });
    const taskId = await loop.createTask();
    await loop.start(taskId, "Draw it");

    expect(loop.snapshot().tasks[0]?.views ?? []).toEqual([]);
  });

  it("records a view that fails its check once the three quiet tries are spent, and logs only the quiet ones as quiet", async () => {
    const base = stubDependencies(() => {});
    const corrections = fakeCorrectionsLog();
    let turn = 0;
    const loop = loopFrom({
      ...base,
      corrections,
      views: {
        validate: async () => ({ ok: false, reason: "Parse error on line 2" }),
      },
      guidanceModel: {
        send: async function* () {
          yield { kind: "done" as const };
        },
      },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Draw a diagram",
          target: "Broken",
          command: "render_diagram(…)",
          requiresApproval: false as const,
          view: {
            kind: "diagram" as const,
            title: "Broken",
            source: "flowchart ???",
          },
        }),
        execute: async () => ({ ok: true as const, value: null }),
      },
      model: {
        ...base.model,
        send: async function* () {
          turn += 1;
          if (turn <= 5)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `diagram-${turn}`,
              name: "render_diagram",
              argumentsDelta: JSON.stringify({ title: "Broken", source: "?" }),
            };
          else
            yield { kind: "textDelta" as const, text: "I could not draw it." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Draw it");

    const actions = loop.snapshot().tasks[0]?.actions ?? [];
    expect(actions.map((action) => action.status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(actions[0]?.reason).toContain("Parse error on line 2");
    expect(
      corrections.entries.filter((entry) => entry.kind === "quiet-retry"),
    ).toHaveLength(3);
  });
});

describe("a drawn view saved to a file", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const view = {
    kind: "diagram" as const,
    title: "Release flow",
    source: "flowchart LR\nDraft --> Review",
  };

  /** A diagram drawn with save_to, the window answering as `drawn` says, the write decided by `decide`. */
  async function saving(options: {
    readonly saveTo?: string;
    readonly drawn?: { facts: string[]; svg?: string };
    readonly decide?: "allow" | "deny";
    readonly offersWrite?: boolean;
    readonly refusesPath?: boolean;
  }) {
    const base = stubDependencies(() => {});
    const sent: unknown[] = [];
    const asked: { file?: boolean }[] = [];
    const writes: unknown[] = [];
    const model = modelRequestingDiagram();
    const shown = options.saveTo ? { ...view, saveTo: options.saveTo } : view;
    const loop = loopFrom({
      ...base,
      views: {
        validate: async (_kind, _source, wanted) => {
          asked.push({ ...wanted });
          return {
            ok: true as const,
            ...(options.drawn ? { drawn: options.drawn } : {}),
          };
        },
      },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
          ...(options.offersWrite === false
            ? []
            : [
                {
                  name: "write_file",
                  description: "Write",
                  inputSchema: {},
                  role: "writes-file" as const,
                },
              ]),
        ],
        inspect: async (name, args) =>
          name === "write_file" && options.refusesPath
            ? {
                ok: false as const,
                reason: "charts/flow.svg is outside the workspace.",
                correctable: true,
              }
            : name === "write_file"
              ? {
                  ok: true as const,
                  action: "Write a file",
                  target: (args as { path: string }).path,
                  command: "write_file(…)",
                }
              : {
                  ok: true as const,
                  action: "Draw a diagram",
                  target: "Release flow",
                  command: "render_diagram(…)",
                  requiresApproval: false as const,
                  view: shown,
                },
        execute: async (name, args) => {
          if (name === "write_file") {
            writes.push(args);
            return { ok: true as const, value: { written: true } };
          }
          return { ok: true as const, value: { shown: true }, view: shown };
        },
      },
      permissions: {
        decide: async (request) =>
          request.name === "write_file" && options.decide === "allow"
            ? { outcome: "allow" as const, reason: "The folder is allowed." }
            : { outcome: "deny" as const, reason: "Writing is not allowed." },
      },
      model: {
        ...base.model,
        send: (request: { readonly messages: readonly unknown[] }) => {
          sent.push(structuredClone(request.messages));
          return model();
        },
      },
    });
    await loop.start(await loop.createTask(), "Draw the flow");
    return { answer: JSON.stringify(sent.at(-1)), asked, writes };
  }

  it("writes the window's drawing to the file named, through write_file, once it is allowed", async () => {
    const { answer, asked, writes } = await saving({
      saveTo: "charts/flow.svg",
      drawn: { facts: ["Drawn."], svg },
      decide: "allow",
    });

    expect(asked).toEqual([{ file: true }]);
    expect(writes).toEqual([{ path: "charts/flow.svg", content: svg }]);
    expect(answer).toContain("Saved the drawing to charts/flow.svg");
  });

  it("shows the view but writes nothing when the write is refused, and says why", async () => {
    const { answer, writes } = await saving({
      saveTo: "charts/flow.svg",
      drawn: { facts: ["Drawn."], svg },
      decide: "deny",
    });

    expect(writes).toEqual([]);
    expect(answer).toContain("shown");
    expect(answer).toContain(
      "The drawing was not saved to charts/flow.svg: Writing is not allowed.",
    );
  });

  it("writes nothing when write_file refuses the path, and says why", async () => {
    const { answer, writes } = await saving({
      saveTo: "charts/flow.svg",
      drawn: { facts: ["Drawn."], svg },
      decide: "allow",
      refusesPath: true,
    });

    expect(writes).toEqual([]);
    expect(answer).toContain(
      "The drawing was not saved to charts/flow.svg: charts/flow.svg is outside the workspace.",
    );
  });

  it("writes nothing where no tool that writes files is offered, and says so", async () => {
    const { answer, writes } = await saving({
      saveTo: "charts/flow.svg",
      drawn: { facts: ["Drawn."], svg },
      decide: "allow",
      offersWrite: false,
    });

    expect(writes).toEqual([]);
    expect(answer).toContain(
      "The drawing was not saved to charts/flow.svg: no tool that writes files is offered here.",
    );
  });

  it("writes nothing when the window gave no drawing, and says so", async () => {
    const { answer, writes } = await saving({
      saveTo: "charts/flow.svg",
      drawn: { facts: ["Drawn."] },
      decide: "allow",
    });

    expect(writes).toEqual([]);
    expect(answer).toContain(
      "The drawing was not saved to charts/flow.svg: the window gave no drawing of it.",
    );
  });

  it("asks the window for no file when none is to be saved", async () => {
    const { asked, writes } = await saving({ drawn: { facts: ["Drawn."] } });

    expect(asked).toEqual([{}]);
    expect(writes).toEqual([]);
  });
});
