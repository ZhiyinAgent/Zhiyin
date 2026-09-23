/** Why the saved history could not be read or written. */
export class SessionStoreError extends Error {
  readonly code: "corrupted" | "unavailable" | "in-use";

  constructor(
    code: SessionStoreError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SessionStoreError";
    this.code = code;
  }
}
