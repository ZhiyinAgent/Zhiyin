/**
 * Which project a folder's conversations belong to (ADR 0026): the project
 * linked to the folder or the nearest folder holding it, and none for a
 * folder where work of every kind passes.
 */

import { parse, resolve } from "node:path";
import type { MemoryProject } from "@zhiyin/contract";
import {
  isBroadFolder,
  projectHolding as holdingProject,
} from "@zhiyin/memory-projects";
import { sameFolder as namesSameFolder } from "@zhiyin/path-comparison";

/** A folder as Windows compares it: whole, without a trailing separator. */
function plain(folder: string): string {
  const whole = resolve(folder);
  const { root } = parse(whole);
  return whole.length > root.length ? whole.replace(/[\\/]+$/, "") : whole;
}

function same(one: string, other: string): boolean {
  return namesSameFolder(resolve(one), resolve(other));
}

/**
 * Whether a folder holds work of every kind: a drive's root, or one of the
 * person's broad folders (home, Documents, Desktop, Downloads).
 */
export function isBroad(
  folder: string,
  broadFolders: readonly string[],
): boolean {
  return isBroadFolder(plain(folder), broadFolders);
}

/**
 * The project whose linked folder holds `folder` most closely, archived ones
 * aside, by the rule the window groups conversations with.
 */
export function projectHolding<Project extends MemoryProject>(
  folder: string,
  projects: readonly Project[],
): Project | undefined {
  return holdingProject(plain(folder), projects);
}

/** The project a folder is linked to itself, archived or not. */
export function projectLinking<Project extends MemoryProject>(
  folder: string,
  projects: readonly Project[],
): Project | undefined {
  return projects.find((project) =>
    project.folders.some((linked) => same(linked, folder)),
  );
}

export function sameFolder(one: string, other: string): boolean {
  return same(one, other);
}
