/**
 * A shaping call's workspace files: the picture a displace step moves the
 * shape by, checked in the workspace and sent to Blender by its absolute path.
 */

import { kinds, readable, type Refusal } from "./paths.js";
import { record } from "./prepared-call.js";

/** The call's steps with each picture they read checked and made absolute, or the refusal of one. */
export async function stepsWithPaths(
  root: string,
  operations: unknown,
): Promise<readonly Record<string, unknown>[] | Refusal> {
  const checked: Record<string, unknown>[] = [];
  for (const item of Array.isArray(operations) ? operations : []) {
    const step = record(item);
    if (step["image"] !== undefined) {
      const found = await readable(
        root,
        step["image"],
        kinds.picture,
        "A picture",
      );
      if (!("absolute" in found)) return found;
      step["image"] = found.absolute;
    }
    checked.push(step);
  }
  return checked;
}
