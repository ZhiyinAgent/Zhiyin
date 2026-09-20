/**
 * A view the turn produced, kept where a conversation reopened later can find
 * it. The turn's own rules about views — validation, order, refusal — live with
 * the loop; that it reaches the saved conversation is the core and the loop
 * together.
 */

import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot } from "@zhiyin/contract";
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

describe("a view that is saved", () => {
  it("checks, runs, and persists an inert view without requesting permission", async () => {
    const base = stubDependencies(() => {});
    const decide = vi.fn(async () => ({
      outcome: "deny" as const,
      reason: "must not run",
    }));
    const validate = vi.fn(async () => ({ ok: true as const }));
    let saved: WorkspaceSnapshot | undefined;
    const view = {
      kind: "diagram" as const,
      title: "Release flow",
      source: "flowchart LR\nDraft --> Review",
    };
    const loop = loopFrom({
      ...base,
      permissions: { decide },
      views: { validate },
      tools: {
        list: () => [
          { name: "render_diagram", description: "Draw", inputSchema: {} },
        ],
        inspect: async () => ({
          ok: true as const,
          action: "Draw a diagram",
          target: view.title,
          command: "render_diagram(…)",
          requiresApproval: false as const,
          view,
        }),
        execute: async () => ({ ok: true as const, value: null, view }),
      },
      sessions: {
        ...base.sessions,
        saveWorkspace: async (snapshot) => {
          saved = snapshot;
        },
      },
      model: { ...base.model, send: modelRequestingDiagram() },
    });

    const taskId = await loop.createTask();
    await loop.start(taskId, "Show the release flow");

    expect(validate).toHaveBeenCalledWith("diagram", view.source);
    expect(decide).not.toHaveBeenCalled();
    expect(loop.snapshot().tasks[0]?.views).toEqual([
      expect.objectContaining({
        id: "view-diagram-1",
        callId: "diagram-1",
        ...view,
      }),
    ]);
    expect(saved?.tasks[0]?.views).toHaveLength(1);
  });
});
