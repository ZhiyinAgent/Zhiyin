import { describe, expect, it, vi } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import type { AuditEntry } from "@zhiyin/audit";
import { stubDependencies, loopFrom } from "./support.js";

/** Collects what would have been written to the durable audit record. */
function recordingAudit() {
  const entries: AuditEntry[] = [];
  return {
    entries,
    log: {
      record: async (entry: AuditEntry) => {
        entries.push(entry);
      },
      read: async () => entries,
    },
  };
}

/**
 * A tool that accepts an edit only when it is aimed at the text the file
 * actually holds. Everything else is refused as correctable, with `replace`
 * declared untouchable.
 */
function pickyEditTool() {
  const seen: unknown[] = [];
  return {
    seen,
    registry: {
      list: () => [
        {
          name: "multi_edit",
          description: "Replace exact text in workspace files.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (
        _name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        seen.push(args);
        const find = (args as { find?: string }).find;
        return find === "Owner: Rowan"
          ? {
              ok: true,
              action: "Edit a workspace file",
              target: "notes.md",
              command: "multi_edit({})",
            }
          : {
              ok: false,
              correctable: true,
              preserveOnRepair: ["replace"],
              reason: `“${find}” was not found in notes.md.`,
            };
      },
      execute: async () => ({ ok: true as const, value: { edited: true } }),
    },
  };
}

function answersOnce(json: string) {
  return async function* () {
    yield { kind: "textDelta" as const, text: json };
    yield { kind: "done" as const };
  };
}

/** The main model proposes the same wrong call once, then stops. */
function proposesOnce(args: string) {
  let turn = 0;
  return async function* (request: ModelRequest) {
    turn += 1;
    if (turn === 1) {
      yield {
        kind: "toolCallDelta" as const,
        index: 0,
        callId: "call-1",
        name: "multi_edit",
        argumentsDelta: args,
      };
    } else {
      yield { kind: "textDelta" as const, text: "The edit is in place." };
    }
    void request;
    yield { kind: "done" as const };
  };
}

function loopWith(
  tool: ReturnType<typeof pickyEditTool>,
  guidance: ReturnType<typeof answersOnce>,
  captured?: ModelMessage[][],
  audit?: ReturnType<typeof recordingAudit>,
) {
  const deps = stubDependencies(() => {});
  return loopFrom({
    ...deps,
    ...(audit ? { audit: audit.log } : {}),
    tools: tool.registry,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
    },
    guidanceModel: { send: guidance },
    model: {
      ...deps.model,
      send: (() => {
        const inner = proposesOnce(
          '{"find":"Owner: Dana","replace":"Owner: Kim"}',
        );
        return async function* (request: ModelRequest) {
          captured?.push([...request.messages]);
          yield* inner(request);
        };
      })(),
    },
  });
}

describe("AgentLoop silent repair", () => {
  it("re-aims a refused edit through a small model without troubling anyone", async () => {
    const tool = pickyEditTool();
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "repair",
          arguments: { find: "Owner: Rowan", replace: "Owner: Kim" },
        }),
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // The repaired call is what ran.
    expect(tool.seen.at(-1)).toEqual({
      find: "Owner: Rowan",
      replace: "Owner: Kim",
    });
    const task = loop.snapshot().tasks[0];
    expect(task?.phase.kind).toBe("completed");
    // One completed action, and no trace of the refusal.
    expect(task?.actions?.map((action) => action.status)).toEqual([
      "completed",
    ]);
    expect(JSON.stringify(task)).not.toContain("was not found");
  });

  it("rewrites the model's own record of the call to what actually ran", async () => {
    const tool = pickyEditTool();
    const requests: ModelMessage[][] = [];
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "repair",
          arguments: { find: "Owner: Rowan", replace: "Owner: Kim" },
        }),
      ),
      requests,
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    const afterwards = JSON.stringify(requests.at(-1));
    expect(afterwards).toContain("Owner: Rowan");
    // The draft that never ran is gone from the model's context.
    expect(afterwards).not.toContain("Owner: Dana");
  });

  it("hands back to the main model when the small model is unsure", async () => {
    const tool = pickyEditTool();
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "handover",
          reason: "Two lines could be the one meant.",
        }),
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // Only the original call was inspected: nothing was invented.
    expect(tool.seen).toEqual([{ find: "Owner: Dana", replace: "Owner: Kim" }]);
    // Still invisible to the person — it fell back to the quiet retry path.
    expect(loop.snapshot().tasks[0]?.actions ?? []).toEqual([]);
  });

  it("discards a repair that rewrites what the edit would put in the file", async () => {
    const tool = pickyEditTool();
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "repair",
          // Correctly aimed, but it changed the replacement text nobody asked
          // it to change.
          arguments: { find: "Owner: Rowan", replace: "Owner: SOMEONE ELSE" },
        }),
      ),
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(tool.seen).toEqual([{ find: "Owner: Dana", replace: "Owner: Kim" }]);
    expect(loop.snapshot().tasks[0]?.actions ?? []).toEqual([]);
  });

  it("gives up rather than repeating a repair that was already refused", async () => {
    const tool = pickyEditTool();
    const repairRequests: string[] = [];
    const answer = answersOnce(
      // The same wrong arguments it was just handed.
      JSON.stringify({
        action: "repair",
        arguments: { find: "Owner: Dana", replace: "Owner: Kim" },
      }),
    );
    const guidance = vi.fn(async function* (request: ModelRequest) {
      const text = request.messages.map((m) => m.content).join(" ");
      if (text.includes("A tool refused this call")) repairRequests.push(text);
      yield* answer();
    });
    const loop = loopWith(tool, guidance as never);
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // Two attempts are allowed, but the second would repeat a refused call.
    expect(repairRequests).toHaveLength(1);
    expect(tool.seen).toEqual([{ find: "Owner: Dana", replace: "Owner: Kim" }]);
  });

  it("writes every correction to the audit record, including why one was thrown away", async () => {
    const audit = recordingAudit();
    const tool = pickyEditTool();
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "repair",
          // Correctly aimed, but it rewrote the replacement text.
          arguments: { find: "Owner: Rowan", replace: "Owner: SOMEONE ELSE" },
        }),
      ),
      undefined,
      audit,
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // None of this appeared in the transcript...
    expect(loop.snapshot().tasks[0]?.actions ?? []).toEqual([]);
    // ...but all of it is on the record.
    expect(audit.entries.map((entry) => [entry.kind, entry.cause])).toEqual([
      ["repair-rejected", "content-changed"],
      ["quiet-retry", undefined],
    ]);
    const rejected = audit.entries[0];
    expect(rejected?.toolName).toBe("multi_edit");
    expect(rejected?.taskId).toBe(taskId);
    expect(rejected?.after).toContain("SOMEONE ELSE");
    expect(rejected?.at).toBe("2026-09-02T19:00:00.000Z");
  });

  it("records a repair that was applied, with what it changed", async () => {
    const audit = recordingAudit();
    const tool = pickyEditTool();
    const loop = loopWith(
      tool,
      answersOnce(
        JSON.stringify({
          action: "repair",
          arguments: { find: "Owner: Rowan", replace: "Owner: Kim" },
        }),
      ),
      undefined,
      audit,
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ kind: "repair-applied" });
    expect(audit.entries[0]?.before).toContain("Owner: Dana");
    expect(audit.entries[0]?.after).toContain("Owner: Rowan");
  });

  it("keeps working, and says so, when the audit record cannot be written", async () => {
    const tool = pickyEditTool();
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      audit: {
        record: async () => {
          throw new Error("disk full");
        },
        read: async () => [],
        clear: async () => {},
      },
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      guidanceModel: {
        send: answersOnce(JSON.stringify({ action: "handover" })),
      },
      model: {
        ...deps.model,
        send: (() => {
          const inner = proposesOnce(
            '{"find":"Owner: Dana","replace":"Owner: Kim"}',
          );
          return async function* (request: ModelRequest) {
            yield* inner(request);
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    // The turn is unharmed...
    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
    // ...and the gap in the record is not hidden.
    expect(loop.snapshot().issues).toContain(
      "Corrections could not be written to the audit log. Work continued; the record is incomplete.",
    );
  });

  it("carries on when the small model answers with nothing usable", async () => {
    const tool = pickyEditTool();
    const loop = loopWith(tool, answersOnce("not json at all"));
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
    expect(loop.snapshot().tasks[0]?.actions ?? []).toEqual([]);
  });
});
