/**
 * Histories put on disk the way the app writes them, for tests of what the
 * reader does with them — including ones the reader must refuse, since the
 * writer stores whatever it is given.
 */

import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSessions, type SavedWorkspace } from "../src/index.js";
import { HistoryLog } from "../src/history-log.js";

/** Replaces whatever history the folder held with this one. */
export async function plantHistory(
  root: string,
  workspace: unknown,
): Promise<void> {
  await rm(join(root, "history"), { recursive: true, force: true });
  const sessions = new FileSessions(root);
  await sessions.saveWorkspace(workspace as SavedWorkspace);
  await sessions.release();
}

export function indexFolder(root: string): string {
  return join(root, "history", "index");
}

export function conversationFolder(root: string, id: string): string {
  return join(root, "history", "conversations", `c-${id}`);
}

/** Replaces every log in a folder with text that is not a history. */
export async function damage(folder: string, text = "not json"): Promise<void> {
  await mkdir(folder, { recursive: true });
  const logs = (await readdir(folder)).filter((name) =>
    name.endsWith(".jsonl"),
  );
  for (const name of logs.length ? logs : ["log-000001.jsonl"])
    await writeFile(join(folder, name), text, "utf8");
}

/** A history whose list is not a history at all. */
export async function plantUnreadableHistory(root: string): Promise<void> {
  await damage(indexFolder(root));
}

/** The list of conversations and the choices, as last saved. */
export async function savedIndex(
  root: string,
): Promise<Record<string, unknown>> {
  return (await HistoryLog.open(indexFolder(root))).state as Record<
    string,
    unknown
  >;
}

/** Everything the history holds on disk, as text. */
export async function savedText(root: string): Promise<string> {
  const folder = join(root, "history");
  const names = await readdir(folder, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    names
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
  );
  return texts.join("\n");
}

/** How many bytes the history occupies on disk. */
export async function savedBytes(root: string): Promise<number> {
  const folder = join(root, "history");
  const names = await readdir(folder, { recursive: true, withFileTypes: true });
  const sizes = await Promise.all(
    names
      .filter((entry) => entry.isFile())
      .map(
        async (entry) => (await stat(join(entry.parentPath, entry.name))).size,
      ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}
