/** How blender_simulate's rigid bodies, settling, keys and baking read in an approval. */

import {
  type Args,
  isNumber,
  list,
  names,
  numbers,
  record,
  row,
  text,
  trimmed,
  type Row,
} from "./approval-words.js";

/** One group of rigid bodies: its objects, role, shape, and how it is weighed and touches. */
function group(given: unknown): string {
  const body = record(given);
  const role = text(body["role"]) ?? "active";
  const shape =
    text(body["shape"]) ??
    (role === "passive" ? "hull if convex, else mesh" : "hull");
  const said = [
    `${names(body["objects"])} ${role === "animated" ? "animated by its keys" : role}`,
    shape,
  ];
  if (text(body["material"])) said.push(`of ${String(body["material"])}`);
  if (isNumber(body["density"]))
    said.push(`at ${trimmed(body["density"])} kg/m³`);
  if (isNumber(body["mass"])) said.push(`${trimmed(body["mass"])} kg`);
  if (isNumber(body["friction"]))
    said.push(`friction ${trimmed(body["friction"])}`);
  if (isNumber(body["bounce"])) said.push(`bounce ${trimmed(body["bounce"])}`);
  return said.join(", ");
}

function world(given: unknown): string | undefined {
  const settings = record(given);
  const gravity = numbers(settings["gravity"]);
  const said = [
    ...(gravity
      ? [`gravity (${gravity.map((g) => trimmed(g)).join(", ")} m/s²)`]
      : []),
    ...(isNumber(settings["substeps"])
      ? [`${trimmed(settings["substeps"])} substeps a frame`]
      : []),
    ...(isNumber(settings["iterations"])
      ? [`${trimmed(settings["iterations"])} solver iterations`]
      : []),
  ];
  return said.length ? said.join(", ") : undefined;
}

const baking = (bake: unknown) =>
  bake === true
    ? "every simulation in the scene over the timeline; dynamic paint that caches beside the scene is left for a script"
    : bake === false
      ? "free every simulation's bake, so each follows changes again"
      : undefined;

const kept: Readonly<Record<string, string>> = {
  settle:
    "keep the rigid bodies where they are at the end of the timeline and remove the rigid-body physics",
  to_keys:
    "key the rigid bodies' motion on every frame and remove the rigid-body physics",
};

export function simulateBodyRows(args: Args): Row[] {
  const groups = list(args["rigid"]).map(group);
  return [
    ...row("Rigid bodies", groups.join("; ")),
    ...row("World", world(args["world"])),
    ...row("Bake", baking(args["bake"])),
    ...row("Then", kept[String(args["then"])]),
  ];
}
