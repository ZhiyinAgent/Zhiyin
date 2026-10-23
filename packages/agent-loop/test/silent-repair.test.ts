import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallInspection } from "@zhiyin/contract";
import {
  ModelClientError,
  type ModelMessage,
  type ModelRequest,
} from "@zhiyin/model-client";
import type { AuditEntry } from "@zhiyin/audit";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { stubDependencies, loopFrom, until } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
 * actually holds. Everything else is refused as correctable, naming `find`
 * as the input at fault.
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
              faulty: ["find"],
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
          fields: { find: "Owner: Rowan" },
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
          fields: { find: "Owner: Rowan" },
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
          // Correctly aimed, but it changed the replacement text, which the
          // refusal was not about.
          fields: { find: "Owner: Rowan", replace: "Owner: SOMEONE ELSE" },
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
        fields: { find: "Owner: Dana" },
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
          fields: { find: "Owner: Rowan", replace: "Owner: SOMEONE ELSE" },
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
          fields: { find: "Owner: Rowan" },
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

  it("moves an input to the name its schema gives it, and adds nothing the refusal was not about", async () => {
    // A tool that, like the shell, refuses any field it does not define.
    const seen: unknown[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: {
        list: () => [
          {
            name: "bash",
            description: "Run one shell command.",
            inputSchema: {
              type: "object",
              properties: {
                command: { type: "string" },
                description: { type: "string" },
              },
              required: ["command", "description"],
            },
          },
        ],
        inspect: async (
          _name: string,
          args: unknown,
        ): Promise<ToolCallInspection> => {
          seen.push(args);
          const unknown = Object.keys(args as object).filter(
            (key) => key !== "command" && key !== "description",
          );
          return unknown.length
            ? {
                ok: false,
                correctable: true,
                faulty: unknown,
                reason: `Unknown fields: ${unknown.join(", ")}.`,
              }
            : {
                ok: true,
                action: "Run a command",
                target: "workspace",
                command: "dir",
              };
        },
        execute: async () => ({ ok: true as const, value: { exitCode: 0 } }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      guidanceModel: {
        send: answersOnce(
          JSON.stringify({
            action: "repair",
            // The model's own sentence, under the name the schema asks for.
            fields: { description: "List it." },
            remove: ["explanation"],
          }),
        ),
      },
      model: {
        ...deps.model,
        send: (() => {
          let turn = 0;
          return async function* () {
            turn += 1;
            if (turn === 1)
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "call-1",
                name: "bash",
                argumentsDelta: '{"command":"dir","explanation":"List it."}',
              };
            else yield { kind: "textDelta" as const, text: "Listed." };
            yield { kind: "done" as const };
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "What is in this folder?");

    expect(seen.at(-1)).toEqual({ command: "dir", description: "List it." });
    expect(
      loop.snapshot().tasks[0]?.actions?.map((action) => action.status),
    ).toEqual(["completed"]);
  });

  it("sends a refusal that names no input to the model, and never to a repair", async () => {
    const audit = recordingAudit();
    const asked: string[] = [];
    const handover = answersOnce(JSON.stringify({ action: "handover" }));
    const guidance = async function* (request: ModelRequest) {
      asked.push(JSON.stringify(request.messages));
      yield* handover();
    };
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      audit: audit.log,
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (): Promise<ToolCallInspection> => ({
          ok: false,
          correctable: true,
          reason:
            "Choose a workspace-relative file path and the text to write.",
        }),
        execute: async () => ({ ok: true as const, value: {} }),
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      guidanceModel: { send: guidance },
      model: {
        ...deps.model,
        send: (() => {
          let turn = 0;
          return async function* () {
            turn += 1;
            if (turn === 1)
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "call-1",
                name: "write_file",
                argumentsDelta: '{"path":"a.md","text":"Hello."}',
              };
            else yield { kind: "textDelta" as const, text: "Stopped." };
            yield { kind: "done" as const };
          };
        })(),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write it");

    expect(
      asked.some((text) => text.includes("A tool refused this call")),
    ).toBe(false);
    expect(audit.entries.map((entry) => [entry.kind, entry.cause])).toEqual([
      ["repair-rejected", "no-fields"],
      ["quiet-retry", undefined],
    ]);
  });

  it("shows the repair the inputs at fault whole, and the rest of the call shortened", async () => {
    const tool = pickyEditTool();
    const prompts: string[] = [];
    const answer = answersOnce(JSON.stringify({ action: "handover" }));
    const guidance = vi.fn(async function* (request: ModelRequest) {
      const text = request.messages.map((m) => m.content).join("\n");
      if (text.includes("A tool refused this call")) prompts.push(text);
      yield* answer();
    });
    const replace = `Owner: ${"Kim ".repeat(1_000)}`;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      guidanceModel: { send: guidance as never },
      model: {
        ...deps.model,
        send: proposesOnce(JSON.stringify({ find: "Owner: Dana", replace })),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('{"find":"Owner: Dana"}');
    expect(prompts[0]).not.toContain(replace);
    expect(prompts[0]).toContain("(4,007 characters)");
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

/**
 * A mail tool whose schema requires a subject. A call that leaves it out is
 * refused as correctable, naming nothing: the schema names `subject`.
 */
function mailLoop(
  answer: Record<string, unknown>,
  said: string,
  audit?: ReturnType<typeof recordingAudit>,
) {
  const sent: unknown[] = [];
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    ...(audit ? { audit: audit.log } : {}),
    tools: {
      list: () => [
        {
          name: "send_mail",
          description: "Send a message.",
          inputSchema: {
            type: "object",
            properties: {
              to: { type: "string" },
              subject: { type: "string" },
              body: { type: "string" },
            },
            required: ["to", "subject", "body"],
          },
        },
      ],
      inspect: async (
        _name: string,
        args: unknown,
      ): Promise<ToolCallInspection> =>
        typeof (args as { subject?: unknown }).subject === "string"
          ? {
              ok: true,
              action: "Send a message",
              target: "rowan@example.test",
              command: "send_mail({})",
            }
          : {
              ok: false,
              correctable: true,
              reason: "The message needs a subject.",
            },
      execute: async (_name: string, args: unknown) => {
        sent.push(args);
        return { ok: true as const, value: { sent: true } };
      },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Granted" }),
    },
    guidanceModel: { send: answersOnce(JSON.stringify(answer)) },
    model: {
      ...deps.model,
      send: (() => {
        let turn = 0;
        return async function* () {
          turn += 1;
          if (turn === 1) {
            yield { kind: "textDelta" as const, text: said };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "send_mail",
              argumentsDelta: JSON.stringify({
                to: "rowan@example.test",
                body: "The figures are attached.",
              }),
            };
          } else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        };
      })(),
    },
  });
  return { loop, sent };
}

describe("a repair on a model that cannot answer without reasoning", () => {
  it("asks for the least effort the model lists, and is answered at it", async () => {
    const tool = pickyEditTool();
    const answered: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      leastReasoning: { enabled: true, effort: "low" },
      tools: tool.registry,
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Approved" }),
      },
      guidanceModel: {
        // Refuses what the model does not take, as the model client does:
        // reasoning off, and any effort it does not list.
        send: async function* (request: ModelRequest) {
          const reasoning = request.reasoning;
          if (
            reasoning &&
            (!reasoning.enabled ||
              (reasoning.effort && !["low", "high"].includes(reasoning.effort)))
          )
            throw new ModelClientError(
              "unsupportedReasoning",
              "This model does not support the selected reasoning.",
            );
          answered.push(request);
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify({
              action: "repair",
              fields: { find: "Owner: Rowan" },
            }),
          };
          yield { kind: "done" as const };
        },
      },
      model: {
        ...deps.model,
        send: proposesOnce('{"find":"Owner: Dana","replace":"Owner: Kim"}'),
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Change the owner to Kim");

    expect(tool.seen.at(-1)).toEqual({
      find: "Owner: Rowan",
      replace: "Owner: Kim",
    });
    // Every request that was answered ran at the effort asked for, never at
    // whatever the model does when it is told nothing.
    expect(answered.length).toBeGreaterThan(0);
    for (const request of answered)
      expect(request.reasoning).toEqual({ enabled: true, effort: "low" });
  });
});

describe("a repair of an input the schema finds missing", () => {
  it("never changes another input, such as the body of a message", async () => {
    const audit = recordingAudit();
    const { loop, sent } = mailLoop(
      {
        action: "repair",
        fields: { subject: "Hello", body: "Something else entirely." },
      },
      "Sending the figures to Rowan, subject Hello.",
      audit,
    );
    const taskId = await loop.createTask();

    await loop.start(taskId, "Send Rowan the figures");

    expect(sent).toEqual([]);
    expect(audit.entries[0]).toMatchObject({
      kind: "repair-rejected",
      cause: "content-changed",
    });
  });

  it("fills it only with words the model wrote around the call", async () => {
    const invented = recordingAudit();
    const made = mailLoop(
      { action: "repair", fields: { subject: "Hello" } },
      "Sending the figures to Rowan.",
      invented,
    );
    const quoted = mailLoop(
      { action: "repair", fields: { subject: "Quarterly figures" } },
      "Sending Rowan the figures, subject: Quarterly figures.",
    );

    await made.loop.start(await made.loop.createTask(), "Send the figures");
    await quoted.loop.start(await quoted.loop.createTask(), "Send the figures");

    expect(made.sent).toEqual([]);
    expect(invented.entries[0]).toMatchObject({
      kind: "repair-rejected",
      cause: "not-in-evidence",
    });
    expect(quoted.sent).toEqual([
      {
        to: "rowan@example.test",
        subject: "Quarterly figures",
        body: "The figures are attached.",
      },
    ]);
  });
});

/**
 * A tool with the given schema that refuses through `refuse`, a main model
 * that makes one call after saying `said`, and a repairer that gives its
 * answers in order, one per refused call it is shown.
 */
function repairLoop(options: {
  readonly schema: Record<string, unknown>;
  readonly refuse: (args: Record<string, unknown>) => string | undefined;
  readonly faulty?: (args: Record<string, unknown>) => string[];
  readonly call: Record<string, unknown>;
  readonly said: string;
  readonly answers: readonly Record<string, unknown>[];
}) {
  const audit = recordingAudit();
  const ran: unknown[] = [];
  const answers = [...options.answers];
  const deps = stubDependencies(() => {});
  const loop = loopFrom({
    ...deps,
    audit: audit.log,
    tools: {
      list: () => [
        {
          name: "save_note",
          description: "Save a note.",
          inputSchema: options.schema,
        },
      ],
      inspect: async (
        _name: string,
        args: unknown,
      ): Promise<ToolCallInspection> => {
        const record = args as Record<string, unknown>;
        const reason = options.refuse(record);
        return reason
          ? {
              ok: false,
              correctable: true,
              reason,
              ...(options.faulty ? { faulty: options.faulty(record) } : {}),
            }
          : {
              ok: true,
              action: "Save a note",
              target: "notes",
              command: "save_note({})",
            };
      },
      execute: async (_name: string, args: unknown) => {
        ran.push(args);
        return { ok: true as const, value: { saved: true } };
      },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Granted" }),
    },
    guidanceModel: {
      send: async function* (request: ModelRequest) {
        const text = request.messages.map((m) => m.content).join("\n");
        if (text.includes("A tool refused this call"))
          yield {
            kind: "textDelta" as const,
            text: JSON.stringify(answers.shift() ?? { action: "handover" }),
          };
        yield { kind: "done" as const };
      },
    },
    model: {
      ...deps.model,
      send: (() => {
        let turn = 0;
        return async function* () {
          turn += 1;
          if (turn === 1) {
            yield { kind: "textDelta" as const, text: options.said };
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "save_note",
              argumentsDelta: JSON.stringify(options.call),
            };
          } else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        };
      })(),
    },
  });
  return { loop, ran, audit };
}

const noteSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    note: { type: "string" },
    labels: { type: "object" },
  },
  required: ["path", "note"],
};

describe("what a repair may put in", () => {
  it("checks it against the model's own call, never against an earlier repair", async () => {
    const invented = "Words nobody wrote";
    const { loop, ran, audit } = repairLoop({
      schema: noteSchema,
      // The tool names the path while it is not "notes/a.md".
      refuse: (args) =>
        args["path"] !== "notes/a.md"
          ? "No such folder."
          : typeof args["note"] !== "string"
            ? "The note is missing."
            : undefined,
      faulty: (args) => (args["path"] !== "notes/a.md" ? ["path"] : []),
      call: { path: "note/a.md" },
      said: "Saving the note to notes/a.md.",
      answers: [
        { action: "repair", fields: { path: invented } },
        { action: "repair", fields: { path: "notes/a.md", note: invented } },
      ],
    });

    await loop.start(await loop.createTask(), "Save it");

    expect(ran).toEqual([]);
    expect(audit.entries.map((entry) => entry.cause)).toContain(
      "not-in-evidence",
    );
  });

  it("takes no key the model did not write into a value it fills", async () => {
    const { loop, ran, audit } = repairLoop({
      schema: noteSchema,
      refuse: (args) =>
        args["labels"] !== undefined && typeof args["labels"] !== "object"
          ? "Labels are a set of names and values."
          : undefined,
      call: { path: "notes/a.md", note: "Pay rent", labels: "urgent" },
      said: "Saving it, labelled urgent.",
      answers: [
        { action: "repair", fields: { labels: { "Invented key": "urgent" } } },
      ],
    });

    await loop.start(await loop.createTask(), "Save it");

    expect(ran).toEqual([]);
    expect(audit.entries[0]).toMatchObject({ cause: "not-in-evidence" });
  });

  it("keeps every piece of text the model wrote in a value it re-shapes, joined as lines", async () => {
    const call = { path: "notes/a.md", note: ["# Title", "Body line two"] };
    const refuse = (args: Record<string, unknown>) =>
      typeof args["note"] !== "string" ? "The note must be text." : undefined;
    const dropped = repairLoop({
      schema: noteSchema,
      refuse,
      call,
      said: "Saving the note.",
      answers: [{ action: "repair", fields: { note: "# Title" } }],
    });
    const joined = repairLoop({
      schema: noteSchema,
      refuse,
      call,
      said: "Saving the note.",
      answers: [
        { action: "repair", fields: { note: "# Title\nBody line two" } },
      ],
    });

    await dropped.loop.start(await dropped.loop.createTask(), "Save it");
    await joined.loop.start(await joined.loop.createTask(), "Save it");

    expect(dropped.ran).toEqual([]);
    expect(dropped.audit.entries[0]).toMatchObject({ cause: "text-dropped" });
    expect(joined.ran).toEqual([
      { path: "notes/a.md", note: "# Title\nBody line two" },
    ]);
  });

  it("removes nothing the refusal and the schema were not about", async () => {
    const { loop, ran, audit } = repairLoop({
      schema: noteSchema,
      refuse: (args) =>
        typeof args["note"] !== "string" ? "The note must be text." : undefined,
      call: { path: "notes/a.md", note: 7, labels: { kind: "bill" } },
      said: "Saving note 7.",
      answers: [
        { action: "repair", fields: { note: "7" }, remove: ["labels"] },
      ],
    });

    await loop.start(await loop.createTask(), "Save it");

    expect(ran).toEqual([]);
    expect(audit.entries[0]).toMatchObject({ cause: "content-changed" });
  });
});

describe("a call a repair changed where only the schema found fault", () => {
  it("is asked for, though a grant for the conversation covers the folder", async () => {
    const root = await folders.make("zhiyin-repair-grant-");
    await mkdir(join(root, "reports"));
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const calls: Record<string, unknown>[] = [
      { path: "reports/a.md", content: "First" },
      { path: "reports/b.md", content: ["# Title", "Body line two"] },
      { path: "reports/c.md", content: "Third", encoding: "utf8" },
    ];
    let sent = 0;
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      guidanceModel: {
        send: async function* (request: ModelRequest) {
          const text = request.messages.map((m) => m.content).join("\n");
          if (text.includes("A tool refused this call"))
            yield {
              kind: "textDelta" as const,
              text: JSON.stringify(
                text.includes("“encoding” is not one of its fields")
                  ? { action: "repair", remove: ["encoding"] }
                  : {
                      action: "repair",
                      fields: { content: "# Title\nBody line two" },
                    },
              ),
            };
          yield { kind: "done" as const };
        },
      },
      model: {
        ...deps.model,
        send: async function* () {
          const index = sent++;
          const call = index % 2 === 0 ? calls[index / 2] : undefined;
          if (call)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `write-${index}`,
              name: "write_file",
              argumentsDelta: JSON.stringify(call),
            };
          else yield { kind: "textDelta" as const, text: "Done." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await loop.createTask();
    const phase = () => loop.snapshot().tasks[0]?.phase;

    const firstTurn = loop.start(taskId, "Write the first report");
    await until(() => phase()?.kind === "approval");
    const first = phase();
    if (first?.kind !== "approval") throw new Error("Not asked");
    await loop.resolveApproval(taskId, first.prompt.id, "allow-conversation");
    await firstTurn;

    for (const target of ["reports/b.md", "reports/c.md"]) {
      const turn = loop.start(taskId, "Write the next report");
      await until(() => phase()?.kind === "approval");
      const asked = phase();
      if (asked?.kind !== "approval") throw new Error(`Not asked: ${target}`);
      expect(asked.prompt.target).toBe(target);
      expect(asked.prompt.conversationRule).toBeUndefined();
      await loop.resolveApproval(taskId, asked.prompt.id, "allow");
      await turn;
    }

    expect(await readFile(join(root, "reports", "b.md"), "utf8")).toBe(
      "# Title\nBody line two",
    );
    expect(await readFile(join(root, "reports", "c.md"), "utf8")).toBe("Third");
  });
});
