/**
 * The check after `remember` (ADR 0026): an entry just written is compared
 * with those kept beside it, and the closest are named to the model, which
 * decides whether two say the same. Nothing is merged without it.
 *
 * Its shape is the agent loop's hook after a call; the composition root
 * registers it there.
 */

import type { EntryLine, Memory } from "./memory.js";

const closeNote =
  "These kept entries are close to the one just written. If one says the same, keep one: change it to hold both, and remove the other.";

export type CloseEntriesCheck = {
  readonly tool: string;
  readonly run: (call: {
    readonly input: unknown;
    readonly answer: unknown;
  }) => Promise<
    | { readonly close: readonly EntryLine[]; readonly closeNote: string }
    | undefined
  >;
};

/** Names the entries close to the one a `remember` call kept, if any are. */
export function closeEntriesCheck(memory: Memory): CloseEntriesCheck {
  return {
    tool: memory.rememberToolFor(false).name,
    run: async ({ answer }) => {
      const number = writtenNumber(answer);
      if (number === undefined) return undefined;
      const close = await memory.similarTo(number);
      return close.length ? { close, closeNote } : undefined;
    },
  };
}

/** The entry a call added or changed, from its answer. */
function writtenNumber(answer: unknown): number | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const { kept, number } = answer as { kept?: unknown; number?: unknown };
  return (kept === "added" || kept === "changed") && typeof number === "number"
    ? number
    : undefined;
}
