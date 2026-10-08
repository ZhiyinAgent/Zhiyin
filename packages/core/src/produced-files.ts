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
): Promise<ArtifactPreview> {
  const artifact = taskArtifact(tasks, taskId, path);
  if (!artifact)
    return {
      status: "missing",
      path,
      reason: "This task has no record of that file.",
    };
  return artifacts.preview(artifact);
}

export async function exportArtifact(
  artifacts: Artifacts,
  tasks: readonly WorkspaceTask[],
  taskId: string,
  path: string,
  chooseDestination: DestinationChooser,
): Promise<ArtifactExport> {
  const artifact = taskArtifact(tasks, taskId, path);
  if (!artifact)
    return {
      status: "failed",
      reason: "This task has no record of that file.",
    };
  return artifacts.exportTo(artifact, chooseDestination);
}

export async function exportView(
  artifacts: Artifacts,
  tasks: readonly WorkspaceTask[],
  taskId: string,
  viewId: string,
  svg: string,
  chooseDestination: DestinationChooser,
): Promise<ArtifactExport> {
  const view = taskView(tasks, taskId, viewId);
  if (!view)
    return {
      status: "failed",
      reason: "This task has no record of that view.",
    };
  return artifacts.exportView(view.title, svg, chooseDestination);
}
