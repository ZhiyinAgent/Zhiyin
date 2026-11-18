/**
 * Memory's `remember` and `recall`, as a tool of the loop's own for one run:
 * answered only by the names that run was offered, and written as that run's.
 */

import type { MemoryChange, ToolSpec } from "@zhiyin/contract";
import type { LoopTool } from "../round/loop-tool.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import type { ConversationMemory } from "./conversation-memory.js";

/** Whose a write is: a look back's lands outside any turn, a specialist's carries its run. */
export type MemoryWriter = {
  readonly outsideTurn: boolean;
  readonly specialistRunId?: string;
};

export class MemoryCalls implements LoopTool {
  readonly #memory: ConversationMemory;
  readonly #taskId: string;
  readonly #offered: readonly ToolSpec[];
  readonly #writer: MemoryWriter;
  readonly #heard: (
    call: AssembledToolCall,
    change: MemoryChange | undefined,
  ) => void;

  constructor(
    memory: ConversationMemory,
    run: {
      readonly taskId: string;
      readonly offered: readonly ToolSpec[];
      readonly writer: MemoryWriter;
      /** Told what each call changed, nothing when it changed nothing. */
      readonly heard?: (
        call: AssembledToolCall,
        change: MemoryChange | undefined,
      ) => void;
    },
  ) {
    this.#memory = memory;
    this.#taskId = run.taskId;
    this.#offered = run.offered;
    this.#writer = run.writer;
    this.#heard = run.heard ?? (() => {});
  }

  specs(): readonly ToolSpec[] {
    return this.#offered;
  }

  /** Only as offered: one not offered is refused as any tool not on offer is. */
  answers(name: string): boolean {
    return (
      this.#memory.answers(name) &&
      this.#offered.some((tool) => tool.name === name)
    );
  }

  async answer(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const { answer, change } = await this.#memory.answer(
      this.#taskId,
      call,
      input,
      this.#writer,
    );
    this.#heard(call, change);
    return answer;
  }
}
