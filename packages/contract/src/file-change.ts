/**
 * Exactly what one file would look like before and after an action, as the
 * implementation that would carry it out reports it. The file change and a
 * parent folder it creates are shown as structured effects before approval.
 *
 * A change too large to show says so rather than arriving as megabytes of
 * text nobody will read; `omitted` names why.
 */
export type FileChange = {
  readonly path: string;
  readonly change: "created" | "updated";
  /** A parent folder the same action will create for this file. */
  readonly createdFolder?: string;
  /** Absent when the file does not exist yet. */
  readonly before?: string;
  /** Absent when the change is too large to carry. */
  readonly after?: string;
  /** Why the contents are not here, when they are not. */
  readonly omitted?: string;
};
