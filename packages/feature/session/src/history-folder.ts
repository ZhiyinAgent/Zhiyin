/**
 * The history folder: where each file in it is, the file operations that
 * reach it, and the format every file written there records. The store, the
 * repair of damaged history and the updating of older conversations all find
 * their files through it.
 */

import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { HistoryFiles } from "./history-log.js";
import { isRecord } from "./saved-values.js";
import { currentFormat, type FileFormat, type Formats } from "./formats.js";

/**
 * A folder name for a conversation. An id that is safe as a name is used as
 * it is, so the folder can be found by eye; any other is hashed, so nothing a
 * conversation is called can name a path.
 */
export function folderName(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? `c-${id}`
    : `h-${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** A folder being deleted: renamed first, so half a deletion is never listed. */
export const deleting = ".deleting";

/** A read that failed because of the disk, not because of what was on it. */
export function unreachable(error: unknown): boolean {
  return (
    isRecord(error) && typeof error.code === "string" && error.code !== "EISDIR"
  );
}

export function stampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export function parsedJson(bytes: Buffer | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export function readable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class HistoryFolder {
  readonly directory: string;
  readonly files: HistoryFiles;
  readonly now: () => Date;
  readonly formats: Formats;
  /** What every file written here says about itself. */
  readonly format: FileFormat;

  constructor(
    directory: string,
    files: HistoryFiles,
    now: () => Date,
    written: { readonly formats: Formats; readonly by: string },
  ) {
    this.directory = directory;
    this.files = files;
    this.now = now;
    this.formats = written.formats;
    this.format = {
      format: currentFormat(written.formats),
      writtenBy: written.by,
    };
  }

  get settingsFile(): string {
    return join(this.directory, "history", "settings.json");
  }

  get conversationsFolder(): string {
    return join(this.directory, "history", "conversations");
  }

  folderOf(id: string): string {
    return join(this.conversationsFolder, folderName(id));
  }

  logOf(folder: string): string {
    return join(folder, "conversation.jsonl");
  }

  metaOf(folder: string): string {
    return join(folder, "meta.json");
  }

  /** The conversation folders, finishing any deletion a crash interrupted. */
  async folders(): Promise<string[]> {
    const names = await this.files.names(this.conversationsFolder);
    for (const name of names.filter((item) => item.endsWith(deleting)))
      await rm(join(this.conversationsFolder, name), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    return names.filter((item) => !item.endsWith(deleting));
  }
}
