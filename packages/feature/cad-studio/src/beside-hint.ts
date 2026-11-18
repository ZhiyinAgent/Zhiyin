/**
 * Code given to a build runs from the workspace's top folder and imports the
 * files there, so it cannot import a module kept in a folder below. When that
 * is why it failed, the answer says where the module is and how to build
 * beside it.
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Folders never searched: tools' own and hidden ones. */
const skipped = new Set(["node_modules", "__pycache__", "venv"]);
/** How deep, and through how many folders, the search goes. */
const deepest = 3;
const mostFolders = 500;

export async function besideHint(
  root: string,
  failed: string,
): Promise<string | undefined> {
  const missing = /ModuleNotFoundError: No module named '([A-Za-z_]\w*)'/.exec(
    failed,
  )?.[1];
  if (!missing) return undefined;
  const folder = await folderHolding(root, `${missing}.py`);
  if (folder === undefined) return undefined;
  const where = relative(root, folder).replaceAll("\\", "/");
  return `${missing}.py is in ${where}: code runs from the workspace's top folder, so write this script into ${where} and build it with file, where the files beside it import.`;
}

/** The nearest folder below the root holding the file, level by level. */
async function folderHolding(
  root: string,
  name: string,
): Promise<string | undefined> {
  let level = [root];
  let seen = 0;
  for (let depth = 0; depth <= deepest && level.length; depth++) {
    const next: string[] = [];
    for (const folder of level) {
      if (++seen > mostFolders) return undefined;
      const entries = await readdir(folder, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (entry.isFile() && entry.name === name && folder !== root)
          return folder;
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !skipped.has(entry.name)
        )
          next.push(join(folder, entry.name));
      }
    }
    level = next;
  }
  return undefined;
}
