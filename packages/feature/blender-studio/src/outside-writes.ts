/**
 * Files Blender makes for outside the workspace (ADR 0012). Its confinement is
 * fixed when it starts and reaches only the workspace, so it writes them in a
 * staging folder of the conversation's own, and Zhiyin moves each finished
 * file into the place the person approved by its real path.
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { contentDigest, replaceFile } from "@zhiyin/files";
import {
  holds,
  placeOutside,
  placedAgain,
} from "@zhiyin/workspace-containment";
import type { Written } from "./paths.js";

const changed = "it changed while Blender wrote it, so it was not replaced.";
const appeared =
  "a file appeared there while Blender wrote it, so it was not replaced. Ask again to approve replacing it.";

/** Why a write failed, in words. */
function failure(error: unknown): string {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") return appeared;
  const message = error instanceof Error ? error.message : String(error);
  return message === changed ? changed : `${message}.`;
}

/**
 * Puts a file Blender staged where the approval placed it: a new place only
 * ever created, never written over something that appeared since, and an
 * existing file replaced only while it is what the approval saw. Placed
 * again first, so a place now reached another way is not written. Gives why
 * it was not, or nothing.
 */
export async function placeStaged(
  staged: string,
  file: Written,
  root: string,
  protect: readonly string[],
): Promise<string | undefined> {
  const now = await placedAgain(root, file, protect);
  if (now === "moved") return "where it goes changed since it was approved.";
  if (now === "appeared") return appeared;
  try {
    await mkdir(dirname(file.absolute), { recursive: true });
    await replaceFile(
      file.absolute,
      { copyOf: staged },
      file.exists
        ? {
            check: async () => {
              if ((await contentDigest(file.absolute)) !== file.digest)
                throw new Error(changed);
            },
          }
        : { createOnly: true },
    );
    return undefined;
  } catch (error) {
    return failure(error);
  }
}

export type FolderMove = {
  /** Each file put in the folder, by its real path, and whether it was new. */
  readonly moved: readonly {
    readonly absolute: string;
    readonly created: boolean;
    readonly bytes: number;
  }[];
  /** Each file not put there, by its path in the folder, and why. */
  readonly refused: readonly { readonly path: string; readonly why: string }[];
};

/**
 * Moves what a script made in `staging` into `folder`, an approved folder
 * outside the workspace, keeping the folders it made, and replacing a file
 * there as a write to it would. A file whose place leads out of the folder
 * through a link, or into one of Zhiyin's own folders, is not moved; nor is
 * one whose place `held` says sealed-off programs are held from for the run,
 * as what could not be copied first, Git's folder or a Startup folder are.
 */
export async function moveStagedFolder(
  staging: string,
  folder: string,
  root: string,
  protect: readonly string[],
  held?: (path: string) => Promise<boolean>,
): Promise<FolderMove> {
  const moved: FolderMove["moved"][number][] = [];
  const refused: FolderMove["refused"][number][] = [];
  const entries = await readdir(staging, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const staged = join(entry.parentPath, entry.name);
    const path = relative(staging, staged);
    if (!entry.isFile()) {
      refused.push({ path, why: "it is not a file." });
      continue;
    }
    const placed = await placeOutside(root, join(folder, path), { protect });
    if (
      placed.kind !== "writable" ||
      placed.inside ||
      !holds(folder, placed.absolute)
    ) {
      refused.push({
        path,
        why:
          placed.kind === "protected"
            ? "it would go in a folder Zhiyin keeps for itself."
            : `its place leads out of ${folder}.`,
      });
      continue;
    }
    // Zhiyin moves it with its own access: it goes only where the script,
    // sealed off, could have written it.
    if (await (held?.(placed.absolute) ?? false)) {
      refused.push({ path, why: "it may only be read for this run." });
      continue;
    }
    try {
      await mkdir(dirname(placed.absolute), { recursive: true });
      await replaceFile(placed.absolute, { copyOf: staged });
      const bytes = (await stat(placed.absolute)).size;
      moved.push({ absolute: placed.absolute, created: !placed.exists, bytes });
    } catch (error) {
      refused.push({ path, why: failure(error) });
    }
  }
  return { moved, refused };
}
