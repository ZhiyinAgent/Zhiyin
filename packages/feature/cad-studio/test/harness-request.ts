/**
 * The request a stand-in for the harness reads, as the real one reads it: at
 * once, or, for a measuring run started beside the script's, once Zhiyin has
 * written it.
 */

import { readFile } from "node:fs/promises";
import type { CadRun, CadRunOutcome } from "../src/index.js";

/** The request's path, or nothing when the run was stopped before it was given one. */
export async function requestOf(run: CadRun): Promise<string | undefined> {
  const path = run.arguments.at(-1)!;
  if (!run.arguments.includes("--when-ready")) return path;
  for (;;) {
    if (run.signal?.aborted) return undefined;
    if (
      await readFile(path).then(
        () => true,
        () => false,
      )
    )
      return path;
    await new Promise((wait) => setTimeout(wait, 2));
  }
}

/** A run stopped before it had anything to do. */
export const stoppedUnasked: CadRunOutcome = {
  ok: true,
  run: { exitCode: null, stdout: "", stderr: "", ending: "stopped" },
};
