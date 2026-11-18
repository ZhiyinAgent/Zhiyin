import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import {
  locateInside,
  placeForWriting,
  placeOutside,
  placementRefusal,
  realStaysInside,
} from "@zhiyin/workspace-containment";
import { contentDigest } from "@zhiyin/files";

export type Refusal = {
  readonly reason: string;
  /** The model can correct this itself; leaving the workspace never is. */
  readonly correctable: boolean;
};

export const kinds = {
  scene: [".blend"],
  picture: [
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".tif",
    ".tiff",
    ".bmp",
    ".exr",
    ".hdr",
  ],
  surroundings: [".hdr", ".exr", ".png", ".jpg", ".jpeg"],
  model: [
    ".glb",
    ".gltf",
    ".obj",
    ".stl",
    ".ply",
    ".fbx",
    ".usd",
    ".usda",
    ".usdc",
    ".usdz",
  ],
  drawing: [".svg"],
  font: [".ttf", ".otf", ".ttc"],
  render: [".png", ".jpg", ".jpeg"],
  video: [".mp4"],
  motion: [".json"],
  // One file each: a .gltf would also write its data and pictures beside it.
  export: [
    ".glb",
    ".stl",
    ".obj",
    ".fbx",
    ".usd",
    ".usda",
    ".usdc",
    ".usdz",
    ".ply",
  ],
} as const;

function kindRefusal(path: string, allowed: readonly string[], what: string) {
  return allowed.includes(extname(path).toLowerCase())
    ? undefined
    : {
        reason: `${what} must be one of ${allowed.join(", ")}, and ${path} is not.`,
        correctable: true,
      };
}

/** A workspace file a tool reads, with links resolved, or why it cannot be read. */
export async function readable(
  root: string,
  path: unknown,
  allowed: readonly string[],
  what: string,
): Promise<{ readonly absolute: string } | Refusal> {
  if (typeof path !== "string" || !path.trim())
    return {
      reason: `${what} needs a workspace-relative path.`,
      correctable: true,
    };
  const wrongKind = kindRefusal(path, allowed, what);
  if (wrongKind) return wrongKind;
  const located = await locateInside(root, path);
  switch (located.kind) {
    case "found":
      return { absolute: located.path };
    case "outside":
      return {
        reason: `${path} is outside the workspace.`,
        correctable: false,
      };
    case "missing":
      return {
        reason: `${path} does not exist in the workspace.`,
        correctable: true,
      };
    case "not-a-file":
      return {
        reason: `${path} is not a file.`,
        correctable: true,
      };
    default:
      return { reason: `${path} could not be read.`, correctable: false };
  }
}

/** A font from the workspace, or one of Windows' own by its file name. */
export async function font(
  root: string,
  path: unknown,
): Promise<{ readonly absolute: string } | Refusal> {
  const inWorkspace = await readable(root, path, kinds.font, "A font");
  if ("absolute" in inWorkspace || typeof path !== "string") return inWorkspace;
  if (/[\\/]/.test(path) || inWorkspace.correctable === false)
    return inWorkspace;
  const installed = join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "Fonts",
    path,
  );
  const found = await stat(installed).then(
    (status) => status.isFile(),
    () => false,
  );
  return found
    ? { absolute: installed }
    : {
        reason: `${path} is neither in the workspace nor among Windows' fonts.`,
        correctable: true,
      };
}

/**
 * A workspace file a tool writes. Its folder is made if it is missing, and
 * neither the folder nor an existing file may lead out through a link.
 */
export async function writable(
  root: string,
  path: unknown,
  allowed: readonly string[],
  what: string,
): Promise<
  | {
      readonly absolute: string;
      readonly relative: string;
      readonly exists: boolean;
    }
  | Refusal
> {
  if (typeof path !== "string" || !path.trim())
    return {
      reason: `${what} needs a workspace-relative path.`,
      correctable: true,
    };
  const wrongKind = kindRefusal(path, allowed, what);
  const placed = await placeForWriting(root, path);
  if (placed.kind !== "writable") return placementRefusal(path, placed.kind);
  if (wrongKind) return wrongKind;
  return {
    absolute: placed.absolute,
    relative: placed.relative,
    exists: placed.exists,
  };
}

/** A file a tool writes, in the workspace or, approved by its real path, outside it. */
export type Written = {
  readonly absolute: string;
  /** Its workspace-relative path, or its whole real path outside the workspace. */
  readonly relative: string;
  readonly exists: boolean;
  /** Outside the workspace: Blender writes it elsewhere and Zhiyin moves it here. */
  readonly outside?: true;
  /** What the file there was when the call was approved, for one outside. */
  readonly digest?: string;
};

/**
 * A file a tool writes from its output path: a relative path is the
 * workspace's, and a whole path may lead outside it, where the person approves
 * the real place (ADR 0012). Zhiyin's own folders are never written.
 */
export async function writableOutput(
  root: string,
  path: unknown,
  allowed: readonly string[],
  what: string,
  protect: readonly string[],
): Promise<Written | Refusal> {
  if (typeof path !== "string" || !isAbsolute(path))
    return writable(root, path, allowed, what);
  const placed = await placeOutside(root, path, { protect });
  if (placed.kind === "not-absolute")
    return writable(root, path, allowed, what);
  if (placed.kind !== "writable") return placementRefusal(path, placed.kind);
  const wrongKind = kindRefusal(path, allowed, what);
  if (wrongKind) return wrongKind;
  if (placed.inside)
    return {
      absolute: placed.absolute,
      relative: placed.relative,
      exists: placed.exists,
    };
  if ((await stat(placed.absolute).catch(() => undefined))?.isDirectory())
    return {
      reason: `${placed.absolute} is a folder. Name a file to write.`,
      correctable: true,
    };
  return {
    absolute: placed.absolute,
    relative: placed.absolute,
    exists: placed.exists,
    outside: true,
    ...(placed.exists
      ? {
          digest: (await contentDigest(placed.absolute)) ?? "unreadable",
        }
      : {}),
  };
}

/**
 * An open scene file as a workspace has it, or nothing when it is not in that
 * workspace, as when the conversation's folder changed since it was opened.
 */
export async function sceneIn(
  root: string,
  absolute: string,
): Promise<string | undefined> {
  const realRoot = await realpath(root).catch(() => undefined);
  // The scene was placed from the real workspace folder when it was opened,
  // so the two compare exactly.
  if (!realRoot || !realStaysInside(realRoot, absolute)) return undefined;
  return relative(realRoot, absolute).split(sep).join("/");
}

/** Makes the folder a written file goes in, inside the workspace. */
export const folderFor = (absolute: string) =>
  mkdir(dirname(absolute), { recursive: true });
