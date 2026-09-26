/**
 * A turn with a plan, a working model that follows a script, and the two
 * auxiliary models answering by what they were asked. Shared by the tests of
 * the plan the working model sees, the calls that describe themselves, and the
 * loop guard.
 */

import type { ToolCallInspection, WorkspaceTask } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import type { WorkLimits } from "../src/work-limits.js";
import { loopFrom, stubDependencies, type TurnTestApp } from "./support.js";

export const PLAN = "Create an ordered plan for this task.";
export const LABEL = "Write the interface title and description";
export const JUDGE = "Decide whether this single criterion is satisfied";

export type Call = {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly id?: string;
};

/** What the working model does in one request. */
export type Step =
  { readonly calls: readonly Call[] } | { readonly text: string };

export const twoItems = {
  items: [
    {
      title: "List the reports",
      criterion: "The reports folder was listed and its files named.",
    },
    {
      title: "Write the summary",
      criterion: "summary.md exists and names every report.",
    },
  ],
};

export type Fixture = {
  readonly loop: TurnTestApp;
  /** Every request the working model was sent, in order. */
  readonly requests: ModelRequest[];
  /** Which model was asked what, in order: work, plan, label or judge. */
  readonly log: string[];
  /** The arguments each tool was inspected with. */
  readonly inspected: unknown[];
  /** What each labelling call was asked. */
  readonly labels: string[];
  /** Settles the labelling calls that were held back, in order. */
  readonly release: (() => void)[];
};

export function withPlan(options: {
  readonly script: (request: number, sent: ModelRequest) => Step;
  readonly plan?: unknown;
  /** Hold every labelling answer until the test lets it go. */
  readonly holdLabels?: boolean;
  readonly label?: { readonly title: string; readonly description: string };
  readonly judge?: (prompt: string) => unknown;
  readonly workLimits?: WorkLimits;
  readonly restore?: readonly WorkspaceTask[];
}): Fixture {
  const requests: ModelRequest[] = [];
  const log: string[] = [];
  const inspected: unknown[] = [];
  const release: (() => void)[] = [];
  const labels: string[] = [];
  const base = stubDependencies(() => {});
  const auxiliary = {
    send: async function* (request: ModelRequest): AsyncGenerator<ModelEvent> {
      const prompt = String(request.messages.at(-1)?.content ?? "");
      if (prompt.includes(PLAN)) {
        log.push("plan");
        yield {
          kind: "textDelta",
          text: JSON.stringify(options.plan ?? twoItems),
        };
      } else if (prompt.includes(LABEL)) {
        log.push("label");
        labels.push(prompt);
        if (options.holdLabels)
          await new Promise<void>((resolve) => release.push(resolve));
        yield {
          kind: "textDelta",
          text: JSON.stringify(
            options.label ?? {
              title: "Generated title",
              description: "Generated description.",
            },
          ),
        };
      } else if (prompt.includes(JUDGE)) {
        log.push("judge");
        yield {
          kind: "textDelta",
          text: JSON.stringify(
            options.judge?.(prompt) ?? {
              satisfied: false,
              summary: "Not yet.",
            },
          ),
        };
      } else log.push("other");
      yield { kind: "done" };
    },
  };
  const inspect = async (
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection> => {
    inspected.push(args);
    const path = (args as { path?: string }).path ?? "workspace root";
    return name === "write_note"
      ? {
          ok: true,
          action: "Write a workspace file",
          target: path,
          command: `write_note(${JSON.stringify(args)})`,
          access: "change",
          scope: "workspace",
        }
      : {
          ok: true,
          action: "List a workspace directory",
          target: path,
          command: `list_directory(${JSON.stringify(args)})`,
          access: "read",
          scope: "workspace",
        };
  };
  const objectSchema = {
    type: "object",
    properties: { path: { type: "string" } },
    additionalProperties: false,
  };
  const loop = loopFrom({
    ...base,
    ...(options.workLimits ? { workLimits: options.workLimits } : {}),
    guidanceModel: auxiliary,
    judgementModel: auxiliary,
    tools: {
      list: () => [
        {
          name: "list_directory",
          description: "List a folder.",
          inputSchema: objectSchema,
        },
        {
          name: "write_note",
          description: "Write a note.",
          inputSchema: objectSchema,
        },
      ],
      inspect,
      execute: async (name: string, args: unknown) => ({
        ok: true as const,
        value:
          name === "write_note"
            ? "Written."
            : `Listed ${(args as { path?: string }).path ?? "the root"}: q1.pdf, q2.pdf`,
      }),
    } as never,
    permissions: {
      decide: async (request: { readonly name: string }) =>
        request.name === "write_note"
          ? { outcome: "ask" as const, reason: "Changes a file." }
          : { outcome: "allow" as const, reason: "Reads only." },
    } as never,
    model: {
      ...base.model,
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        requests.push(request);
        log.push("work");
        const step = options.script(requests.length, request);
        if ("text" in step) yield { kind: "textDelta", text: step.text };
        else
          for (const [index, call] of step.calls.entries())
            yield {
              kind: "toolCallDelta",
              index,
              callId: call.id ?? `call-${requests.length}-${index}`,
              name: call.name,
              argumentsDelta: JSON.stringify(call.args),
            };
        yield { kind: "done" };
      },
    },
  });
  if (options.restore) loop.restore(options.restore);
  return { loop, requests, log, inspected, labels, release };
}

/** The notices of one kind a request carries. */
export function notices(request: ModelRequest | undefined, kind: string) {
  return (request?.messages ?? []).filter(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith(`<zhiyin-notice kind="${kind}">`),
  ) as (ModelMessage & { readonly content: string })[];
}

/** What a request says a call returned, read back as JSON. */
export function resultOf(
  request: ModelRequest | undefined,
  callId: string,
): Record<string, unknown> {
  const message = request?.messages.find(
    (item) => item.role === "tool" && item.toolCallId === callId,
  );
  if (!message) throw new Error(`No result for ${callId}.`);
  const inside = /^<tool-output [^>]*>([\s\S]*)<\/tool-output>$/.exec(
    String(message.content),
  )?.[1];
  return JSON.parse(inside ?? "null") as Record<string, unknown>;
}

export async function until(
  predicate: () => boolean,
  attempts = 500,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached.");
}
