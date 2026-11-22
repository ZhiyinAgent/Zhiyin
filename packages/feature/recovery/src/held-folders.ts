/**
 * The folders on the way to a file, held while recovery writes, renames or
 * deletes there, so none can be swapped for a junction or a symbolic link
 * meanwhile.
 *
 * Each folder from the workspace down to the file's own is opened by
 * itself, a link opened as the link, never followed, with a handle that lets
 * others read and write in it but not rename or delete it; Windows then
 * refuses to rename or delete any of them, or a folder above, until the
 * handles are let go of. Each is checked on its handle: a real folder, no
 * link, which Windows names, every link resolved, as the folder above it
 * and its own name. Only then is anything written there, by its path, which
 * so names the folders checked. A folder still to be made is made in the
 * folder above it, already held, then held and checked the same way.
 */

import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { windowsFiles } from "@zhiyin/sandbox";
import { staysInside } from "@zhiyin/workspace-containment";

/** Reading a folder's entries: an access Windows checks others' sharing against. */
const FILE_LIST_DIRECTORY = 0x00000001;
const FILE_READ_ATTRIBUTES = 0x00000080;
/** Others may read and write in it; none may rename or delete it. */
const FILE_SHARE_READ_WRITE = 0x00000003;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;

/** The folders held, until let go of; or why they were not. */
export type HeldFolders =
  | { readonly ok: true; release(): void }
  | {
      readonly ok: false;
      /**
       * `link` when a link stood on the way, or a folder was not where it was
       * named; `missing` when the folder to begin from is not there; `busy`
       * when another program kept a folder from being held.
       */
      readonly why: "link" | "missing" | "busy";
    };

type Failed = Extract<HeldFolders, { readonly ok: false }>;

const same = (one: string, other: string) =>
  one.toLowerCase() === other.toLowerCase();

/**
 * Holds the folders on the way to each of `paths` from `root`, or, for a
 * path outside it, from its drive's root; the folders `make` names a path
 * for are made where missing. The root itself is held where it really is.
 */
export async function holdFolders(
  root: string,
  paths: readonly string[],
  make: (path: string) => boolean = () => false,
): Promise<HeldFolders> {
  const windows = windowsFiles();
  const handles: unknown[] = [];
  /** Each folder held, by its path lowercased, with where Windows says it is. */
  const held = new Map<string, string>();
  const release = () => {
    for (const handle of handles.splice(0)) windows.close(handle);
  };
  const open = (path: string, itself: boolean) =>
    windows.open(
      path,
      FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ_WRITE,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | (itself ? FILE_FLAG_OPEN_REPARSE_POINT : 0),
    );
  /** Holds one folder; where Windows says it is, or why it was not held. */
  const hold = async (
    path: string,
    expected: string,
    itself: boolean,
    making: boolean,
  ): Promise<string | Pick<Failed, "why">> => {
    const known = held.get(path.toLowerCase());
    if (known) return known;
    const missing = (opened: typeof opening) =>
      "error" in opened &&
      (opened.error === ERROR_FILE_NOT_FOUND ||
        opened.error === ERROR_PATH_NOT_FOUND);
    let opening = open(path, itself);
    if (missing(opening) && making) {
      // Made in the folder above, which is held: it cannot lead elsewhere.
      await mkdir(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      opening = open(path, itself);
    }
    if (!opening.handle) return { why: missing(opening) ? "missing" : "busy" };
    handles.push(opening.handle);
    const entry = windows.entryOf(opening.handle);
    if ("error" in entry || !entry.folder || entry.link) return { why: "link" };
    const real = windows.finalPath(opening.handle);
    if (real === undefined || !same(real, expected)) return { why: "link" };
    held.set(path.toLowerCase(), real);
    return real;
  };
  try {
    for (const path of paths) {
      const base = staysInside(root, path) ? root : parse(path).root;
      const realBase = await realpath(base).catch(() => undefined);
      if (realBase === undefined) {
        release();
        return { ok: false, why: "missing" };
      }
      let at = base;
      let real = await hold(base, realBase, false, false);
      for (const part of relative(base, dirname(path))
        .split(/[\\/]/)
        .filter(Boolean)) {
        if (typeof real !== "string") break;
        at = join(at, part);
        real = await hold(at, join(real, part), true, make(path));
      }
      if (typeof real !== "string") {
        release();
        return { ok: false, why: real.why };
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return { ok: true, release };
}
