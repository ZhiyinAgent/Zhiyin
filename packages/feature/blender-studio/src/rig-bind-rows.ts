/** How blender_rig's binding and reaching limbs read in an approval. */

import {
  type Args,
  isNumber,
  list,
  names,
  record,
  row,
  text,
  type Row,
} from "./approval-words.js";

const bindings: Readonly<Record<string, string>> = {
  automatic: "by automatic weights",
  envelope: "by the bones' envelopes",
  rigid: "rigidly, each loose part to the bone it lies in",
};

function bindRows(bind: Args): Row[] {
  const meshes = names(bind["meshes"]);
  if (!meshes) return [];
  const to =
    text(bind["armature"]) ?? "the rig this call made, or the scene's armature";
  const how = bindings[String(bind["how"] ?? "automatic")] ?? "";
  const volume =
    bind["preserve_volume"] === false ? "" : ", keeping joints' volume";
  const most = bind["influences"];
  return [
    ...row("Bind", `${meshes} to ${to}, ${how}${volume}`),
    ...row(
      "Influences",
      isNumber(most)
        ? `at most ${most} bone${most === 1 ? "" : "s"} on each point`
        : undefined,
    ),
  ];
}

function reachWords(reach: Args): string | undefined {
  const bone = text(reach["bone"]);
  if (!bone) return undefined;
  const chain = reach["chain"];
  const curve = text(reach["curve"]);
  const bones = isNumber(chain)
    ? ` (${chain} bone${chain === 1 ? "" : "s"})`
    : curve
      ? " (to the root)"
      : " (2 bones)";
  const of = text(reach["armature"]) ? ` of ${text(reach["armature"])}` : "";
  const aim = curve
    ? `lies along ${curve}`
    : `reaches for ${text(reach["target"]) ?? "a target"}`;
  const pole = text(reach["pole"])
    ? `, bending toward ${text(reach["pole"])}`
    : "";
  const stretch = reach["stretch"] === true ? ", stretching" : "";
  return `${bone}${of}${bones} ${aim}${pole}${stretch}`;
}

export function rigBindRows(args: Args): Row[] {
  const reaches = list(args["ik"])
    .map((reach) => reachWords(record(reach)))
    .filter((said): said is string => Boolean(said));
  return [
    ...bindRows(record(args["bind"])),
    ...reaches.map((said) => ({ name: "Reach", value: said })),
  ];
}
