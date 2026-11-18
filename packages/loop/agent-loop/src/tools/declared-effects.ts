/**
 * What the agent loop reads from a call's effects, the one description of
 * what it does (ADR 0012): whether it may leave anything behind, whether it
 * is known to change nothing, and whether it changes files.
 */

import type {
  ActionEffects,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";
import { whoseWord } from "@zhiyin/trust-rules";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

/**
 * Whether what an action declared it does may leave something behind: a
 * change, a send, acting as someone, or something that runs later.
 */
export function mayTakeEffect(effects: ActionEffects): boolean {
  return (
    effects.changes !== "none" ||
    effects.sends !== "none" ||
    effects.actsAsPerson !== "none" ||
    effects.lasting
  );
}

/**
 * Whether a call is known to change nothing: its effects say so, declared by
 * code whose word counts for it, a built-in tool's, a connection's Zhiyin
 * ships, or a plugin's or skill's read of what it holds. A connector's
 * read-only annotation does not count, because the server describes itself;
 * a call that declares no effects may have changed anything.
 */
export function changesNothing(
  owner: ToolOwner,
  inspection: Inspection,
): boolean {
  const word = whoseWord(owner, inspection);
  return (
    (word === "zhiyin" || word === "reads") &&
    inspection.effects !== undefined &&
    !mayTakeEffect(inspection.effects)
  );
}

/**
 * Whether a call changes files, in the workspace or outside it, by its
 * effects: what a turn counts as progress once it succeeds.
 */
export function changesFiles(inspection: Inspection): boolean {
  const changes = inspection.effects?.changes;
  return (
    changes === "workspace" ||
    changes === "workspace-for-good" ||
    changes === "elsewhere"
  );
}
