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

  /** Takes this tool's dead ends back out of what the model is being sent. */
  forget(toolName: string, messages: ModelMessage[]): void {
    const doomed = new Set(
      this.#failures
        .filter((failure) => failure.toolName === toolName)
        .map((failure) => failure.callId),
    );
    if (!doomed.size) return;
    this.#failures = this.#failures.filter(
      (failure) => failure.toolName !== toolName,
    );
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      if (message.role === "tool") {
        if (doomed.has(message.toolCallId)) messages.splice(index, 1);
        continue;
      }
      if (message.role !== "assistant" || !message.toolCalls?.length) continue;
      const kept = message.toolCalls.filter((item) => !doomed.has(item.id));
      if (kept.length === message.toolCalls.length) continue;
      // An assistant turn that held nothing but withdrawn calls has nothing
      // left to say; one that also spoke keeps its words.
      if (!kept.length && !message.content.trim()) messages.splice(index, 1);
      else messages[index] = { ...message, toolCalls: kept };
    }
  }
}
