/**
 * What a part of a turn does at the turn's own moments, so the turn runs its
 * rounds without knowing what any part keeps: the plan, the person's standing
 * instructions and memory each say what is due when, and the turn asks each
 * in the order it lists them.
 */

import type { ToolSpec } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import type { ModelHistory } from "../context/model-history.js";
import type { AssembledToolCall } from "./turn-shared.js";

/** What a part finds open as a turn ends: its notice's kind, and what to say. */
export type OpenAtEnd = {
  readonly kind: "plan" | "verify";
  readonly text: string;
};

export interface TurnHooks {
  /** Before each request: what is due goes into the history. */
  beforeRequest?(history: ModelHistory): Promise<void>;
  /**
   * A round of work ended, with the calls the model made in it; one of
   * nothing but quiet corrections is not one.
   */
  afterRound?(
    history: ModelHistory,
    round: { readonly calls: readonly AssembledToolCall[] },
  ): Promise<void>;
  /**
   * Once a round's calls are answered: whether its words end the turn, its
   * results going with the next request. Asked after every answered round.
   */
  endsTurn?(round: {
    readonly text: string;
    readonly calls: readonly AssembledToolCall[];
  }): boolean;
  /**
   * Before a turn that called nothing ends on its answer: what this part
   * still finds open, said once a turn. The turn joins what every part says
   * into one notice.
   */
  openAtEnd?(): OpenAtEnd | undefined;
  /**
   * Before a turn that called nothing ends on its answer, once nothing was
   * open: whether the model was just told something that should keep it
   * going.
   */
  beforeFinishing?(history: ModelHistory): Promise<boolean>;
  /**
   * The turn's work so far is done with: the turn ended, or what it did is
   * about to be condensed. `request` is the start its requests repeat and
   * the tools they offer.
   */
  doneWith?(how: {
    readonly incomplete: boolean;
    readonly reportOnly: boolean;
    readonly request: {
      readonly fixed: readonly ModelMessage[];
      readonly tools: readonly ToolSpec[];
      /** The tools loaded beside a request of these history messages, where they are. */
      readonly loads?: (
        history: readonly ModelMessage[],
      ) => ModelRequest["loads"];
    };
  }): void;
}
