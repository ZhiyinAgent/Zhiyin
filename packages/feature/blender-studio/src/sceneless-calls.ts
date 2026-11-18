/** The calls that need no open scene: opening or creating one, and looking up Blender's API. */

import { kinds, writable, type Refusal } from "./paths.js";
import { fileChange, type Args, type Prepared } from "./prepared-call.js";
import { timeLimits } from "./time-limits.js";
import { inWords, openRows } from "./wording.js";

/** Opens a scene file in the workspace, or creates it when asked to. */
export async function prepareOpen(
  args: Args,
  root: string,
): Promise<Prepared | Refusal> {
  const file = await writable(root, args["path"], kinds.scene, "A scene file");
  if (!("absolute" in file)) return file;
  const create = args["create"] === true;
  if (!file.exists && !create)
    return {
      reason: `${file.relative} does not exist. Pass create: true to start a new scene there.`,
      correctable: true,
    };
  return {
    command: "open",
    args: { path: file.absolute, create, workspace: root },
    timeoutMs: timeLimits.open,
    action: file.exists ? "Open a 3D scene" : "Create a 3D scene",
    target: file.relative,
    rows: inWords(openRows(file.relative, file.exists)),
    access: file.exists ? "read" : "change",
    ...(file.exists
      ? {}
      : {
          changes: [fileChange(file, "A new scene, in Blender's own format.")],
          written: [file],
        }),
    opening: { relative: file.relative, absolute: file.absolute },
  };
}

/** Looks up a type, node or operator in Blender's own API. */
export function prepareLookUp(args: Args): Prepared | Refusal {
  if (typeof args["name"] !== "string" || !args["name"].trim())
    return {
      reason: "Name a type, node or operator to look up.",
      correctable: true,
    };
  return {
    command: "api",
    args: { name: args["name"] },
    timeoutMs: timeLimits.api,
    action: "Look up Blender's API",
    target: args["name"],
    rows: inWords([{ name: "Looks up", value: args["name"] }]),
    access: "read",
  };
}
