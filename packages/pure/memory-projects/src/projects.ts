/**
 * Which project a folder or a conversation belongs to (ADR 0026), worked out
 * the same way by the memory feature, the agent loop, the core and the window.
 */

import type { MemoryProject } from "@zhiyin/contract";
import { folderKey, inside } from "@zhiyin/path-comparison";

/**
 * Whether work of every kind passes through a folder, so it is never linked
 * to a project: a drive's root, or one of the person's broad folders (home,
 * Documents, Desktop, Downloads).
 */
export function isBroadFolder(
  folder: string,
  broadFolders: readonly string[],
): boolean {
  const whole = folderKey(folder);
  return (
    /^[a-z]:\\$/.test(whole) ||
    broadFolders.some((broad) => folderKey(broad) === whole)
  );
}

/**
 * The project whose linked folder holds `folder` most closely, archived ones
 * aside. Both are absolute paths.
 */
export function projectHolding<Project extends MemoryProject>(
  folder: string,
  projects: readonly Project[],
): Project | undefined {
  let best: { project: Project; depth: number } | undefined;
  for (const project of projects) {
    if (project.archived) continue;
    for (const linked of project.folders) {
      if (!inside(linked, folder)) continue;
      const depth = folderKey(linked).length;
      if (!best || depth > best.depth) best = { project, depth };
    }
  }
  return best?.project;
}

/**
 * The project kept as `id`, or the one it was merged into; none when it is
 * archived or no longer kept.
 */
export function projectKeptAs<Project extends MemoryProject>(
  id: string,
  projects: readonly Project[],
): Project | undefined {
  return projects.find(
    (project) =>
      (project.id === id || project.merged?.includes(id)) && !project.archived,
  );
}

/**
 * The project a conversation is in: the one the person chose, none if they
 * chose none, and otherwise the one its folder is linked to. An archived
 * project holds none.
 */
export function projectOfConversation<Project extends MemoryProject>(
  conversation: {
    readonly project?: string | null | undefined;
    readonly workspace?: { readonly path: string } | undefined;
  },
  projects: readonly Project[],
): Project | undefined {
  if (conversation.project === null) return undefined;
  if (conversation.project !== undefined)
    return projectKeptAs(conversation.project, projects);
  return conversation.workspace
    ? projectHolding(conversation.workspace.path, projects)
    : undefined;
}
