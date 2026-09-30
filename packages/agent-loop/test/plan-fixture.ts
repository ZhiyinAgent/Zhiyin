/**
 * A turn with a working model that follows a script and an auxiliary model
 * that names the conversation and labels actions. Shared by the tests of the
 * plan the working model keeps, the calls that describe themselves, and the
 * loop guard.
 */

import type { ToolCallInspection, WorkspaceTask } from "@zhiyin/contract";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
} from "@zhiyin/model-client";
import type { WorkLimits } from "../src/turn/work-limits.js";
import { loopFrom, stubDependencies, type TurnTestApp } from "./support.js";

export const LABEL = "Write the interface title and description";

export type Call = {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly id?: string;
};

/** What the working model does in one request. */
export type Step =
  { readonly calls: readonly Call[] } | { readonly text: string };

export type Fixture = {
  readonly loop: TurnTestApp;
  /** Every request the working model was sent, in order. */
  readonly requests: ModelRequest[];
  /** Which model was asked what, in order: work, label or other. */
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
  /** Hold every labelling answer until the test lets it go. */
  readonly holdLabels?: boolean;
  readonly label?: { readonly title: string; readonly description: string };
  /** File contents `read_file` answers with, by path. */
  readonly files?: Readonly<Record<string, string>>;
  /** What `list_directory` answers for a path, when not the default. */
  readonly listing?: (path: string) => string;
  readonly savesSlowly?: boolean;
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
      if (prompt.includes(LABEL)) {
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
      } else {
        log.push("other");
        yield { kind: "textDelta", text: '{"title":"Report summary"}' };
      }
      yield { kind: "done" };
    },
  };
  const inspect = async (
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection> => {
    inspected.push(args);
    const path = (args as { path?: string }).path ?? "workspace root";
    if (name === "read_file")
      return {
        ok: true,
        action: "Read a workspace file",
        target: path,
        command: `read_file(${JSON.stringify(args)})`,
        access: "read",
        scope: "workspace",
      };
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
    ...(options.savesSlowly ? { savesSlowly: true } : {}),
    ...(options.workLimits ? { workLimits: options.workLimits } : {}),
    guidanceModel: auxiliary,
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
        {
          name: "read_file",
          description: "Read a file.",
          inputSchema: objectSchema,
        },
      ],
      inspect,
      execute: async (name: string, args: unknown) => {
        const path = (args as { path?: string }).path ?? "the root";
        if (name === "read_file") {
          const text = options.files?.[path];
          return text === undefined
            ? { ok: false as const, reason: `${path} does not exist.` }
            : { ok: true as const, value: text };
        }
        return {
          ok: true as const,
          value:
            name === "write_note"
              ? "Written."
              : (options.listing?.(path) ?? `Listed ${path}: q1.pdf, q2.pdf`),
        };
      },
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
  return {
    loop,
    requests,
    log,
    inspected,
    labels,
    release,
  };
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
