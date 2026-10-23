import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Makes an empty folder tell names apart by case, as a folder shared with WSL can. */
function tellCaseApart(folder: string): void {
  execFileSync("fsutil", ["file", "setCaseSensitiveInfo", folder, "enable"], {
    stdio: "ignore",
  });
}

let caseSensitiveFolders: boolean | undefined;

/**
 * The folders a test file makes in the system's temporary folder, removed
 * together once a test is over.
 */
export class TemporaryFolders {
  readonly #made: string[] = [];

  /**
   * Whether this computer can make a folder that tells names apart by case.
   * Windows can only with the feature WSL uses installed, so a test that
   * needs one is skipped elsewhere.
   */
  static canTellCaseApart(): boolean {
    if (caseSensitiveFolders === undefined) {
      const probe = mkdtempSync(join(tmpdir(), "zhiyin-case-"));
      try {
        tellCaseApart(probe);
        caseSensitiveFolders = true;
      } catch {
        caseSensitiveFolders = false;
      } finally {
        rmSync(probe, { recursive: true, force: true });
      }
    }
    return caseSensitiveFolders;
  }

  /** A new, empty folder whose name starts with `prefix`. */
  async make(prefix: string): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), prefix));
    this.#made.push(folder);
    return folder;
  }

  /**
   * A new, empty folder that tells names apart by case: `inside` and `INSIDE`
   * are two folders in it. Throws where Windows cannot make one.
   */
  async makeCaseSensitive(prefix: string): Promise<string> {
    const folder = await this.make(prefix);
    tellCaseApart(folder);
    return folder;
  }

  /**
   * Removes every folder made so far, with whatever is in it. A file another
   * program has just let go of can stay locked for a moment on Windows, so a
   * removal is retried before it fails.
   */
  async removeAll(): Promise<void> {
    await Promise.all(
      this.#made.splice(0).map((folder) =>
        rm(folder, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        }),
      ),
    );
  }
}
