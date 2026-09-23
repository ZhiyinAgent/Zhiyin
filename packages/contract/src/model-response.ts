/** Evidence of how one model request ended, and of the attempts before it. */

/** Provider-neutral evidence about how one model request ended. */
export type ModelResponseRecord = {
  readonly requestId?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly finishReason: string | null;
  /** The strongest terminal signal observed on the stream. */
  readonly termination: "sentinel" | "finishReason" | "usage";
  /** Whether the request produced a usable answer or tool call before ending. */
  readonly complete: boolean;
  /** Failed attempts before this response, oldest first. ADR 0049. */
  readonly retries?: readonly ModelRetryRecord[];
};

/** One failed attempt at a model request, and what was done about it. */
export type ModelRetryRecord = {
  /** The failure's code, as the model client reported it. */
  readonly failure: string;
  /** How long the next attempt waited. */
  readonly delayMs: number;
  /**
   * `silent`: nothing had been shown, so the attempt was sent again unseen.
   * `restart`: text had been shown, and was withdrawn when the round began
   * again.
   */
  readonly kind: "silent" | "restart";
  /** How much shown text the restart withdrew, in characters. */
  readonly discardedCharacters?: number;
};
