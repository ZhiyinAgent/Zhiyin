/**
 * Reading and exporting a produced file are not model actions: a person asked
 * for them directly. The workspace finds the record and the artifacts feature
 * does the rest; the destination chooser belongs to whoever can open a dialog.
 */

import type {
  ArtifactExport,
  ArtifactPreview,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { Artifacts, DestinationChooser } from "@zhiyin/artifacts";
import { taskArtifact, taskView } from "./workspace-tasks.js";

export async function previewArtifact(
  artifacts: Artifacts,
  tasks: readonly WorkspaceTask[],
  taskId: string,
  path: string,
  /** The conversation's folder, which the record's path is relative to. */
  root: string | undefined,
): Promise<ArtifactPreview> {
  const artifact = taskArtifact(tasks, taskId, path);
  if (!artifact)
    return {
      status: "missing",
      path,
      reason: "This task has no record of that file.",
    };
  return artifacts.preview(artifact, root);
}

export async function exportArtifact(
  artifacts: Artifacts,
  tasks: readonly WorkspaceTask[],
  taskId: string,
  path: string,
  root: string | undefined,
  chooseDestination: DestinationChooser,
): Promise<ArtifactExport> {
  const artifact = taskArtifact(tasks, taskId, path);
  if (!artifact)
    return {
      status: "failed",
      reason: "This task has no record of that file.",
    };
  return artifacts.exportTo(artifact, root, chooseDestination);
}

export async function exportView(
  artifacts: Artifacts,
  tasks: readonly WorkspaceTask[],
  {
    taskId,
    viewId,
    svg,
    chooseDestination,
  }: {
    readonly taskId: string;
    readonly viewId: string;
    readonly svg: string;
    readonly chooseDestination: DestinationChooser;
  },
): Promise<ArtifactExport> {
  const view = taskView(tasks, taskId, viewId);
  if (!view)
    return {
      status: "failed",
      reason: "This task has no record of that view.",
    };
  return artifacts.exportView(view.title, svg, chooseDestination);
}
