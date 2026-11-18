/**
 * The files a tool wrote for one conversation, each by a digest of its
 * content, kept in a file of the conversation's own folder.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";

/**
 * The file a path leads to, as Windows names it once links and short names
 * are resolved, in any case; nothing when it cannot be found. Two hard links
 * to one file are two names Windows keeps apart, so they count as two files.
 */
const key = (path: string) =>
  realpath(path).then(
    (real) => real.toLowerCase(),
    () => undefined,
  );

/** The SHA-256 of a file's content, or nothing when it cannot be read. */
export function contentDigest(path: string): Promise<string | undefined> {
  return new Promise((done) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done(hash.digest("hex")))
      .on("error", () => done(undefined));
  });
}

export class WrittenFiles {
  /** Each change waits for the one before, so calls that finish together lose none. */
  private readonly changes = new Serial();

  /**
   * `record` is the file the digests are kept in, in the conversation's own
   * folder; `replace` writes it whole, so it is never left half written.
   */
  constructor(
    private readonly record: string,
    private readonly replace: (path: string, text: string) => Promise<void>,
  ) {}

  private async read(): Promise<Record<string, string>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.record, "utf8"));
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, string>)
        : {};
    } catch {
      // None yet, or one cut short: nothing is known, so every replacement is asked about.
      return {};
    }
  }

  /** Notes `paths` as written now, with their content as it is. */
  wrote(paths: readonly string[]): Promise<void> {
    return this.changes.run(async () => {
      if (!paths.length) return;
      const known = await this.read();
      for (const path of paths) {
        const [where, content] = await Promise.all([
          key(path),
          contentDigest(path),
        ]);
        if (where && content) known[where] = content;
      }
      await mkdir(dirname(this.record), { recursive: true });
      await this.replace(this.record, JSON.stringify(known));
    });
  }

  /** Whether `path` is a file this conversation's tool wrote, and its content is still what was written. */
  async unchanged(path: string): Promise<boolean> {
    await this.changes.settled();
    const where = await key(path);
    const known = where === undefined ? undefined : (await this.read())[where];
    return known !== undefined && known === (await contentDigest(path));
  }
}
