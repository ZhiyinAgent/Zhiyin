/**
 * The containment rule every feature that reads or writes the person's folder
 * depends on, in one place. A second copy is a second boundary to keep in step
 * with the first.
 *
 * It is settled twice: lexically, before anything is read, so a request that
 * could escape is never presented; and again after links are resolved, so a
 * path that leads out through a link still does not reach what is outside. The
 * second comparison is exact, since both sides then name folders as stored.
 * The lexical comparison is the path-comparison package's, which the core and
 * the window also use, so every layer compares names alike.
 */

import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { below, inside } from "@zhiyin/path-comparison";

/**
 * Whether `target` is `root` or something inside it, by the path alone. A
 * relative path is taken from the current folder.
 */
export function staysInside(root: string, target: string): boolean {
  return inside(resolve(root), resolve(target));
}

/**
 * Whether `path` is `folder` or lies below it, comparing names as Windows
 * does, whatever their case. A name that starts with two dots is inside.
 */
export function holds(folder: string, path: string): boolean {
  return staysInside(folder.toLowerCase(), path.toLowerCase());
}

/** Whether `target` is inside `root` and not `root` itself, by the path alone. */
export function staysBelow(root: string, target: string): boolean {
  return below(resolve(root), resolve(target));
}

/**
 * Whether a real path is the real root or inside it, comparing names exactly
 * as stored. Both must come from `realpath` in `node:fs/promises`, or
 * `realpathSync.native`, which give each name as the folder stores it; the
 * script version of `realpathSync` keeps the case it was asked in and must not
 * be used here. Compared exactly, a sibling whose name differs only in case is
 * outside, as it is in a folder that tells case apart. A path not yet resolved
 * is compared with `staysInside`.
 */
export function realStaysInside(realRoot: string, realTarget: string): boolean {
  if (realTarget === realRoot) return true;
  const root = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  return realTarget.startsWith(root);
}

/** The same, and not the root itself. */
export function realStaysBelow(realRoot: string, realTarget: string): boolean {
  return realTarget !== realRoot && realStaysInside(realRoot, realTarget);
}

export type Located =
  | { readonly kind: "found"; readonly path: string }
  | { readonly kind: "outside" | "missing" | "not-a-file" | "unreadable" };

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

/**
 * The file a workspace-relative path names, with links resolved, or why there
 * is none. A path is refused as outside before anything on disk is touched.
 */
export async function locateInside(
  root: string,
  path: string,
): Promise<Located> {
  if (isAbsolute(path) || !staysInside(root, resolve(root, path)))
    return { kind: "outside" };
  try {
    const realRoot = await realpath(root);
    const target = await realpath(resolve(realRoot, path));
    if (!realStaysInside(realRoot, target)) return { kind: "outside" };
    if (!(await stat(target)).isFile()) return { kind: "not-a-file" };
    return { kind: "found", path: target };
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }
}

export type Placed =
  | {
      readonly kind: "writable";
      /** Where the file really is, or will be, with links resolved. */
      readonly absolute: string;
      /** That place from the workspace's real folder, with forward slashes. */
      readonly relative: string;
      /** Whether a file is there already, to be replaced. */
      readonly exists: boolean;
    }
  | { readonly kind: "outside" | "colon" | "reserved" };

/** A name Windows keeps for a device, which no file can be given, whatever its extension. */
const deviceName = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * A path's parts once `.` and `..` are taken away by name, each as Windows
 * names it, without the dots and spaces it drops from a name's end; nothing
 * when `..` climbs above its start, and "reserved" for a device's name.
 */
function namedParts(path: string): string[] | "reserved" | undefined {
  const parts: string[] = [];
  for (const written of path.split(/[\\/]/)) {
    if (written === "" || written === ".") continue;
    if (written === "..") {
      if (parts.pop() === undefined) return undefined;
      continue;
    }
    const part = written.replace(/[. ]+$/, "");
    if (part === "") continue;
    if (deviceName.test(part)) return "reserved";
    parts.push(part);
  }
  return parts;
}

/**
 * Follows each part that exists from `start`, through links, and places the
 * parts still missing where the last one that exists really is. A link whose
 * target is missing refuses the path, since what appears there could be
 * anywhere; so does a part `stays` refuses once resolved.
 */
async function followed(
  start: string,
  parts: readonly string[],
  stays: (real: string) => boolean,
): Promise<
  { readonly absolute: string; readonly exists: boolean } | "link" | "leaves"
> {
  let reached = start;
  let index = 0;
  for (; index < parts.length; index += 1) {
    const candidate = join(reached, parts[index] as string);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      const entry = await lstat(candidate).catch(() => undefined);
      if (entry?.isSymbolicLink()) return "link";
      break;
    }
    if (!stays(real)) return "leaves";
    reached = real;
  }
  const absolute = join(reached, ...parts.slice(index));
  const exists =
    index === parts.length &&
    (await stat(absolute).then(
      (status) => status.isFile(),
      () => false,
    ));
  return { absolute, exists };
}

/**
 * Where a file a tool writes really goes, from a workspace-relative path, or
 * why it cannot go there. `..` is taken away by name first, as Windows does
 * before it follows any link. Then each part that exists is followed through
 * links: one that leads out of the folder refuses the path, and so does a
 * link whose target is missing, since what appears there could be anywhere.
 * The parts still missing are made where the last one that exists really is,
 * so the place given is the real one and a write there follows no link. A
 * path with a colon is refused: `C:name` names a drive's current folder,
 * whichever drive the workspace is on, and `name:stream` a hidden part of a
 * file, never the file the path reads as.
 */
export async function placeForWriting(
  root: string,
  path: string,
): Promise<Placed> {
  if (isAbsolute(path)) return { kind: "outside" };
  if (path.includes(":")) return { kind: "colon" };
  const parts = namedParts(path);
  if (!parts) return { kind: "outside" };
  if (parts === "reserved") return { kind: "reserved" };
  const realRoot = await realpath(root);
  const place = await followed(realRoot, parts, (real) =>
    realStaysInside(realRoot, real),
  );
  if (typeof place === "string") return { kind: "outside" };
  return {
    kind: "writable",
    absolute: place.absolute,
    relative: relative(realRoot, place.absolute).split(sep).join("/"),
    exists: place.exists,
  };
}

export type PlacedOutside =
  | {
      readonly kind: "writable";
      /** Where the file really is, or will be, with links resolved. */
      readonly absolute: string;
      readonly inside: false;
      /** Whether a file is there already, to be replaced. */
      readonly exists: boolean;
    }
  | {
      readonly kind: "writable";
      readonly absolute: string;
      /** The path leads into the workspace after all. */
      readonly inside: true;
      /** That place from the workspace's real folder, with forward slashes. */
      readonly relative: string;
      readonly exists: boolean;
    }
  | {
      readonly kind:
        "not-absolute" | "colon" | "reserved" | "link" | "protected";
    };

/**
 * Where a file a tool is to write at an absolute path really goes, for a
 * write outside the workspace the person approves. It is placed by the same
 * rule as one inside: `..` by name, each part through links, never through a
 * link whose target is missing, and no colon past the drive. A path that
 * leads into the workspace is said to. A place inside one of `protect`,
 * Zhiyin's own folders, is refused whatever the person would approve: a write
 * there could change Zhiyin's own records, such as what was approved.
 */
export async function placeOutside(
  root: string,
  path: string,
  options: { readonly protect?: readonly string[] } = {},
): Promise<PlacedOutside> {
  if (!isAbsolute(path)) return { kind: "not-absolute" };
  const drive = parse(path).root;
  if (
    !drive ||
    !/^([A-Za-z]:[\\/]|[\\/]{2}[^\\/:]+[\\/][^\\/:]+[\\/]?)/.test(drive)
  )
    return { kind: "not-absolute" };
  if (path.slice(drive.length).includes(":")) return { kind: "colon" };
  const parts = namedParts(path.slice(drive.length));
  if (!parts) return { kind: "not-absolute" };
  if (parts === "reserved") return { kind: "reserved" };
  const realDrive = await realpath(drive).catch(() => undefined);
  if (!realDrive) return { kind: "link" };
  const place = await followed(realDrive, parts, () => true);
  if (typeof place === "string") return { kind: "link" };
  for (const own of options.protect ?? []) {
    const realOwn = await realpath(own).catch(() => resolve(own));
    if (
      realStaysInside(realOwn, place.absolute) ||
      staysInside(realOwn, place.absolute)
    )
      return { kind: "protected" };
  }
  const realRoot = await realpath(root).catch(() => undefined);
  if (realRoot && realStaysInside(realRoot, place.absolute))
    return {
      kind: "writable",
      absolute: place.absolute,
      inside: true,
      relative: relative(realRoot, place.absolute).split(sep).join("/"),
      exists: place.exists,
    };
  return {
    kind: "writable",
    absolute: place.absolute,
    inside: false,
    exists: place.exists,
  };
}
