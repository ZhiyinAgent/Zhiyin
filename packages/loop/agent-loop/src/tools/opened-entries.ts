/**
 * What a conversation has opened of the catalog, read from what it was sent:
 * each skill and toolkit `open` answered as Zhiyin's notice, where its answer
 * stands. Read from the messages themselves, so it holds after a restart and
 * follows a condensing: what the summary replaced is no longer open until
 * Zhiyin opens it again (ADR 0016).
 */

import type { OfferedToolkit } from "@zhiyin/capabilities";
import type { ToolSpec } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { isNotice } from "../turn/notices.js";

export const openToolName = "open";

/** The line before an opened toolkit's schemas, where its tools are reached through `call`. */
const bridgeLine = "Call these through call(name, arguments):";

/** Whether a result is Zhiyin's guidance: a skill or a toolkit opened. */
export function isGuidance(content: string): boolean {
  return isNotice(content, "skill") || isNotice(content, "toolkit");
}

/** The id an `open` call named, or nothing for one that named none. */
function idOf(args: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      typeof parsed.id === "string"
      ? parsed.id.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export type OpenedEntry = {
  readonly id: string;
  readonly kind: "skill" | "toolkit";
  /** Where among the messages its answer is. */
  readonly at: number;
};

/** Every skill and toolkit opened among these messages, first opening first. */
export function openedEntries(
  messages: readonly ModelMessage[],
): readonly OpenedEntry[] {
  const named = new Map<string, string>();
  const opened: OpenedEntry[] = [];
  const seen = new Set<string>();
  for (const [at, message] of messages.entries()) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? [])
        if (call.name === openToolName) {
          const id = idOf(call.arguments);
          if (id) named.set(call.id, id);
        }
      continue;
    }
    if (message.role !== "tool" || message.name !== openToolName) continue;
    const kind = isNotice(message.content, "toolkit")
      ? "toolkit"
      : isNotice(message.content, "skill")
        ? "skill"
        : undefined;
    const id = named.get(message.toolCallId);
    if (!kind || !id || seen.has(id)) continue;
    seen.add(id);
    opened.push({ id, kind, at });
  }
  return opened;
}

export type OpenedToolkit = OfferedToolkit & { readonly at: number };

/** The toolkits on offer that these messages opened, first opening first. */
export function openedToolkits(
  messages: readonly ModelMessage[],
  toolkits: readonly OfferedToolkit[],
): readonly OpenedToolkit[] {
  return openedEntries(messages).flatMap((entry) => {
    const toolkit =
      entry.kind === "toolkit"
        ? toolkits.find((item) => item.id === entry.id)
        : undefined;
    return toolkit ? [{ ...toolkit, at: entry.at }] : [];
  });
}

/**
 * Whether the model was last told of its opened toolkits as reached through
 * `call`; nothing when it was told of none.
 */
export function toldThroughBridge(
  messages: readonly ModelMessage[],
): boolean | undefined {
  const told = messages.findLast(
    (message) =>
      (message.role === "tool" || message.role === "user") &&
      typeof message.content === "string" &&
      isNotice(message.content, "toolkit"),
  );
  return told && typeof told.content === "string"
    ? told.content.includes(bridgeLine)
    : undefined;
}

/** Tools as their schemas are written out for the model to call through `call`. */
export function bridgedSchemas(tools: readonly ToolSpec[]): string {
  return `${bridgeLine}\n${JSON.stringify(
    tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  )}`;
}
