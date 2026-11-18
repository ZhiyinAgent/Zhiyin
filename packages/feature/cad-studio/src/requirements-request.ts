/**
 * A design's requirements, as the person stated them and the model wrote
 * them down in the workspace: each a check of a kind the CAD studio
 * measures, on the parts of every build in a run of its own, apart from the
 * run of the model's script, so the script cannot change how a check comes
 * out.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, relative, sep } from "node:path";
import {
  kindsOf,
  largestFile,
  readRequirements,
  sceneKinds,
  type Checked,
  type Requirement,
} from "@zhiyin/studio-requirements";
import { locateInside } from "@zhiyin/workspace-containment";

export type { Requirement };
export { requirementLimits } from "@zhiyin/studio-requirements";

/** The kinds of requirement the CAD studio measures, by name. */
export const cadKindNames = [
  "size",
  "fits",
  "hole",
  "clearance",
  "mesh",
  "separate",
  "wall",
  "overhang",
  "draft",
  "undercut",
  "mass",
  "insert",
  "corner",
  "ribs",
  "bend",
  "balance",
  "void",
  "smooth",
  "stress",
  "strain",
] as const;

const cadKinds = kindsOf(cadKindNames);

/** The requirements of a file the harness measures: those of the CAD studio's kinds. */
export const measuredHere = (list: readonly Requirement[]) =>
  list.filter((one) => Object.hasOwn(cadKinds, one.check));

/**
 * Each requirement's verdict in the file's order: the harness's, or, for a
 * kind the 3D studio measures, not checked, saying so.
 */
export function inFileOrder(
  list: readonly Requirement[],
  checked: readonly Checked[],
): Checked[] {
  const measured = new Map(checked.map((one) => [one.id, one]));
  return list.flatMap((one) => {
    const found = measured.get(one.id);
    if (found) return [found];
    return Object.hasOwn(cadKinds, one.check)
      ? []
      : [
          {
            id: one.id,
            holds: null,
            why: `${/^[aeiou]/.test(one.check) ? "an" : "a"} ${one.check} requirement is measured in the 3D studio`,
          },
        ];
  });
}

/**
 * The requirements a build is checked against: the file it names, or,
 * naming none, requirements.json beside the script's file or at the
 * workspace's top, when there is one. None when there is no such file;
 * refused when the file named is missing, and, naming the file found,
 * when it holds what cannot be read as requirements.
 */
export async function requirementsFor(
  root: string,
  asked: unknown,
  scriptFile?: string,
): Promise<
  | {
      readonly ok: true;
      readonly file?: string;
      readonly requirements?: readonly Requirement[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /** The workspace file found, when it is its contents that are refused. */
      readonly file?: string;
    }
> {
  if (asked !== undefined && (typeof asked !== "string" || !asked.trim()))
    return {
      ok: false,
      reason: "requirements names a .json file in the workspace.",
    };
  const candidates =
    asked !== undefined
      ? [asked as string]
      : [
          ...(scriptFile && dirname(scriptFile) !== "."
            ? [`${dirname(scriptFile)}/requirements.json`]
            : []),
          "requirements.json",
        ];
  for (const candidate of candidates) {
    if (extname(candidate).toLowerCase() !== ".json")
      return { ok: false, reason: `${candidate} is not a .json file.` };
    const located = await locateInside(root, candidate);
    if (located.kind === "outside")
      return { ok: false, reason: `${candidate} is outside the workspace.` };
    if (located.kind !== "found") {
      if (asked !== undefined)
        return {
          ok: false,
          reason: `${candidate} does not exist in the workspace. Write it first, or leave out requirements.`,
        };
      continue;
    }
    const file = relative(await realpath(root), located.path)
      .split(sep)
      .join("/");
    if ((await stat(located.path)).size > largestFile)
      return {
        ok: false,
        file,
        reason: `${candidate} is over ${largestFile / 1024} KB, the most a requirements file may be. Let patterns between slashes, such as /Bolt_.*/, stand for long lists of parts, and keep says short.`,
      };
    const read = readRequirements(
      await readFile(located.path, "utf8"),
      candidate,
      cadKinds,
      sceneKinds,
    );
    if (!read.ok) return { ...read, file };
    return { ok: true, file, requirements: read.requirements };
  }
  return { ok: true };
}
