/**
 * What a call does, as each tool declares it with its inspection (ADR 0012):
 * built from what the call does, every part it does not do declared as none.
 */

import type { ActionEffects, ToolCallInspection } from "@zhiyin/contract";
import { runsLater } from "@zhiyin/workspace-containment";
import { anyDownloaded } from "./mark-of-the-web.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

export function effectsOf(does: Partial<ActionEffects>): ActionEffects {
  return { ...nothing, ...does };
}

/** Where a read reaches, from where its target is. */
export function readsIn(
  scope: "workspace" | "outside",
): ActionEffects["reads"] {
  return scope === "outside" ? "elsewhere" : "workspace";
}

/**
 * The inspection of a call that returns what `paths` hold: outside content
 * when Windows marks any of them as downloaded from the internet.
 */
export async function bringingDownloads(
  inspection: ToolCallInspection,
  paths: readonly string[],
): Promise<ToolCallInspection> {
  if (!inspection.ok || !inspection.effects || !(await anyDownloaded(paths)))
    return inspection;
  return {
    ...inspection,
    effects: { ...inspection.effects, brings: "outside" },
  };
}

/**
 * What changing files does, each named by its real path: in the workspace,
 * backed up before the change (ADR 0013); outside it, elsewhere.
 */
export function changingFiles(
  files: readonly { readonly absolute: string; readonly outside: boolean }[],
): ActionEffects {
  const where = files.some((file) => file.outside) ? "elsewhere" : "workspace";
  return effectsOf({
    reads: where,
    changes: where,
    lasting: files.some((file) => runsLater(file.absolute)),
  });
}
