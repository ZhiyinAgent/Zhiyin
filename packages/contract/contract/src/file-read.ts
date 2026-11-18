/**
 * When a file was last read for a conversation, as it was then. The tools
 * record it and check a write against it; the application keeps it with the
 * conversation.
 */
export type FileRead = {
  readonly modifiedMs: number;
  readonly size: number;
  readonly readAt: string;
  /** The bytes the model's read was taken from. Absent for a document, read by pages. */
  readonly digest?: string;
  /**
   * How far the file was shown from its start, page after page: every line
   * before `line`, and the first `characters` of that one.
   */
  readonly readThrough?: {
    readonly line: number;
    readonly characters: number;
  };
  /**
   * A line was too long to be read whole: in a file that is not UTF-8, only
   * its first MiB is read, so no read shows the whole file.
   */
  readonly cutShort?: boolean;
  /** The model was shown every line, or supplied the bytes of its own write. */
  readonly whole?: boolean;
  /** For a PDF: the pages shown to the model, as this version of the file. */
  readonly pages?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  readonly totalPages?: number;
};
