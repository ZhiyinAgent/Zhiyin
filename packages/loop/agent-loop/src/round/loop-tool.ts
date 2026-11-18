/**
 * A tool the loop answers itself rather than handing to a feature: the plan,
 * memory, delegating to a specialist, the catalog. Each run lists the ones it
 * offers; answering a round hands each call one of them answers to it, once
 * the call's input is read, and every other call to the tools.
 */

import type { ToolSpec } from "@zhiyin/contract";
import { harnessNotice, toolOutput, type NoticeKind } from "../turn/notices.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";

/**
 * An answer in a voice of its own, rather than a result fenced as JSON: a
 * notice when Zhiyin speaks (a skill or a toolkit opened, ADR 0016), or a
 * text fenced as what a tool returned.
 */
export class Spoken {
  readonly #kind: NoticeKind | undefined;
  readonly #text: string;

  private constructor(kind: NoticeKind | undefined, text: string) {
    this.#kind = kind;
    this.#text = text;
  }

  /** Zhiyin speaking, as a notice of this kind. */
  static notice(kind: NoticeKind, text: string): Spoken {
    return new Spoken(kind, text);
  }

  /** Data, fenced as what the tool returned. */
  static output(text: string): Spoken {
    return new Spoken(undefined, text);
  }

  /** What the model is sent, with a note of the loop's own after the text. */
  content(tool: string, note?: string): string {
    const text = note ? `${this.#text}\n\n${note}` : this.#text;
    return this.#kind
      ? harnessNotice(this.#kind, text)
      : toolOutput(tool, text);
  }
}

export type LoopAnswer = Readonly<Record<string, unknown>> | Spoken;

export interface LoopTool {
  /** The tools it offers now, as their own specs. */
  specs(): readonly ToolSpec[];
  /** Whether it answers a call by this name. */
  answers(name: string): boolean;
  /** Answers a call, given the input it was read as: what the model is told. */
  answer(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer>;
  /** The specialist run a call it answered started, if it started one. */
  startedRun?(callId: string): string | undefined;
}
