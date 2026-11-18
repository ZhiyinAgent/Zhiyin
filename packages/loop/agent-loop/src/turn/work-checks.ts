/**
 * Whether the files a turn changed were checked before it ends.
 *
 * A change is checked once a call after it ran, compiled or previewed the
 * work, or a reading call named the file; a change whose own answer showed
 * the lines written, or measured what was built, is checked by that answer.
 * A turn about to end with a change nothing checked is told once, naming the
 * files, and may then end as it was.
 */

import type { ToolSpec } from "@zhiyin/contract";
import type { ToolCallOutcome } from "../tools/tool-calls.js";
import type { OpenAtEnd, TurnHooks } from "./turn-hooks.js";

/** Files a notice names; the rest are counted. */
const namedFiles = 5;

/** A path as it is compared: forward slashes, without a leading `./`, any case. */
const comparable = (path: string) =>
  path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

export class WorkChecks implements TurnHooks {
  readonly #specOf: (name: string) => ToolSpec | undefined;
  /** Workspace paths changed and not checked since, in the order changed. */
  readonly #unchecked = new Set<string>();
  #told = false;

  constructor(specOf: (name: string) => ToolSpec | undefined) {
    this.#specOf = specOf;
  }

  /** One call's outcome; a failure or a quiet correction changes nothing here. */
  observe(name: string, input: unknown, outcome: ToolCallOutcome): void {
    const { result } = outcome;
    if (outcome.quiet || !result.ok) return;
    const spec = this.#specOf(name);
    const checks =
      spec?.checksWork ?? (spec?.reportsState ? "runs" : undefined);
    if (checks === "runs") {
      this.#unchecked.clear();
      return;
    }
    if (spec?.access === "read") {
      const named = comparable(
        JSON.stringify(input ?? {}).replace(/\\\\/g, "/"),
      );
      for (const path of this.#unchecked)
        if (named.includes(comparable(path))) this.#unchecked.delete(path);
    }
    for (const file of result.produced ?? []) {
      this.#unchecked.delete(file.path);
      if (checks !== "shows") this.#unchecked.add(file.path);
    }
  }

  openAtEnd(): OpenAtEnd | undefined {
    if (this.#told || !this.#unchecked.size) return undefined;
    this.#told = true;
    const paths = [...this.#unchecked];
    const named = paths.slice(0, namedFiles).join(", ");
    const more = paths.length - namedFiles;
    return {
      kind: "verify",
      text: [
        `Nothing has run, compiled, previewed or read back ${paths.length === 1 ? "this file" : "these files"} since you changed ${paths.length === 1 ? "it" : "them"}: ${named}${more > 0 ? ` and ${more} more` : ""}.`,
        `Check ${paths.length === 1 ? "it" : "them"} the way that fits each: run its tests or the program, compile the document, preview the page, or read back what you wrote. If ${paths.length === 1 ? "it needs" : "they need"} no check, end here without repeating your answer.`,
      ].join("\n"),
    };
  }
}
