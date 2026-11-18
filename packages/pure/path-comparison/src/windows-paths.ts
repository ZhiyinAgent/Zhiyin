/**
 * Windows paths compared as Windows compares them, by their names alone:
 * whatever their case, with either slash, with `.` and `..` steps worked out,
 * and a trailing separator naming the same folder. Nothing here looks at the
 * disk, so a link is not followed: a check that must hold after links are
 * resolved makes this comparison again on the resolved paths.
 */

/** The root a path starts from, as written, and the rest of it. */
function rootOf(path: string): {
  readonly root: string;
  readonly rest: string;
} {
  const unc = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/.exec(path);
  if (unc)
    return {
      root: `\\\\${unc[1]}\\${unc[2]}\\`,
      rest: path.slice(unc[0].length),
    };
  const drive = /^([a-zA-Z]:)(\\?)/.exec(path);
  if (drive)
    return {
      root: `${drive[1]}${drive[2]}`,
      rest: path.slice(drive[0].length),
    };
  if (path.startsWith("\\")) return { root: "\\", rest: path.slice(1) };
  return { root: "", rest: path };
}

/**
 * A path in the one spelling every spelling of it shares: backslashes,
 * lower case, steps worked out, and no trailing separator but a root's. A
 * `..` never climbs above a root. A name that only starts with two dots is a
 * name like any other.
 */
export function folderKey(path: string): string {
  const { root, rest } = rootOf(path.replace(/\//g, "\\"));
  const steps: string[] = [];
  for (const step of rest.split(/\\+/)) {
    if (step === "" || step === ".") continue;
    if (step !== "..") steps.push(step);
    else if (steps.length && steps.at(-1) !== "..") steps.pop();
    else if (!root) steps.push(step);
  }
  const key = `${root}${steps.join("\\")}`;
  return (key || ".").toLowerCase();
}

/** Whether two spellings name the same folder. */
export function sameFolder(one: string, other: string): boolean {
  return folderKey(one) === folderKey(other);
}

/** Whether `path` is `folder` or lies below it. Both are absolute paths. */
export function inside(folder: string, path: string): boolean {
  const outer = folderKey(folder);
  const inner = folderKey(path);
  return (
    inner === outer ||
    inner.startsWith(outer.endsWith("\\") ? outer : `${outer}\\`)
  );
}

/** Whether `path` lies below `folder`, and is not `folder` itself. */
export function below(folder: string, path: string): boolean {
  return inside(folder, path) && !sameFolder(folder, path);
}
