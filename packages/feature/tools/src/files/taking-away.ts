/**
 * What a deletion or a move may never take from where it is: a folder that
 * holds the workspace, Zhiyin's own folders or one holding them, and a folder
 * that holds the person's user folder, which is nearly everything on the PC.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import { holds } from "@zhiyin/workspace-containment";

/**
 * Why `canonical`, a real path, is not taken away, worded for the tool that
 * would `take` it, or nothing when it may be.
 */
export function keptInPlace(
  canonical: string,
  {
    realRoot,
    protect,
    folder,
    take,
  }: {
    readonly realRoot: string;
    readonly protect: readonly string[];
    readonly folder: boolean;
    readonly take: "deleted" | "moved";
  },
): string | undefined {
  if (holds(canonical, realRoot))
    return `${canonical} holds the workspace, which is not ${take} from here.`;
  if (protect.some((own) => holds(own, canonical) || holds(canonical, own)))
    return `${canonical} is or holds a folder Zhiyin keeps for itself, which is never ${take}.`;
  if (folder && holds(canonical, resolve(homedir())))
    return `${canonical} holds nearly everything on this PC, so it is not ${take} from here.`;
  return undefined;
}
