/**
 * Where answering a round writes what the model said and was answered: the
 * conversation's history, which a turn keeps with the conversation and a
 * specialist in memory, with its run.
 */

import type { ModelToolCall } from "@zhiyin/model-client";
import type { ModelReplay } from "@zhiyin/contract";

/**
 * What a model's turn keeps beside its words (ADR 0014): its reasoning, and
 * what its provider needs back to continue from it.
 */
export type TurnKept = {
  readonly reasoning?: string;
  readonly replay?: ModelReplay;
  /** The round, as its request's record names it; never sent. */
  readonly roundId?: string;
};

export interface Transcript {
  /**
   * The model's words and calls in one round, with what it kept beside them;
   * `messageId` names the conversation's message its words were shown as.
   */
  round(
    text: string,
    calls: readonly ModelToolCall[],
    messageId?: string,
    kept?: TurnKept,
  ): void;
  /**
   * A call's answer, a quiet correction's included. `runId` names the
   * specialist run a delegation started.
   */
  result(
    call: { readonly callId: string; readonly name: string },
    content: string,
    runId?: string,
  ): Promise<void>;
  /** The arguments that ran, in place of the draft the model wrote. */
  rewriteCall(callId: string, args: string): Promise<void>;
  /**
   * Takes quietly refused calls, and their answers, back out of what is sent
   * and what is kept.
   */
  forget(callIds: ReadonlySet<string>): Promise<void>;
  /** The round's calls are all answered. */
  endRound(): Promise<void>;
}
