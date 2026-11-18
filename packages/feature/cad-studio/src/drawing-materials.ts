/**
 * A parts list's materials when a drawing gives none: each part's as the
 * last drawing of the same file gave it, then as a requirement beside the
 * script names it, so a drawing made again does not lose them.
 */

import type { DrawingRecord } from "./drawing-record.js";
import { materialsProblem } from "./drawing-kinds.js";
import { requirementsFor } from "./requirements-request.js";

type Args = Readonly<Record<string, unknown>>;

/** The parts or pattern a requirement names, as a parts list's materials take them. */
function named(requirement: Args): string[] {
  const one = requirement["part"];
  const many = requirement["parts"];
  if (typeof one === "string") return [one];
  if (Array.isArray(one)) return one.filter((n) => typeof n === "string");
  if (Array.isArray(many)) return many.filter((n) => typeof n === "string");
  return [];
}

/** What each requirement that names a part's material gives it, with the ids that did. */
function fromRequirements(list: readonly Args[]): {
  materials: Record<string, string>;
  ids: string[];
} {
  const materials: Record<string, string> = {};
  const ids: string[] = [];
  for (const requirement of list) {
    let gave = false;
    const material = requirement["material"];
    if (typeof material === "string")
      for (const part of named(requirement)) {
        materials[part] = material;
        gave = true;
      }
    const each = requirement["materials"];
    if (each && typeof each === "object" && !Array.isArray(each))
      for (const [part, value] of Object.entries(each))
        if (typeof value === "string") {
          materials[part] = value;
          gave = true;
        }
    if (gave && typeof requirement["id"] === "string")
      ids.push(requirement["id"]);
  }
  return { materials, ids };
}

/**
 * The drawing's arguments, given the materials found when it has a parts
 * list and gives none, with a sentence saying where they came from.
 */
export async function withMaterials(
  record: DrawingRecord,
  root: string,
  args: Args,
): Promise<{ args: Args; said?: string }> {
  if (args["parts_list"] !== true || args["materials"] !== undefined)
    return { args };
  const sources: string[] = [];
  let materials: Record<string, string> = {};
  const file = typeof args["file"] === "string" ? args["file"] : undefined;
  if (file) {
    const found = await requirementsFor(root, undefined, file);
    if (found.ok && found.file && found.requirements) {
      const given = fromRequirements(found.requirements as readonly Args[]);
      if (Object.keys(given.materials).length) {
        materials = given.materials;
        sources.push(`${found.file} (${given.ids.join(", ")})`);
      }
    }
  }
  const outputs = Array.isArray(args["outputs"]) ? args["outputs"] : [];
  for (const output of outputs) {
    const path = (output as Args | null)?.["path"];
    if (typeof path !== "string") continue;
    const kept = (await record.request(path))?.["materials"];
    if (kept && typeof kept === "object" && !materialsProblem(kept)) {
      materials = { ...materials, ...(kept as Record<string, string>) };
      sources.unshift(`the last drawing of ${path}`);
      break;
    }
  }
  if (!sources.length || materialsProblem(materials)) return { args };
  return {
    args: { ...args, materials },
    said: `No materials were given, so the parts list takes them from ${sources.join(" and ")}.`,
  };
}
