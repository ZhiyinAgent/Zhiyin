import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { holds } from "./workspace-containment.js";

/**
 * The folders outside the workspace a program asks to change too, each by
 * its real path (ADR 0012). Each must be named by its whole path, be there, and
 * be reached through no link, so the path approved is the folder written. A
 * folder inside the workspace is the workspace's already. Zhiyin's own
 * folders, and a folder holding one, are never given; nor is a drive, the
 * person's user folder or a folder holding it, which would hold nearly
 * everything.
 */
export async function outsideFolders(
  asked: unknown,
  root: string,
  protect: readonly string[],
): Promise<
  | { readonly ok: true; readonly folders: readonly string[] }
  | { readonly ok: false; readonly reason: string }
> {
  if (asked === undefined) return { ok: true, folders: [] };
  if (!Array.isArray(asked) || asked.some((entry) => typeof entry !== "string"))
    return {
      ok: false,
      reason: "outside_folders must be a list of folder paths.",
    };
  const home = resolve(homedir());
  const folders: string[] = [];
  for (const path of asked as string[]) {
    if (!isAbsolute(path))
      return {
        ok: false,
        reason: `${path} is not a whole path: name a folder outside the workspace from its drive.`,
      };
    const named = resolve(path);
    const real = await realpath(named).catch(() => undefined);
    const folder =
      real && (await stat(real).catch(() => undefined))?.isDirectory()
        ? real
        : undefined;
    if (!folder)
      return { ok: false, reason: `${named} is not a folder that is there.` };
    if (folder.toLowerCase() !== named.toLowerCase())
      return {
        ok: false,
        reason: `${named} leads elsewhere through a link: name the folder it leads to, ${folder}.`,
      };
    if (holds(root, folder)) continue;
    if (dirname(folder) === folder || holds(folder, home))
      return {
        ok: false,
        reason: `${folder} holds nearly everything on this PC: name the folder the script works in.`,
      };
    if (protect.some((own) => holds(own, folder) || holds(folder, own)))
      return {
        ok: false,
        reason: `${folder} is or holds a folder Zhiyin keeps for itself, which no script changes.`,
      };
    if (!folders.some((kept) => kept.toLowerCase() === folder.toLowerCase()))
      folders.push(folder);
  }
  return { ok: true, folders };
}
