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
   * `deleted` is gone for good.
   */
  readonly change: "created" | "updated" | "recycled" | "deleted";
  /** A parent folder the same action will create for this file. */
  readonly createdFolder?: string;
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
};

/**
 * What changed in a shell command's folder while it ran, found by listing the
 * folder before and after: names and kinds only, and a change made by anything
 * else while the command ran is seen as well. Nothing was copied, so none of
 * it can be reviewed, and what it updated or deleted cannot be put back; a
 * file the same turns created can still be removed, as it did not exist
 * before them.
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
    }
  /** It carried on as this job, and is checked when the job ends. */
  | { readonly status: "running"; readonly job: string }
  | { readonly status: "unchecked"; readonly reason: string };
