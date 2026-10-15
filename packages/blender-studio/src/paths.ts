import { mkdir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { locateInside, staysInside } from "@zhiyin/workspace-containment";

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
    // USD as text only: what a binary USD file reads cannot be checked.
    ".usd",
    ".usda",
  ],
  drawing: [".svg"],
  font: [".ttf", ".otf", ".ttc"],
  render: [".png", ".jpg", ".jpeg"],
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
      return { reason: `${path} is not a file.`, correctable: true };
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
  if (isAbsolute(path) || !staysInside(root, resolve(root, path)))
    return { reason: `${path} is outside the workspace.`, correctable: false };
  const wrongKind = kindRefusal(path, allowed, what);
  if (wrongKind) return wrongKind;
  const realRoot = await realpath(root);
  const target = resolve(realRoot, path);
  let folder = dirname(target);
  while (!(await stat(folder).catch(() => undefined))) folder = dirname(folder);
  const realFolder = await realpath(folder);
  if (!staysInside(realRoot, realFolder))
    return { reason: `${path} is outside the workspace.`, correctable: false };
  const exists = await stat(target).then(
    (status) => status.isFile(),
    () => false,
  );
  const actual = exists
    ? await realpath(target)
    : join(realFolder, relative(folder, target));
  if (!staysInside(realRoot, actual))
    return { reason: `${path} is outside the workspace.`, correctable: false };
  // As the workspace has it: `a/../b.png` and a different letter case name
  // the same file, which the approval and the conversation's files must agree on.
  return {
    absolute: target,
    relative: relative(realRoot, actual).split(sep).join("/"),
    exists,
  };
}

/** Makes the folder a written file goes in, inside the workspace. */
export const folderFor = (absolute: string) =>
  mkdir(dirname(absolute), { recursive: true });
