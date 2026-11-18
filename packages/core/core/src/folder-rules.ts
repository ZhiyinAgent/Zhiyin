/**
 * What a conversation's folder is across launches and changes: how one comes
 * back, what the person is told when it will not, and the folders kept for
 * choosing again.
 */

import type {
  WorkspaceContext,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { sameFolder } from "@zhiyin/path-comparison";

const maximumRecentWorkspaces = 5;
const maximumLaunchFolders = 20;

type Folder = NonNullable<WorkspaceSnapshot["workspace"]>;

export const movedWorkspaceNotice =
  "The selected folder is unavailable. Choose its new location before using files.";

/** What the person is told when a conversation's folder will not open. */
export function unopenedFolderNotice(task: WorkspaceTask): string {
  return `The folder for “${task.title}” could not be opened. Choose its new location before using files.`;
}

export function withRecentWorkspace(
  existing: WorkspaceSnapshot["recentWorkspaces"],
  chosen: Folder,
): WorkspaceSnapshot["recentWorkspaces"] {
  return [
    chosen,
    ...existing.filter((folder) => !sameFolder(folder.path, chosen.path)),
  ].slice(0, maximumRecentWorkspaces);
}

/** The folders named at launch and not chosen since, with `path` first. */
function withLaunchFolder(
  existing: readonly string[],
  path: string,
): readonly string[] {
  return [path, ...existing.filter((item) => !sameFolder(item, path))].slice(
    0,
    maximumLaunchFolders,
  );
}

/** The folders a launch starts with. */
export type LaunchFolders = {
  readonly workspace: WorkspaceSnapshot["workspace"];
  readonly launchFolders: readonly string[];
  readonly recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"];
};

/**
 * The folders as the history saved them, checked again: the folder shown is
 * kept among the recent ones, and, when the history names none, the folder
 * named at launch is where a conversation starts. One among the recent
 * folders was chosen before; any other, nobody chose, so it is not offered
 * among the recent ones until it is.
 */
export async function restoreFolders(
  saved: LaunchFolders,
  {
    startingFolder,
    context,
    say,
  }: {
    readonly startingFolder: string | undefined;
    readonly context: Pick<WorkspaceContext, "checkFolder">;
    readonly say: (message: string) => void;
  },
): Promise<LaunchFolders> {
  let { workspace, launchFolders } = saved;
  let recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"] =
    saved.recentWorkspaces;
  if (workspace && context.checkFolder) {
    try {
      await context.checkFolder(workspace.path);
    } catch {
      say(movedWorkspaceNotice);
    }
  }
  if (workspace)
    recentWorkspaces = withRecentWorkspace(recentWorkspaces, workspace);
  if (!workspace && startingFolder && context.checkFolder) {
    const path = startingFolder;
    const name = await context.checkFolder(path).catch(() => undefined);
    if (name) {
      workspace = { path, name };
      if (!recentWorkspaces.some((folder) => sameFolder(folder.path, path)))
        launchFolders = withLaunchFolder(launchFolders, path);
    } else
      say(
        `The folder named at launch, ${path}, could not be opened. Choose a folder before using files.`,
      );
  }
  return { workspace, launchFolders, recentWorkspaces };
}
