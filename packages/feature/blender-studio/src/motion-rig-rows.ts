/**
 * blender_animate's rig and driver inputs as a person reads them: a bone's
 * key, the poses saved, the values driven and how an aim follows its target.
 */

import {
  list,
  numbers,
  point,
  record,
  row,
  text,
  trimmed,
  type Args,
  type Row,
} from "./approval-words.js";

/** A key's object, and its bone when it keys one: "Rig's Forearm". */
export function keyedName(spec: Args): string {
  const object = text(spec["object"]) ?? "?";
  const bone = text(spec["bone"]);
  return bone ? `${object}'s ${bone}` : object;
}

/** What a key sets of a bone or a pose, in words. */
export function boneKeyWords(spec: Args): string[] {
  return [
    text(spec["pose"]) && `pose ${text(spec["pose"])}`,
    point(spec["reach"]) && `reaching for ${point(spec["reach"])}`,
  ].filter((part): part is string => Boolean(part));
}

/** Each pose saved, with the bones it holds. */
export function poseRows(args: Args): Row[] {
  return list(args["poses"]).flatMap((item) => {
    const spec = record(item);
    const bones = list(spec["bones"]).map((bone) => {
      const one = record(bone);
      const turned = numbers(one["rotation"]);
      const moved = point(one["location"]);
      return [
        text(one["bone"]) ?? "?",
        turned ? `turned (${turned.map(trimmed).join("°, ")}°)` : "",
        moved ? `moved ${moved}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    });
    return row(
      `${text(spec["object"]) ?? "?"} pose ${text(spec["name"]) ?? "?"}`,
      bones.length ? bones.join("; ") : "as it stands now",
    );
  });
}

/** One variable a driver reads, in words. */
function variableWords(item: unknown, index: number): string {
  const spec = record(item);
  const end = (object: unknown, bone: unknown) =>
    text(bone)
      ? `${text(object) ?? "?"}'s ${text(bone)}`
      : (text(object) ?? "?");
  const name = text(spec["name"]) ?? "abcdefgh"[index] ?? "?";
  const kind = text(spec["kind"]) ?? "value";
  const what =
    kind === "distance"
      ? `the distance from ${end(spec["object"], spec["bone"])} to ${end(spec["to"], spec["to_bone"])}`
      : kind === "turn_between"
        ? `the turn between ${end(spec["object"], spec["bone"])} and ${end(spec["to"], spec["to_bone"])}`
        : `${end(spec["object"], spec["bone"])}'s ${text(spec["path"]) ?? "?"}`;
  return `${name}, ${what}`;
}

/** Each value driven, from what, and how. */
export function driveRows(args: Args): Row[] {
  return list(args["drive"]).flatMap((item) => {
    const spec = record(item);
    const how = text(spec["formula"])
      ? `by ${text(spec["formula"])}`
      : (text(spec["combine"]) ?? "");
    return row(
      `${text(spec["object"]) ?? "?"}'s ${text(spec["path"]) ?? "?"}`,
      [
        `driven by ${list(spec["variables"]).map(variableWords).join("; ")}`,
        how,
      ]
        .filter(Boolean)
        .join(", "),
    );
  });
}

/** How an aim follows what it aims at, past pointing at it. */
export function aimWords(spec: Args): string {
  const at = text(spec["at"]);
  if (!at) return "nothing, from now on";
  if (spec["on_curve"] === true) return `kept on the curve ${at}`;
  const facing = text(spec["facing"]);
  return [
    facing ? `${at}, with its ${facing} axis` : at,
    text(spec["up"]) ? `its ${text(spec["up"])} axis up` : "",
    text(spec["locked"])
      ? `turning about its ${text(spec["locked"])} axis only`
      : "",
    spec["stretch"] === true ? "stretching to reach it" : "",
  ]
    .filter(Boolean)
    .join(", ");
}
