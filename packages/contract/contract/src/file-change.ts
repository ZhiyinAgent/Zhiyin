import type { DiffSummary } from "./text-diff.js";

/**
 * Exactly what one file would look like before and after an action, as the
 * implementation that would carry it out reports it. The file change and a
 * parent folder it creates are shown as structured effects before approval.
 *
 * A file too large to carry whole in both versions carries the difference
 * instead: the lines that change, with a few around each. A change too large
 * to show even so says so rather than arriving as megabytes of text nobody
 * will read; `omitted` names why.
 */
export type FileChange = {
  readonly path: string;
  /**
   * `recycled` goes to the Recycle Bin, where the person can restore it;
   * `deleted` is gone for good; `moved` leaves this path for `to`.
   */
  readonly change: "created" | "updated" | "recycled" | "deleted" | "moved";
  /** A parent folder the same action will create for this file. */
  readonly createdFolder?: string;
  /** Where a moved file goes, named as its `path` would be there. */
  readonly to?: string;
  /** The file a created one is moved from. */
  readonly from?: string;
  /** Absent when the file does not exist yet. */
  readonly before?: string;
  /** Absent when the change is too large to carry. */
  readonly after?: string;
  /**
   * The difference itself, in place of `before` and `after`, when the two
   * versions are too large to carry together and the change is not.
   */
  readonly diff?: DiffSummary;
  /** Why the contents are not here, when they are not. */
  readonly omitted?: string;
};

/** One file found changed by comparing listings, with nothing of its contents. */
export type CommandFileChange = {
  readonly path: string;
  readonly change: "created" | "updated" | "deleted";
  /**
   * For a file it updated or deleted: a version from before it was saved
   * (ADR 0031), so undo can put the file back.
   */
  readonly kept?: true;
};

/**
 * What changed in a shell command's folder while it ran, found by listing the
 * folder before and after: names and kinds only, and a change made by anything
 * else while the command ran is seen as well. None of it can be reviewed. What
 * it updated or deleted can be put back only where a version from before was
 * kept; a file the same turns created can always be removed, as it did not
 * exist before them.
 */
export type CommandFileChanges =
  | {
      readonly status: "checked";
      /** In path order, at most as many as are kept on one action. */
      readonly files: readonly CommandFileChange[];
      /** How many more files changed than are listed. */
      readonly more?: number;
      /** The job it carried on as, when it ended after its call returned. */
      readonly job?: string;
      /**
       * Why the files it made are not named: the folder could not be listed
       * after it, so only the files there before were looked at.
       */
      readonly unlisted?: string;
    }
  /** It carried on as this job, and is checked when the job ends. */
  | { readonly status: "running"; readonly job: string }
  | { readonly status: "unchecked"; readonly reason: string };

/** A file's size and time of last change, as a listing of its folder finds it. */
export type ListedFile = {
  readonly size: number;
  /** Milliseconds since 1970, as Windows keeps it. */
  readonly modified: number;
  /**
   * The file's identity on its drive, as a decimal string: the same while it
   * is renamed or rewritten in place, and how the drive's change journal
   * names it.
   */
  readonly id?: string;
  /**
   * The entry is a junction or a symbolic link, never followed: its kind and
   * the target it names, as `junction`, `folder` or `file`, a space, then
   * the target as written. Its size and time are the link's own.
   */
  readonly link?: string;
};

/**
 * A folder's files, by their path from the folder with forward slashes, as
 * the listing that checks what commands change finds them: hidden files
 * included, ignored files and generated folders left out. Or why it could
 * not be listed. `folders`, when the listing gives them, are the folders it
 * walked, by the same paths, "" for the folder itself, with each one's
 * identity.
 */
export type WorkspaceListing =
  | {
      readonly ok: true;
      readonly files: ReadonlyMap<string, ListedFile>;
      readonly folders?: ReadonlyMap<string, string>;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Part of a folder to list, each by its path from the folder: each of
 * `entries` by itself, the entries directly in each of `entriesOf`, and
 * everything in each of `wholeOf`.
 */
export type ListingPart = {
  readonly entries: readonly string[];
  readonly entriesOf: readonly string[];
  readonly wholeOf: readonly string[];
};

/** Lists a folder's files, given by its full path, or only `part` of them. */
export type ListWorkspace = (
  root: string,
  part?: ListingPart,
) => Promise<WorkspaceListing>;
