/**
 * The proposals a tool refused quietly, and what the model is left holding.
 *
 * A proposal a tool refused as model-correctable — text that did not match, a
 * path that does not exist — is not work the person asked for and not a
 * decision they can help with. It is returned to the model and to nowhere else,
 * a bounded number of times per tool.
 *
 * Once the same tool succeeds, the failed attempts are removed from the request
 * as well, so the model stops carrying its own dead ends around and re-reading
 * them as though they still described the workspace.
 */

import type { ModelMessage } from "@zhiyin/model-client";

export class QuietFailures {
  readonly #attempts = new Map<string, number>();
  #failures: { readonly toolName: string; readonly callId: string }[] = [];

  /** How many quiet corrections this tool has already taken this turn. */
  attempts(toolName: string): number {
    return this.#attempts.get(toolName) ?? 0;
  }

  remember(toolName: string, callId: string): void {
    this.#attempts.set(toolName, this.attempts(toolName) + 1);
    this.#failures.push({ toolName, callId });
  }

  /** This tool's dead ends, to be taken back out of what the model is sent. */
  take(toolName: string): ReadonlySet<string> {
    const doomed = new Set(
      this.#failures
        .filter((failure) => failure.toolName === toolName)
        .map((failure) => failure.callId),
    );
    this.#failures = this.#failures.filter(
      (failure) => failure.toolName !== toolName,
    );
    return doomed;
  }
}

/**
 * Takes the withdrawn calls, and the answers to them, out of a request. Words
 * said alongside withdrawn calls are kept; a message that was nothing but
 * withdrawn calls has nothing left to say.
 */
export function withdrawCalls<Item>(
  items: Item[],
  callIds: ReadonlySet<string>,
  messageOf: (item: Item) => ModelMessage,
  replaced: (item: Item, message: ModelMessage) => Item,
): void {
  if (!callIds.size) return;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    const message = messageOf(item);
    if (message.role === "tool") {
      if (callIds.has(message.toolCallId)) items.splice(index, 1);
      continue;
    }
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const kept = message.toolCalls.filter((call) => !callIds.has(call.id));
    if (kept.length === message.toolCalls.length) continue;
    if (!kept.length && !message.content.trim()) items.splice(index, 1);
    else items[index] = replaced(item, { ...message, toolCalls: kept });
  }
}
