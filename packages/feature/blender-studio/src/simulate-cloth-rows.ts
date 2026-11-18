/** How blender_simulate's cloth, colliders and liquids read in an approval. */

import { percent, statedNumbers } from "./stated-numbers.js";
import {
  isNumber,
  length,
  list,
  names,
  point,
  record,
  row,
  text,
  trimmed,
  type Args,
  type Row,
} from "./approval-words.js";

function heldWords(pinned: Args): string | undefined {
  const group = text(pinned["group"]);
  if (group) return `vertex group ${group}`;
  const edge = text(pinned["edge"]);
  if (edge)
    return edge === "border" ? "all round its border" : `its ${edge} edge`;
  const points = list(pinned["points"]);
  return points.length
    ? `the points nearest ${points.map(point).filter(Boolean).join(", ")}`
    : undefined;
}

function pinnedWords(pinned: Args): string | undefined {
  const held = heldWords(pinned);
  if (!held || !isNumber(pinned["release"])) return held;
  return `${held}, let go at ${trimmed(pinned["release"])} s`;
}

function selfCollisionWords(value: unknown): string | undefined {
  if (value === false) return "off: it may pass through itself";
  return value === true ? "on" : undefined;
}

function clothRows(cloth: Args): Row[] {
  const object = text(cloth["object"]);
  if (!object) return [];
  const fabric = text(cloth["fabric"]) ?? "cotton";
  return [
    { name: "Cloth", value: `${object}, ${fabric}` },
    ...row(
      "Subdivided to",
      isNumber(cloth["subdivide_to"])
        ? `${length(cloth["subdivide_to"])} apart`
        : undefined,
    ),
    ...row("Pinned", pinnedWords(record(cloth["pinned"]))),
    ...row("Self-collision", selfCollisionWords(cloth["self_collision"])),
    ...row(
      "Steps a frame",
      isNumber(cloth["steps"]) ? String(cloth["steps"]) : undefined,
    ),
    ...row(
      "Inflated",
      isNumber(cloth["pressure"])
        ? `by pressure ${cloth["pressure"]}`
        : undefined,
    ),
    ...row(
      "Sewn",
      cloth["sew"] === true ? "its loose edges pulled shut" : undefined,
    ),
    ...row("Collides with", names(cloth["colliders"])),
    {
      name: "Kept",
      value:
        cloth["drape"] === true
          ? "where it comes to rest, as its shape; the cloth removed"
          : "as cloth moving over the scene's frames",
    },
  ];
}

function sourceWords(source: Args): string | undefined {
  const object = text(source["object"]);
  if (!object) return undefined;
  return source["flow"] === "pour"
    ? `${object}, pouring in`
    : `${object}, its volume as liquid`;
}

function liquidRows(liquid: Args): Row[] {
  const sources = list(liquid["sources"])
    .map((s) => sourceWords(record(s)))
    .filter(Boolean)
    .join("; ");
  if (!sources) return [];
  const resolution = isNumber(liquid["voxel"])
    ? `voxels of ${length(liquid["voxel"])}`
    : `resolution ${isNumber(liquid["resolution"]) ? liquid["resolution"] : 32}`;
  return [
    {
      name: "Liquid",
      value: `${text(liquid["preset"]) ?? "water"}, baked over the scene's frames at ${resolution}`,
    },
    ...row("In", text(liquid["container"])),
    { name: "From", value: sources },
    ...row("Around", names(liquid["obstacles"])),
    {
      name: "Cache",
      value: "kept in this conversation's own folder, outside the workspace",
    },
  ];
}

function colliderRows(colliders: Args): Row[] {
  const objects = names(colliders["objects"]);
  if (!objects) return [];
  return [
    {
      name: "Colliders",
      value: `${objects}, met by every cloth, soft body and particle system, ${isNumber(colliders["thickness"]) ? `${length(colliders["thickness"])} thick` : `as thick as ${percent(statedNumbers.simulate.collision_share)} of the finest spacing`}`,
    },
  ];
}

export function simulateClothRows(args: Args): Row[] {
  return [
    ...clothRows(record(args["cloth"])),
    ...colliderRows(record(args["colliders"])),
    ...liquidRows(record(args["liquid"])),
  ];
}
