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

type SessionOptions = NonNullable<
  ConstructorParameters<typeof FileSessions>[1]
>;

/** Replaces whatever history the folder held with this one. */
export async function plantHistory(
  root: string,
  workspace: unknown,
  options: SessionOptions = {},
): Promise<void> {
  await rm(join(root, "history"), { recursive: true, force: true });
  const sessions = new FileSessions(root, options);
  await sessions.saveWorkspace(workspace as SavedWorkspace);
  await sessions.release();
}

export function historyFolder(root: string): string {
  return join(root, "history");
}

/** The choices a person made, kept beside the conversations. */
export function settingsFile(root: string): string {
  return join(root, "history", "settings.json");
}

export function conversationFolder(root: string, id: string): string {
  return join(root, "history", "conversations", `c-${id}`);
}

/** Replaces a file with text that is not what it should hold. */
export async function damage(path: string, text = "not json"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text, "utf8");
}

/** A history whose settings are not settings at all, and no conversation. */
export async function plantUnreadableHistory(root: string): Promise<void> {
  await damage(settingsFile(root));
}

/** The choices a person made, as last saved. */
export async function savedSettings(
  root: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsFile(root), "utf8")) as Record<
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
