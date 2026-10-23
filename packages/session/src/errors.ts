/** Why the saved history could not be read or written. */
export class SessionStoreError extends Error {
  /**
   * `newer`: saved by a newer version, and left as it is. `outdated`: saved by
   * an older version, and waiting for the person to update it.
   */
  readonly code: "corrupted" | "unavailable" | "in-use" | "newer" | "outdated";
  /** For `newer` and `outdated`, the version of Zhiyin that saved it. */
  readonly writtenBy?: string;

  constructor(
    code: SessionStoreError["code"],
    message: string,
    options: { cause?: unknown; writtenBy?: string } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SessionStoreError";
    this.code = code;
    if (options.writtenBy !== undefined) this.writtenBy = options.writtenBy;
  }
}
