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
  /** Line ranges actually shown to the model, excluding any shortened line. */
  readonly ranges?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  readonly totalLines?: number;
  /** The model supplied the complete bytes of this successful write. */
  readonly whole?: boolean;
  /** For a PDF: the pages shown to the model, as this version of the file. */
  readonly pages?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  readonly totalPages?: number;
};
