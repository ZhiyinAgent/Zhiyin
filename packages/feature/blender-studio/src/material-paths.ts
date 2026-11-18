/**
 * The workspace files a material call reads, each checked and handed to
 * Blender by its absolute path: its picture, its normal map, its height
 * picture and its texture set's pictures, named one by one or found in a
 * workspace folder. A folder's pictures are listed here, each checked as a
 * named one is, so Blender reads no file this has not checked.
 */

import { readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";
import { kinds, readable, type Refusal } from "./paths.js";

type Args = Record<string, unknown>;

const record = (value: unknown): Args =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Args)
    : {};

/** The kinds of map a texture set names one by one. */
const mapKinds = [
  "color",
  "roughness",
  "metallic",
  "normal",
  "height",
  "ao",
  "opacity",
  "orm",
] as const;

const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "reason" in value;

async function checked(root: string, path: unknown): Promise<string | Refusal> {
  const found = await readable(root, path, kinds.picture, "A picture");
  return "absolute" in found ? found.absolute : found;
}

/** The pictures in a workspace folder, each checked, by absolute path. */
async function folderPictures(
  root: string,
  folder: unknown,
): Promise<string[] | Refusal> {
  if (typeof folder !== "string" || !folder.trim())
    return {
      reason: "maps.folder needs a workspace-relative folder.",
      correctable: true,
    };
  if (isAbsolute(folder) || !staysInside(root, resolve(root, folder)))
    return {
      reason: `${folder} is outside the workspace.`,
      correctable: false,
    };
  const realRoot = await realpath(root);
  const real = await realpath(resolve(realRoot, folder)).catch(() => undefined);
  if (!real)
    return {
      reason: `${folder} does not exist in the workspace.`,
      correctable: true,
    };
  if (!realStaysInside(realRoot, real))
    return {
      reason: `${folder} is outside the workspace.`,
      correctable: false,
    };
  if (!(await stat(real)).isDirectory())
    return {
      reason: `${folder} is not a folder.`,
      correctable: true,
    };
  const names = (await readdir(real))
    .filter((name) =>
      (kinds.picture as readonly string[]).includes(
        extname(name).toLowerCase(),
      ),
    )
    .sort();
  if (names.length === 0)
    return {
      reason: `${folder} holds no pictures (${kinds.picture.join(", ")}).`,
      correctable: true,
    };
  const files: string[] = [];
  for (const name of names) {
    const found = await checked(root, join(folder, name));
    if (isRefusal(found)) return found;
    files.push(found);
  }
  return files;
}

/** A material's description with every workspace file it reads made a checked absolute path. */
export async function materialWithPaths(
  root: string,
  given: unknown,
): Promise<Args | Refusal> {
  const material = { ...record(given) };
  for (const key of ["texture", "normal_map", "height"] as const) {
    const map = record(material[key]);
    if (material[key] === undefined || map["path"] === undefined) continue;
    const found = await checked(root, map["path"]);
    if (isRefusal(found)) return found;
    material[key] = { ...map, path: found };
  }
  if (material["maps"] !== undefined) {
    const maps = { ...record(material["maps"]) };
    for (const kind of mapKinds) {
      if (maps[kind] === undefined) continue;
      const found = await checked(root, maps[kind]);
      if (isRefusal(found)) return found;
      maps[kind] = found;
    }
    if (maps["folder"] !== undefined) {
      const files = await folderPictures(root, maps["folder"]);
      if (isRefusal(files)) return files;
      maps["files"] = files;
    }
    material["maps"] = maps;
  }
  return material;
}
