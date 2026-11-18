import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** The most Python files a script's folder may hold and still be copied into a build. */
const mostSources = 2000;
/** Folders Python never imports a script's modules from. */
const notSources = new Set([
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  "node_modules",
]);
/**
 * The files Python can import a module from: source, compiled and native.
 * Only these are taken into a build, so a file of any other kind beside the
 * script can be read by it but never imported.
 */
const importable = [".py", ".pyw", ".pyc", ".pyd", ".so"];

/** Each file a script can import, by its path from the script's folder as it is written there, with its content's digest. */
export type ScriptSources = Readonly<Record<string, string>>;

/**
 * Every file the script can import, in its folder and below, by its path
 * there, with its content's digest; nothing when they cannot be taken as
 * they are: a link anywhere in the folder, which could lead Python
 * elsewhere, a file that cannot be read, or more files than the most kept.
 */
export async function fingerprintOf(
  script: string,
): Promise<ScriptSources | undefined> {
  const folder = dirname(script);
  const found: Record<string, string> = {};
  let count = 0;
  const walk = async (at: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      const name = entry.name.toLowerCase();
      if (entry.isDirectory() && notSources.has(name)) continue;
      // A link or a junction, to a file or a folder, could lead Python elsewhere.
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!(await walk(path))) return false;
      } else if (importable.some((ending) => name.endsWith(ending))) {
        count += 1;
        if (count > mostSources) return false;
        try {
          found[relative(folder, path)] = createHash("sha256")
            .update(await readFile(path))
            .digest("hex");
        } catch {
          return false;
        }
      }
    }
    return true;
  };
  return (await walk(folder)) ? found : undefined;
}
