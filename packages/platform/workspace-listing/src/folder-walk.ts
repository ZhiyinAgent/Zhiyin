/**
 * Every file of a folder, walked entry by entry rather than by ripgrep, so a
 * junction or a symbolic link is seen as itself: it is listed as a link, by
 * its kind and the target it names, and never followed, so nothing it leads
 * to is listed or read. The folders a search skips stay out, as they do from
 * a search, unless every folder is asked for; hidden files are in, and the
 * folder's ignore files are not read.
 */

import { lstat, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import koffi from "koffi";
import type {
  ListedFile,
  ListingPart,
  WorkspaceListing,
} from "@zhiyin/contract";
import { searchesSkip } from "./ripgrep.js";

/** Entries whose size, time and identity are read at once. */
const readAtOnce = 64;

const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003;
/** A reparse point that names another place: a junction or a symbolic link. */
const NAME_SURROGATE = 0x20000000;
/** `WIN32_FIND_DATAW`, whose `dwReserved0` holds a reparse point's tag. */
const findDataBytes = 592;

type Find = {
  readonly first: (path: string, data: Buffer) => unknown;
  readonly close: (handle: unknown) => void;
};

let found: Find | undefined;

function find(): Find {
  if (found) return found;
  const kernel32 = koffi.load("kernel32.dll");
  const FindFirstFileW = kernel32.func(
    "void* FindFirstFileW(const char16_t*, void*)",
  );
  const FindClose = kernel32.func("bool FindClose(void*)");
  found = {
    first: (path, data) => FindFirstFileW(path, data),
    close: (handle) => void FindClose(handle),
  };
  return found;
}

/**
 * What a link at `path` is, read from the entry itself without following
 * it: `junction`, `folder` or `file`, a space, then the target as written.
 * Nothing when the entry is no junction or symbolic link, or is not there.
 */
export async function linkAt(path: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  const data = Buffer.alloc(findDataBytes);
  const handle = find().first(path, data);
  if (!handle || koffi.address(handle) === BigInt.asUintN(64, -1n))
    return undefined;
  find().close(handle);
  const attributes = data.readUInt32LE(0);
  const tag = data.readUInt32LE(36);
  if (!(attributes & FILE_ATTRIBUTE_REPARSE_POINT) || !(tag & NAME_SURROGATE))
    return undefined;
  const target = await readlink(path).catch(() => undefined);
  if (target === undefined) return undefined;
  const kind =
    tag === IO_REPARSE_TAG_MOUNT_POINT
      ? "junction"
      : attributes & FILE_ATTRIBUTE_DIRECTORY
        ? "folder"
        : "file";
  return `${kind} ${target}`;
}

/** A folder or file as one entry of a listing finds it, or nothing for anything else. */
type Found =
  { readonly folder: string } | { readonly file: ListedFile } | undefined;

/** Which folders a walk leaves out, by name. */
type Skipped = (name: string) => boolean;

/**
 * What the entry at `full` is, looked at by itself and never followed; a
 * folder `skipped` names is nothing.
 */
async function entryAt(
  full: string,
  name: string,
  skipped: Skipped,
): Promise<Found> {
  const info = await lstat(full, { bigint: true }).catch(() => undefined);
  if (!info) return undefined;
  const listed = {
    size: Number(info.size),
    modified: Number(info.mtimeNs) / 1e6,
    id: String(info.ino),
  };
  if (info.isSymbolicLink()) {
    const link =
      (await linkAt(full)) ?? `file ${await readlink(full).catch(() => "")}`;
    return { file: { ...listed, link } };
  }
  if (info.isDirectory())
    return skipped(name) ? undefined : { folder: String(info.ino) };
  return info.isFile() ? { file: listed } : undefined;
}

/**
 * The identity of the folder at `path` in `root`, when every folder from
 * `root` to it is a folder and none is a link; nothing otherwise.
 */
async function realFolder(
  root: string,
  path: string,
): Promise<string | undefined> {
  let at = root;
  let id: string | undefined;
  for (const part of ["", ...path.split("/").filter(Boolean)]) {
    at = part ? join(at, part) : at;
    const info = await folderInfo(at, !part);
    if (!info) return undefined;
    id = String(info.ino);
  }
  return id;
}

/**
 * The folder at `full`, looked at by itself, or nothing when it is not a
 * folder or is a link. The folder listed itself is the one it names.
 */
async function folderInfo(full: string, isRoot: boolean) {
  const info = await (isRoot ? stat : lstat)(full, { bigint: true }).catch(
    () => undefined,
  );
  return info?.isDirectory() && !info.isSymbolicLink() ? info : undefined;
}

/**
 * The files of `root`, or of `part` of it, each with its size, time of last
 * change and identity, and each folder walked with its identity. A folder
 * is read only while it is a folder reached through no link: one found
 * otherwise once its entries were read, as when it was swapped for a link
 * meanwhile, gives no entries. A folder `part` names that cannot be read
 * makes the whole answer a failure, so the caller lists the folder whole
 * instead. The folders a search skips stay out.
 */
export function walkFolder(
  root: string,
  part?: ListingPart,
): Promise<WorkspaceListing> {
  return walk(root, part, searchesSkip);
}

/**
 * As `walkFolder`, with every folder walked, those a search skips too, as
 * `.git` and `node_modules`: for what must know of every link in a folder.
 */
export function walkEveryFolder(
  root: string,
  part?: ListingPart,
): Promise<WorkspaceListing> {
  return walk(root, part, () => false);
}

async function walk(
  root: string,
  part: ListingPart | undefined,
  skipped: Skipped,
): Promise<WorkspaceListing> {
  const files = new Map<string, ListedFile>();
  const folders = new Map<string, string>();
  const named = (folder: string, name: string) =>
    folder ? `${folder}/${name}` : name;
  const unlisted = (folder: string) =>
    ({
      ok: false,
      reason: folder
        ? `${folder} could not be listed.`
        : "Zhiyin could not list this folder's files.",
    }) as const;
  const pending: {
    readonly folder: string;
    readonly whole: boolean;
    /** Its identity as it was found, or nothing when it is still to be checked. */
    readonly id?: string;
  }[] = part
    ? [
        ...part.entriesOf.map((folder) => ({ folder, whole: false })),
        ...part.wholeOf.map((folder) => ({ folder, whole: true })),
      ]
    : [{ folder: "", whole: true }];
  for (const path of part?.entries ?? []) {
    if (
      !(await realFolder(
        root,
        path.slice(0, Math.max(0, path.lastIndexOf("/"))),
      ))
    )
      return unlisted(path);
    const found = await entryAt(
      join(root, path),
      path.slice(path.lastIndexOf("/") + 1),
      skipped,
    );
    if (found && "file" in found) files.set(path, found.file);
    else if (found) folders.set(path, found.folder);
  }
  while (pending.length) {
    const { folder, whole, id: expected } = pending.pop()!;
    const asked = part && expected === undefined;
    const id = expected ?? (await realFolder(root, folder));
    if (id === undefined) {
      if (asked || !folder) return unlisted(folder);
      continue;
    }
    if (whole) folders.set(folder, id);
    let entries;
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true });
    } catch {
      // A folder asked for by name must be read; one met on the way is
      // left out, as a search leaves out a folder it may not read.
      if (asked || !folder) return unlisted(folder);
      continue;
    }
    const foundFiles: [string, ListedFile][] = [];
    const foundFolders: [string, string][] = [];
    for (let start = 0; start < entries.length; start += readAtOnce)
      await Promise.all(
        entries.slice(start, start + readAtOnce).map(async (entry) => {
          const path = named(folder, entry.name);
          const found = await entryAt(join(root, path), entry.name, skipped);
          if (found && "file" in found) foundFiles.push([path, found.file]);
          else if (found) foundFolders.push([path, found.folder]);
        }),
      );
    // Still the folder found before its entries were read, and no link: a
    // folder above it swapped for a link meanwhile names another one here.
    const after = await folderInfo(join(root, folder), !folder);
    if (!after || String(after.ino) !== id) {
      if (asked || !folder) return unlisted(folder);
      folders.delete(folder);
      continue;
    }
    for (const [path, file] of foundFiles) files.set(path, file);
    for (const [path, found] of foundFolders) {
      folders.set(path, found);
      if (whole) pending.push({ folder: path, whole: true, id: found });
    }
  }
  return { ok: true, files, folders };
}
