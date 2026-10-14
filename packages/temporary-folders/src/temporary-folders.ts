import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The folders a test file makes in the system's temporary folder, removed
 * together once a test is over.
 */
export class TemporaryFolders {
  readonly #made: string[] = [];

  /** A new, empty folder whose name starts with `prefix`. */
  async make(prefix: string): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), prefix));
    this.#made.push(folder);
    return folder;
  }

  /**
   * Removes every folder made so far, with whatever is in it. A file another
   * program has just let go of can stay locked for a moment on Windows, so a
   * removal is retried before it fails.
   */
  async removeAll(): Promise<void> {
    await Promise.all(
      this.#made
        .splice(0)
        .map((folder) =>
          rm(folder, { recursive: true, force: true, maxRetries: 5 }),
        ),
    );
  }
}
