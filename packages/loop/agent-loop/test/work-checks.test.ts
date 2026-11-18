/**
 * A turn about to end with a file it changed and never checked is told so
 * once: nothing ran, compiled or previewed after the change, no answer showed
 * it, and nothing read it back. A checked change, or a turn that changed
 * nothing, ends without a word.
 */

import { describe, expect, it } from "vitest";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { loopFrom, stubDependencies } from "./support.js";

type Call = { readonly name: string; readonly args: Record<string, unknown> };

const object = { type: "object", additionalProperties: true };

const tools: readonly ToolSpec[] = [
  { name: "write_file", description: "Write a file.", inputSchema: object },
  {
    name: "edit_lines",
    description: "Edit a file and show the lines written.",
    inputSchema: object,
    checksWork: "shows",
  },
  {
    name: "read_file",
    description: "Read a file.",
    inputSchema: object,
    access: "read",
  },
  {
    name: "list_directory",
    description: "List a folder.",
    inputSchema: object,
    access: "read",
  },
  {
    name: "run_tests",
    description: "Run the tests.",
    inputSchema: object,
    checksWork: "runs",
  },
  {
    name: "build_part",
    description: "Build a part and measure it.",
    inputSchema: object,
    reportsState: true,
  },
];

function results(name: string, args: Record<string, unknown>) {
  const path = String(args["path"] ?? "");
  const writes = name === "write_file" || name === "edit_lines";
  const result: ToolInvocationResult = {
    ok: true,
    value: writes ? { path, bytes: 5 } : "Done.",
    ...(writes || name === "build_part"
      ? {
          produced: [
            {
              path: path || "part.step",
              change: "updated" as const,
              bytes: 5,
            },
          ],
        }
      : {}),
  };
  return result;
}

/** A turn whose model makes these rounds of calls, then answers each time. */
function turnOf(rounds: readonly (readonly Call[] | null)[]) {
  const requests: ModelRequest[] = [];
  const base = stubDependencies(() => {});
  const loop = loopFrom({
    ...base,
    tools: {
      list: () => tools,
      inspect: async (name: string): Promise<ToolCallInspection> => ({
        ok: true,
        action: name,
        target: name,
        command: name,
      }),
      execute: async (name: string, args: unknown) =>
        results(name, args as Record<string, unknown>),
    } as never,
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed" }),
    } as never,
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        requests.push(request);
        const calls = rounds[requests.length - 1];
        if (calls)
          for (const [index, call] of calls.entries())
            yield {
              kind: "toolCallDelta" as const,
              index,
              callId: `call-${requests.length}-${index}`,
              name: call.name,
              argumentsDelta: JSON.stringify(call.args),
            };
        else yield { kind: "textDelta" as const, text: "Done." };
        yield { kind: "done" as const };
      },
    },
  });
  return { loop, requests };
}

function verifyNotices(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith('<zhiyin-notice kind="verify">')
      ? [message.content]
      : [],
  );
}

async function run(rounds: readonly (readonly Call[] | null)[]) {
  const turn = turnOf(rounds);
  const taskId = await turn.loop.createTask();
  await turn.loop.start(taskId, "Make it");
  return turn.requests;
}

const write = (path: string): Call => ({ name: "write_file", args: { path } });

describe("a turn that would end with unchecked work", () => {
  it("is told once which files nothing ran, previewed or read back, and may then end", async () => {
    const requests = await run([[write("app/main.py")], [write("README.md")]]);

    // Two rounds of writes, the answer, the notice's request: four.
    expect(requests).toHaveLength(4);
    expect(verifyNotices(requests[3])).toEqual([
      [
        '<zhiyin-notice kind="verify">Your answer above is already shown to the person. Nothing has run, compiled, previewed or read back these files since you changed them: app/main.py, README.md.',
        "Check them the way that fits each: run its tests or the program, compile the document, preview the page, or read back what you wrote. If they need no check, end here without repeating your answer.</zhiyin-notice>",
      ].join("\n"),
    ]);
  });

  it("says nothing once something ran after the change", async () => {
    const requests = await run([
      [write("app/main.py")],
      [{ name: "run_tests", args: {} }],
    ]);

    expect(requests).toHaveLength(3);
    expect(verifyNotices(requests.at(-1))).toEqual([]);
  });

  it("says nothing of a file read back after it was written, and names the one that was not", async () => {
    const requests = await run([
      [write("notes/a.md"), write("notes/b.md")],
      [{ name: "read_file", args: { path: "notes\\a.md" } }],
    ]);

    const [notice] = verifyNotices(requests.at(-1));
    expect(notice).toContain("this file since you changed it: notes/b.md.");
    expect(notice).not.toContain("notes/a.md");
  });

  it("does not count a read that names another file", async () => {
    const requests = await run([
      [write("notes/a.md")],
      [{ name: "list_directory", args: { path: "notes" } }],
    ]);

    expect(verifyNotices(requests.at(-1))[0]).toContain(
      "since you changed it: notes/a.md.",
    );
  });

  it("counts an answer that showed the lines it wrote, and a tool whose answer measures what it built", async () => {
    const requests = await run([
      [{ name: "edit_lines", args: { path: "notes/a.md" } }],
      [{ name: "build_part", args: {} }],
    ]);

    expect(requests).toHaveLength(3);
    expect(verifyNotices(requests.at(-1))).toEqual([]);
  });

  it("names a change made after the last check", async () => {
    const requests = await run([
      [write("app/main.py")],
      [{ name: "run_tests", args: {} }],
      [write("app/util.py")],
    ]);

    expect(verifyNotices(requests.at(-1))[0]).toContain(
      "since you changed it: app/util.py.",
    );
  });

  it("says nothing in a turn that changed nothing", async () => {
    const requests = await run([
      [{ name: "read_file", args: { path: "a.md" } }],
    ]);

    expect(requests).toHaveLength(2);
  });

  it("is not told again in the same turn once told", async () => {
    // Request 2 answers and is told; request 3 writes again; request 4 ends.
    const requests = await run([[write("a.py")], null, [write("b.py")]]);

    expect(requests).toHaveLength(4);
    expect(verifyNotices(requests[3])).toHaveLength(1);
  });

  it("is told of open plan items in the same notice, so the answer is sent back once", async () => {
    const requests = await run([
      [
        {
          name: "update_plan",
          args: {
            items: [
              { title: "Write the app", status: "done" },
              { title: "Write the docs", status: "in_progress" },
            ],
          },
        },
        write("app/main.py"),
      ],
    ]);

    // The round of calls, the answer, then one request after one notice.
    expect(requests).toHaveLength(3);
    const notices = (requests[2]?.messages ?? []).flatMap((message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith("<zhiyin-notice")
        ? [message.content]
        : [],
    );
    expect(notices.at(-1)).toBe(
      [
        '<zhiyin-notice kind="finish">Your answer above is already shown to the person. These plan items are still open:',
        "- Write the docs (in progress)",
        "If they are finished, mark each done or skipped with update_plan and end there, without repeating your answer. If work remains, finish it, then say only what changed.",
        "Nothing has run, compiled, previewed or read back this file since you changed it: app/main.py.",
        "Check it the way that fits each: run its tests or the program, compile the document, preview the page, or read back what you wrote. If it needs no check, end here without repeating your answer.</zhiyin-notice>",
      ].join("\n"),
    );
  });
});
