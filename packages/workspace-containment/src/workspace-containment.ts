/**
 * The containment rule every feature that reads or writes the person's folder
 * depends on, in one place. A second copy is a second boundary to keep in step
 * with the first.
 *
 * It is settled twice: lexically, before anything is read, so a request that
 * could escape is never presented; and again after links are resolved, so a
 * path that leads out through a link still does not reach what is outside.
 */

import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Whether `target` is `root` or something inside it, by the path alone. */
export function staysInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/** Whether `target` is inside `root` and not `root` itself, by the path alone. */
export function staysBelow(root: string, target: string): boolean {
  return relative(root, target) !== "" && staysInside(root, target);
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
    if (!staysInside(realRoot, target)) return { kind: "outside" };
    if (!(await stat(target)).isFile()) return { kind: "not-a-file" };
    return { kind: "found", path: target };
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }
}
