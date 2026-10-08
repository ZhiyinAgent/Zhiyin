import { describe, expect, it } from "vitest";
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
          { name: "write_file", description: "Write", inputSchema: {} },
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
   * alone (ADR 0014), so it leaves no row. A drawing that passed review and
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
});
