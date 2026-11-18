/**
 * A scene's spec, as the person stated it and the model wrote it down in
 * the workspace: requirements.json beside the scene file, or at the
 * workspace's top, the file the CAD studio reads for a design too. Each
 * requirement is a check of a kind the 3D studio measures on the scene's
 * meshes; one of a kind only the CAD studio measures is read and left to it.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import {
  kindsOf,
  largestFile,
  readRequirements,
  requirementKinds,
  sceneKinds,
  type Requirement,
} from "@zhiyin/studio-requirements";
import { locateInside } from "@zhiyin/workspace-containment";

/** The kinds the 3D studio measures: those shared with the CAD studio that mean the same on a mesh, then its own. */
const specKinds = kindsOf(
  ["size", "fits", "clearance", "separate", "wall", "overhang"],
  sceneKinds,
);

/** Whether the 3D studio measures a requirement, rather than leaving it to the CAD studio. */
export const measuredHere = (requirement: Requirement) =>
  Object.hasOwn(specKinds, requirement.check);

export type SpecFound =
  | {
      readonly ok: true;
      /** The file, workspace-relative with forward slashes. */
      readonly file: string;
      readonly requirements: readonly Requirement[];
      readonly object?: string;
    }
  | { readonly ok: false; readonly file: string; readonly reason: string };

/**
 * The spec a scene is measured against: requirements.json beside the scene
 * file, or at the workspace's top. None when there is no such file; refused,
 * naming the file, when it cannot be read as requirements.
 */
export async function specFor(
  root: string,
  scene: string,
): Promise<SpecFound | undefined> {
  const folder = dirname(scene);
  const candidates = [
    ...(folder !== "." ? [`${folder}/requirements.json`] : []),
    "requirements.json",
  ];
  for (const candidate of candidates) {
    const located = await locateInside(root, candidate);
    if (located.kind !== "found") continue;
    const file = relative(await realpath(root), located.path)
      .split(sep)
      .join("/");
    if ((await stat(located.path)).size > largestFile)
      return {
        ok: false,
        file,
        reason: `${file} is over ${largestFile / 1024} KB, the most a spec may be. Let patterns between slashes, such as /Leg_.*/, stand for long lists of parts, and keep says short.`,
      };
    const read = readRequirements(
      await readFile(located.path, "utf8"),
      file,
      specKinds,
      requirementKinds,
    );
    return { ...read, file };
  }
  return undefined;
}
