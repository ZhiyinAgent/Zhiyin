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
  /** Line ranges shown to the model whole, or in every part. */
  readonly ranges?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  /**
   * Lines longer than a page, read in parts: the characters shown of each,
   * counted from 1. A line moves to `ranges` once all of it was shown.
   */
  readonly lineParts?: readonly {
    readonly line: number;
    readonly characters: number;
    readonly parts: readonly {
      readonly first: number;
      readonly last: number;
    }[];
  }[];
  readonly totalLines?: number;
  /**
   * A line was too long to be read whole: in a file that is not UTF-8, only
   * its first MiB is read, so no read shows the whole file.
   */
  readonly cutShort?: boolean;
  /** The model supplied the complete bytes of this successful write. */
  readonly whole?: boolean;
  /** For a PDF: the pages shown to the model, as this version of the file. */
  readonly pages?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  readonly totalPages?: number;
};
