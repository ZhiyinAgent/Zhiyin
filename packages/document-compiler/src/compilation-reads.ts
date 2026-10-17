import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { staysBelow } from "@zhiyin/workspace-containment";

/**
 * A file a compilation read outside the workspace folder: by a link from a
 * path inside it, or named outside it outright.
 */
export type ReadOutside = {
  /** Relative to the workspace when named inside it; as written otherwise. */
  readonly path: string;
  readonly throughLink: boolean;
};

/** Where a file named inside the workspace really is, when it exists. */
async function leadsOutside(root: string, named: string): Promise<boolean> {
  const real = await realpath(named).catch(() => undefined);
  return real !== undefined && !staysBelow(root, real);
}

/**
 * The first file a Typst compilation read in the workspace that a link
 * carries out of it; "unknown" when the list of what it read is missing or
 * cannot be read. Typst names files outside the workspace only for its own
 * packages: `--root` keeps a document from naming any.
 */
export async function typstReadOutside(
  list: string,
  root: string,
): Promise<ReadOutside | "unknown" | undefined> {
  let inputs: unknown;
  try {
    inputs = (JSON.parse(await readFile(list, "utf8")) as { inputs?: unknown })
      .inputs;
  } catch {
    return "unknown";
  }
  if (!Array.isArray(inputs)) return "unknown";
  for (const input of inputs) {
    if (typeof input !== "string") return "unknown";
    // Typst names files in Windows' long form.
    const named = input.startsWith("\\\\?\\UNC\\")
      ? `\\\\${input.slice(8)}`
      : input.startsWith("\\\\?\\")
        ? input.slice(4)
        : input;
    if (!staysBelow(root, named)) continue;
    if (await leadsOutside(root, named))
      return { path: relative(root, named), throughLink: true };
  }
  return undefined;
}

/**
 * A name as Windows opens it, which drops each part's trailing dots and
 * spaces: `secret.txt.` opens `secret.txt`. Nothing when a part is dots and
 * spaces alone but not `.` or `..`, whose meaning is not worth guessing.
 */
function asWindowsOpens(name: string): string | undefined {
  const parts = name.split(/([\\/])/);
  for (const [index, part] of parts.entries()) {
    if (index % 2 || part === "." || part === "..") continue;
    if (/^[. ]+$/.test(part)) return undefined;
    parts[index] = part.replace(/[. ]+$/, "");
  }
  return parts.join("");
}

/**
 * The first file a Tectonic compilation read from disk outside the workspace,
 * named so or carried there by a link; "unknown" when the list of what it
 * read is missing or not as Tectonic writes it, or names a file that cannot
 * be found where Windows would have opened it.
 *
 * Tectonic lists, as make rules for the PDF, only the files it read from
 * disk, never the TeX packages it keeps itself. One file is named a line,
 * spaces left as they are. A file named by a whole path is listed as named;
 * one named relatively, behind the folder the PDF is written in, and is
 * looked for beside the source and in the workspace, so both are checked.
 */
export async function tectonicReadOutside(
  list: string,
  places: {
    readonly root: string;
    readonly pdf: string;
    readonly outdir: string;
    readonly sourceFolder: string;
  },
): Promise<ReadOutside | "unknown" | undefined> {
  let rules: string;
  try {
    rules = await readFile(list, "utf8");
  } catch {
    return "unknown";
  }
  const head = `${places.pdf} : `;
  if (!rules.startsWith(head)) return "unknown";
  const names = rules
    .slice(head.length)
    .replace(/\r?\n$/, "")
    .split(/ \\\r?\n/)
    .map((line) => line.replace(/^ +/, ""));
  const behind = `${places.outdir}\\`;
  for (const listed of names) {
    if (!listed) return "unknown";
    const name = asWindowsOpens(listed);
    if (name === undefined) return "unknown";
    if (listed.startsWith(behind)) {
      const written = name.slice(behind.length);
      // Tectonic lists only what it opened, so one of the two is there.
      let found = false;
      for (const candidate of [
        resolve(places.sourceFolder, written),
        resolve(places.root, written),
      ]) {
        const real = await realpath(candidate).catch(() => undefined);
        if (real === undefined) continue;
        found = true;
        if (staysBelow(places.root, real)) continue;
        return staysBelow(places.root, candidate)
          ? { path: relative(places.root, candidate), throughLink: true }
          : { path: candidate, throughLink: false };
      }
      if (!found) return "unknown";
    } else if (isAbsolute(name)) {
      const named = resolve(name);
      if (!staysBelow(places.root, named))
        return { path: listed, throughLink: false };
      const real = await realpath(named).catch(() => undefined);
      if (real === undefined) return "unknown";
      if (!staysBelow(places.root, real))
        return { path: relative(places.root, named), throughLink: true };
    } else return "unknown";
  }
  return undefined;
}
