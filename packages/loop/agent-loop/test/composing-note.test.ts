/**
 * While the model writes a call, the conversation says what it is writing, by
 * the name the person knows the tool by: a connection's tool as its label,
 * never the routed name the model calls it by.
 */

import { describe, expect, it } from "vitest";
import type { AppEvent, WorkspaceTask } from "@zhiyin/contract";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies, until } from "./support.js";

function setUp(
  tools: {
    name: string;
    label?: string;
    connection?: { id: string; tool: string };
  }[],
) {
  const seen: AppEvent[] = [];
  const deps = stubDependencies((event) => seen.push(event));
  let release = () => {};
  let sent = 0;
  const held = new Promise<void>((resolve) => (release = resolve));
  const loop = loopFrom({
    ...deps,
    revealDelayMs: 0,
    mcp: {
      ...deps.mcp,
      availableTools: async () =>
        tools.map((tool) => ({
          ...tool,
          description: "A tool.",
          inputSchema: { type: "object" },
        })),
    },
    model: {
      ...deps.model,
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        sent += 1;
        if (sent > 1) {
          yield { kind: "textDelta", text: "Done." };
          yield { kind: "done", finishReason: "stop" };
          return;
        }
        const name = request.tools?.[0]?.name ?? "";
        yield { kind: "toolCallDelta", index: 0, callId: "c1", name };
        // Held mid-call, as a long call is while the model writes it.
        await held;
        yield { kind: "done", finishReason: "stop" };
      },
    },
  });
  const notes = () =>
    seen.flatMap((event) => {
      if (event.kind !== "taskChanged") return [];
      const phase = (event.data as WorkspaceTask).phase;
      return phase.kind === "working" && phase.note ? [phase.note] : [];
    });
  return { loop, notes, release };
}

describe("the note while a call is written", () => {
  it("names a connection's tool by its label", async () => {
    const { loop, notes, release } = setUp([
      { name: "mcp__cad__cad_build", label: "CAD studio · Build" },
    ]);
    const taskId = await loop.createTask();

    const turn = loop.start(taskId, "Build a bracket");
    await until(() => notes().some((note) => note.startsWith("Composing")));
    release();
    await turn;

    expect(notes()).toContain("Composing a request: CAD studio · Build");
  });

  it("names a tool without a label by its own name, not its routing prefix", async () => {
    const { loop, notes, release } = setUp([
      {
        name: "mcp_3f2a1b0c9d8e_cad_build",
        connection: { id: "cad", tool: "cad_build" },
      },
    ]);
    const taskId = await loop.createTask();

    const turn = loop.start(taskId, "Build a bracket");
    await until(() => notes().some((note) => note.startsWith("Composing")));
    release();
    await turn;

    expect(notes()).toContain("Composing a request: Cad build");
  });
});
