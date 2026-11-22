/**
 * A folder's files kept up to date from the drive's change journal, so a
 * folder is walked whole once and then only where the journal says something
 * changed: each file it names changed is looked at again, each folder that
 * gained or lost an entry is read again, and each folder that appeared is
 * walked. A listing with nothing changed costs one read of the journal.
 *
 * The journal names changes by file identity only (see `change-journal`),
 * so the index keeps each listed file's and folder's identity, and asks
 * about those. When the journal cannot answer, as on a drive that keeps
 * none, after it was reset, or when the folder itself was renamed, the
 * folder is walked whole again. Each answer is a map of its own, never
 * changed afterwards.
 */

import {
  journalChanges,
  journalPoint,
  type JournalPoint,
} from "./change-journal.js";

/**
 * A file as a listing gives it: its identity on its drive, as a decimal
 * string, and, for a junction or symbolic link, what it names.
 */
type ListedFile = { readonly id?: string; readonly link?: string };

/** Part of a folder to list, each by its path from the folder. */
export type FolderPart = {
  /** Each entry by itself. */
  readonly entries: readonly string[];
  /** The entries directly in each folder. */
  readonly entriesOf: readonly string[];
  /** Everything in each folder. */
  readonly wholeOf: readonly string[];
};

/**
 * A folder's files, by their path from it with forward slashes, and the
 * folders listed with their identities, "" for the folder itself.
 */
export type FolderListing<File extends ListedFile> =
  | {
      readonly ok: true;
      readonly files: ReadonlyMap<string, File>;
      readonly folders?: ReadonlyMap<string, string>;
    }
  | { readonly ok: false; readonly reason: string };

/** Lists a folder whole, or only part of it. */
export type ListFolder<File extends ListedFile> = (
  root: string,
  part?: FolderPart,
) => Promise<FolderListing<File>>;

/** Where a drive's change journal stands, and what changed since a point. */
export type FolderJournal = {
  readonly point: typeof journalPoint;
  readonly changes: typeof journalChanges;
};

const windowsJournal: FolderJournal = {
  point: journalPoint,
  changes: journalChanges,
};

const USN_REASON_FILE_DELETE = 0x200;
const USN_REASON_HARD_LINK_CHANGE = 0x10000;
const USN_REASON_RENAME_OLD_NAME = 0x1000;
const USN_REASON_RENAME_NEW_NAME = 0x2000;
const USN_REASON_REPARSE_POINT_CHANGE = 0x100000;
/** Reasons after which an entry's name or kind is no longer what was listed. */
const placeReasons =
  USN_REASON_FILE_DELETE |
  USN_REASON_HARD_LINK_CHANGE |
  USN_REASON_RENAME_OLD_NAME |
  USN_REASON_RENAME_NEW_NAME |
  USN_REASON_REPARSE_POINT_CHANGE;

/**
 * The most folders indexed at once, each holding its whole listing in
 * memory; one let go of is walked whole again when next asked for.
 */
const keptFolders = 8;

type Indexed<File extends ListedFile> = {
  readonly files: ReadonlyMap<string, File>;
  /** Each folder walked, by its path, "" for the folder itself, with its identity. */
  readonly folders: ReadonlyMap<string, string>;
  /** Each identity the journal is asked about, with the paths it has. */
  readonly byId: ReadonlyMap<string, readonly string[]>;
  readonly folderById: ReadonlyMap<string, string>;
  readonly interest: ReadonlySet<string>;
  readonly point: JournalPoint;
  readonly links: ReadonlyMap<string, string>;
};

const parentOf = (path: string) => {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
};
const isUnder = (folder: string, path: string) =>
  folder === "" || path.startsWith(`${folder}/`);

function indexed<File extends ListedFile>(
  files: ReadonlyMap<string, File>,
  folders: ReadonlyMap<string, string>,
  point: JournalPoint,
): Indexed<File> {
  const byId = new Map<string, string[]>();
  const links = new Map<string, string>();
  for (const [path, file] of files) {
    if (file.id !== undefined) {
      const paths = byId.get(file.id);
      if (paths) paths.push(path);
      else byId.set(file.id, [path]);
    }
    if (file.link !== undefined) links.set(path, file.link);
  }
  const folderById = new Map<string, string>();
  for (const [path, id] of folders) folderById.set(id, path);
  return {
    files,
    folders,
    byId,
    folderById,
    interest: new Set([...byId.keys(), ...folderById.keys()]),
    point,
    links,
  };
}

export class FolderIndex<File extends ListedFile> {
  readonly #list: ListFolder<File>;
  readonly #journal: FolderJournal;
  readonly #folders = new Map<string, Indexed<File>>();
  readonly #serial = new Map<string, Promise<unknown>>();

  /**
   * `list` lists a folder whole, or the part asked for, with the identity of
   * each file and folder, never following a link; a listing without folders
   * is never kept, and the folder is listed whole each time.
   */
  constructor(list: ListFolder<File>, journal: FolderJournal = windowsJournal) {
    this.#list = list;
    this.#journal = journal;
  }

  /** The folder's files as they are now: walked where they changed, whole when the journal cannot say. */
  listing(root: string): Promise<FolderListing<File>> {
    return this.#one(root, async () => {
      const found = await this.#current(root);
      if (!found.ok) return found;
      return {
        ok: true,
        files: found.files,
        ...(found.folders ? { folders: found.folders } : {}),
      };
    });
  }

  /**
   * Each junction and symbolic link in the folder, by its path, as the
   * listing describes it: its kind and target. Kept from one call to the
   * next with the rest of the listing, so a call with nothing changed costs
   * one read of the journal.
   */
  links(
    root: string,
  ): Promise<
    | { readonly ok: true; readonly links: ReadonlyMap<string, string> }
    | { readonly ok: false; readonly reason: string }
  > {
    return this.#one(root, async () => {
      const found = await this.#current(root);
      if (!found.ok) return found;
      if (found.links) return { ok: true, links: found.links };
      const links = new Map<string, string>();
      for (const [path, file] of found.files)
        if (file.link !== undefined) links.set(path, file.link);
      return { ok: true, links };
    });
  }

  /** Forgets what was listed of the folder. */
  forget(root: string): void {
    this.#folders.delete(root.toLowerCase());
  }

  /** Runs one listing of a folder at a time, in order. */
  #one<T>(root: string, work: () => Promise<T>): Promise<T> {
    const key = root.toLowerCase();
    const next = (this.#serial.get(key) ?? Promise.resolve()).then(work, work);
    this.#serial.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  async #current(root: string): Promise<
    | {
        readonly ok: true;
        readonly files: ReadonlyMap<string, File>;
        readonly folders?: ReadonlyMap<string, string>;
        readonly links?: ReadonlyMap<string, string>;
      }
    | { readonly ok: false; readonly reason: string }
  > {
    const key = root.toLowerCase();
    const point = this.#journal.point(root);
    const known = this.#folders.get(key);
    this.#folders.delete(key);
    if (point && known) {
      const updated = await this.#update(root, known);
      if (updated) {
        this.#keep(key, updated);
        return { ok: true, ...updated };
      }
    }
    const listing = await this.#list(root);
    if (!listing.ok || !point || !listing.folders) return listing;
    const fresh = indexed(listing.files, listing.folders, point);
    this.#keep(key, fresh);
    return { ok: true, ...fresh };
  }

  /** Keeps a folder's index, letting go of the one used longest ago past the most kept. */
  #keep(key: string, index: Indexed<File>): void {
    this.#folders.set(key, index);
    for (const oldest of this.#folders.keys()) {
      if (this.#folders.size <= keptFolders) break;
      this.#folders.delete(oldest);
    }
  }

  /** The index brought up to date from the journal, or nothing when it cannot be. */
  async #update(
    root: string,
    known: Indexed<File>,
  ): Promise<Indexed<File> | undefined> {
    const answer = this.#journal.changes(root, known.point, known.interest);
    if (!answer.ok) return undefined;
    const point = answer.next;
    if (!answer.changed.size && !answer.arrived.size && !answer.reparse.size)
      return { ...known, point };
    const files = new Map(known.files);
    const folders = new Map(known.folders);
    /** Folders whose entries are read again. */
    const reread = new Set<string>();
    /** Files looked at again by themselves. */
    const again = new Set<string>();
    const drop = (folder: string) => {
      for (const path of [...folders.keys()])
        if (path === folder || isUnder(folder, path)) folders.delete(path);
      for (const path of [...files.keys()])
        if (isUnder(folder, path)) files.delete(path);
    };
    /** Where an entry renamed or moved within the folder went is read again. */
    const movedTo = (id: string) => {
      const parent = answer.moved.get(id);
      const folder =
        parent === undefined ? undefined : known.folderById.get(parent);
      if (folder !== undefined) reread.add(folder);
    };
    for (const [id, reasons] of answer.changed) {
      const folder = known.folderById.get(id);
      if (folder !== undefined) {
        if (!(reasons & placeReasons)) continue;
        // The folder itself renamed, deleted or made a link: walked whole.
        if (folder === "") return undefined;
        drop(folder);
        reread.add(parentOf(folder));
        movedTo(id);
        continue;
      }
      for (const path of known.byId.get(id) ?? []) {
        if (reasons & placeReasons) {
          files.delete(path);
          reread.add(parentOf(path));
          movedTo(id);
        } else again.add(path);
      }
    }
    for (const [, parent] of answer.arrived) {
      const folder = known.folderById.get(parent);
      if (folder !== undefined) reread.add(folder);
    }
    for (const [id, parent] of answer.reparse) {
      if (known.interest.has(id)) continue;
      const folder = known.folderById.get(parent);
      if (folder !== undefined) reread.add(folder);
    }
    const entriesOf = [...reread].filter((folder) => folders.has(folder));
    const entries = [...again].filter(
      (path) => !reread.has(parentOf(path)) && folders.has(parentOf(path)),
    );
    const part: FolderPart = { entries, entriesOf, wholeOf: [] };
    const found = await this.#list(root, part);
    if (!found.ok || !found.folders) return undefined;
    for (const path of entries) {
      const file = found.files.get(path);
      if (file) files.set(path, file);
      else files.delete(path);
    }
    const read = new Set(entriesOf);
    for (const path of [...files.keys()])
      if (read.has(parentOf(path))) files.delete(path);
    for (const [path, file] of found.files)
      if (read.has(parentOf(path))) files.set(path, file);
    // A folder no longer there goes with all it held; one new, or another
    // folder now under the same name, is walked whole.
    const fresh: string[] = [];
    for (const path of [...folders.keys()])
      if (
        path !== "" &&
        read.has(parentOf(path)) &&
        found.folders.get(path) !== folders.get(path)
      )
        drop(path);
    for (const [path, id] of found.folders)
      if (path !== "" && !folders.has(path)) {
        folders.set(path, id);
        fresh.push(path);
      }
    if (fresh.length) {
      const walked = await this.#list(root, {
        entries: [],
        entriesOf: [],
        wholeOf: fresh,
      });
      if (!walked.ok || !walked.folders) return undefined;
      for (const [path, file] of walked.files) files.set(path, file);
      for (const [path, id] of walked.folders) folders.set(path, id);
    }
    return indexed(files, folders, point);
  }
}
