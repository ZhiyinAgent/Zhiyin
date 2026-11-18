import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/** The SHA-256 of a file's content, or nothing when there is none to read. */
export function contentDigest(path: string): Promise<string | undefined> {
  return new Promise((done) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done(hash.digest("hex")))
      .on("error", () => done(undefined));
  });
}

/**
 * How a file stands: its size and time of change, or nothing when there is
 * no file. Read in place of its content for a file too large to copy.
 */
export function fileStanding(path: string): Promise<string | undefined> {
  return stat(path).then(
    (found) => (found.isFile() ? `${found.size}:${found.mtimeMs}` : undefined),
    () => undefined,
  );
}
