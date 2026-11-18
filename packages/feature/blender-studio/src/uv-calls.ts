/**
 * Unwrapping surfaces and baking materials into textures, each a change to
 * the scene. A bake also writes its maps in the workspace, each named before
 * Blender runs, so the approval names every file it writes.
 */

import { join } from "node:path";
import { missingInputs } from "./needed-inputs.js";
import { kinds, writable, type Refusal, type Written } from "./paths.js";
import {
  fileChange,
  record,
  sceneChange,
  sceneFileChange,
  type Args,
  type Preparer,
} from "./prepared-call.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimits } from "./time-limits.js";
import { isNumber, type Row } from "./approval-words.js";

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const listed = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const readable = (rows: readonly (Row | undefined)[]): Row[] =>
  rows.flatMap((one) => (one && one.value ? [{ ...one, readable: true }] : []));

const methodWords: Readonly<Record<string, string>> = {
  angle: "angle-based, along seams",
  conformal: "conformal, along seams",
  minimum_stretch: "minimum stretch, along seams",
  follow_quads: "following its quads",
  smart: "smart projection",
  cube: "cube projection",
  cylinder: "cylinder projection",
  sphere: "sphere projection",
  lightmap: "lightmap, every face apart",
  camera: "projected from the camera",
};

function seamsWords(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const seams = record(value);
  const parts: string[] = [];
  if (isNumber(seams["angle"]))
    parts.push(`edges sharper than ${seams["angle"]}°`);
  if (seams["by"] === "material") parts.push("between materials");
  if (seams["by"] === "surface_group")
    parts.push("between the groups of surfaces");
  const where =
    seams["hide"] === false
      ? "cuts by the shortest way"
      : seams["hide"] === true
        ? "cuts where the camera sees least"
        : undefined;
  return [parts.length ? listed(parts) : "the mesh's own", where]
    .filter(Boolean)
    .join("; ");
}

function unwrapRows(args: Args): Row[] {
  const pack = record(args["pack"]);
  const texel = record(args["texel_density"]);
  const resolution = isNumber(texel["resolution"])
    ? texel["resolution"]
    : statedNumbers.unwrap.texel_resolution;
  const margin = isNumber(pack["margin_px"]) ? pack["margin_px"] : 4;
  return readable([
    { name: "Unwrap", value: listed(strings(args["objects"])) },
    {
      name: "Method",
      value:
        methodWords[String(args["method"] ?? "angle")] ??
        String(args["method"]),
    },
    { name: "Seams", value: seamsWords(args["seams"]) ?? "" },
    args["method"] === "camera"
      ? undefined
      : {
          name: "Packed",
          value: `${margin} px apart${pack["rotate"] === false ? ", unturned" : ""}, ${
            isNumber(texel["px_per_cm"])
              ? `at ${texel["px_per_cm"]} px/cm`
              : "filling the tile"
          } of a ${resolution} px texture`,
        },
  ]);
}

export const prepareUnwrap = sceneChange("unwrap", (args) => ({
  args: { ...args },
  action: "Unwrap objects for textures in a 3D scene",
  rows: unwrapRows(args),
}));

/** An object's name as a file's: what Windows cannot hold in one becomes _. */
const fileNamePart = (name: string) =>
  [...name]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character,
    )
    .join("")
    .replace(/[. ]+$/, "_");

const defaultMargin = (resolution: number) =>
  Math.max(1, Math.round(resolution / statedNumbers.bake.margin_share));

function bakeRows(args: Args, files: readonly string[]): Row[] {
  const resolution = isNumber(args["resolution"])
    ? args["resolution"]
    : statedNumbers.bake.resolution;
  const margin = isNumber(args["margin_px"])
    ? args["margin_px"]
    : defaultMargin(resolution);
  const from = strings(args["from"]);
  return readable([
    { name: "Bake", value: listed(strings(args["maps"])) },
    { name: "Of", value: listed(strings(args["objects"])) },
    from.length
      ? { name: "From", value: `${listed(from)}, onto each` }
      : undefined,
    {
      name: "Size",
      value: `${resolution} × ${resolution} px, ${margin} px bleed`,
    },
    { name: "Writes", value: files.join(", ") },
    {
      name: "Material",
      value: "each object gets a copy of its material drawn from the maps",
    },
  ]);
}

/**
 * Every map the bake writes, by object then map, each a workspace file
 * checked as a write; or why one cannot be written.
 */
async function bakeFiles(
  root: string,
  args: Args,
): Promise<Written[][] | Refusal> {
  const objects = strings(args["objects"]);
  const maps = strings(args["maps"]);
  const folder =
    typeof args["folder"] === "string" && args["folder"].trim()
      ? args["folder"]
      : "textures";
  const patterned = objects.find(
    (name) => name.length > 2 && name.startsWith("/") && name.endsWith("/"),
  );
  if (patterned)
    return {
      reason: `A bake names each object, as its files are named after it: ${patterned} is a pattern.`,
      correctable: true,
    };
  const seen = new Map<string, string>();
  for (const name of objects) {
    const part = fileNamePart(name).toLowerCase();
    const other = seen.get(part);
    if (other !== undefined)
      return {
        reason: `${other} and ${name} would write maps of the same names: bake them in separate calls, each with its own folder.`,
        correctable: true,
      };
    seen.set(part, name);
  }
  const files: Written[][] = [];
  for (const name of objects) {
    const own: Written[] = [];
    for (const map of maps) {
      const file = await writable(
        root,
        join(folder, `${fileNamePart(name)}_${map}.png`),
        kinds.picture,
        "A baked map",
      );
      if (!("absolute" in file)) return file;
      own.push(file);
    }
    files.push(own);
  }
  return files;
}

export const prepareBake: Preparer = async (args, place) => {
  const missing = missingInputs("bake", args);
  if (missing) return missing;
  const files = await bakeFiles(place.root, args);
  if ("reason" in files) return files;
  const objects = strings(args["objects"]);
  const maps = strings(args["maps"]);
  const written = files.flat();
  const relative = written.map((file) => file.relative);
  return {
    command: "bake",
    // Blender writes each map where it was approved.
    args: {
      ...args,
      files: Object.fromEntries(
        objects.map((name, i) => [
          name,
          Object.fromEntries(
            maps.map((map, j) => [map, files[i]?.[j]?.absolute]),
          ),
        ]),
      ),
    },
    timeoutMs: timeLimits.bake,
    action: "Bake materials to textures in a 3D scene",
    target: place.scene,
    rows: bakeRows(args, relative),
    access: "change",
    changes: [
      ...written.map((file) => fileChange(file, "A map Blender bakes.")),
      sceneFileChange(place.scene),
    ],
    written,
    picture: true,
  };
};
