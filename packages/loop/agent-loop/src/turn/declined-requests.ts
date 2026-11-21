/**
 * Requests for more that the person declined, in a row, within one turn
 * (ADR 0029). Three end the turn, saying why: a model asked again and again
 * is pressing the person, not working.
 */

/** Declined requests in a row that end the turn. */
const declinedToStop = 3;

/** The tool that asks for more. */
const requestTool = "request_access";

export class DeclinedRequests {
  #inARow = 0;

  /** One call's outcome: a request declined counts, one allowed starts again. */
  observe(
    tool: string,
    outcome: {
      readonly result: { readonly ok: boolean };
      readonly denied?: boolean;
    },
  ): void {
    if (tool !== requestTool) return;
    if (outcome.denied) this.#inARow += 1;
    else if (outcome.result.ok) this.#inARow = 0;
  }

  /** Why the turn ends, once the person declined three requests in a row. */
  stops(): string | undefined {
    return this.#inARow >= declinedToStop
      ? `You declined ${this.#inARow} requests in a row for commands to reach more, so the turn stopped. Say what to do instead, and ask again.`
      : undefined;
  }
}
