/**
 * Files a call names that its program may change though they could not be
 * copied first (ADR 0012): in the workspace by their path from it, and in a
 * folder outside it the program is given by their whole path. Each is
 * checked by its text alone: it must stay in the workspace or in one of
 * those folders, and keep out of Git's folder, which no sealed-off program
 * may change.
 */

import { isAbsolute, resolve } from "node:path";
import { holds } from "./workspace-containment.js";

/** Files one call may name at most. */
const namedAtMost = 20;

export type NamedFiles =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** Whether a name is Git's folder, as Windows reads it, trailing dots and spaces aside. */
const isGit = (part: string) =>
  part.replace(/[. ]+$/, "").toLowerCase() === ".git";

/**
 * The files `given` names: those in the workspace with forward slashes,
 * those in one of the `outside` folders by their whole path; or why they
 * cannot be.
 */
export function namedWorkspaceFiles(
  given: unknown,
  outside: readonly string[] = [],
): NamedFiles {
  if (given === undefined) return { ok: true, paths: [] };
  if (!Array.isArray(given) || !given.every((path) => typeof path === "string"))
    return { ok: false, reason: "Name the files as a list of paths." };
  if (given.length > namedAtMost)
    return {
      ok: false,
      reason: `Name at most ${namedAtMost} files a call may change for good.`,
    };
  const paths: string[] = [];
  for (const path of given as string[]) {
    const named = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
    const parts = named.split("/");
    const whole = /^[a-z]:\//i.test(named);
    if (whole) {
      const full = resolve(named);
      if (
        parts.slice(1).some((part) => part === ".." || part === "") ||
        !outside.some(
          (folder) =>
            holds(folder, full) && full.toLowerCase() !== folder.toLowerCase(),
        )
      )
        return {
          ok: false,
          reason: `${path} is not a file in a folder outside the workspace this call is given. Name such a file by its whole path inside one of them.`,
        };
      if (parts.some(isGit))
        return {
          ok: false,
          reason: `${path} is in Git's folder, which a script may not change.`,
        };
      if (!paths.some((kept) => kept.toLowerCase() === full.toLowerCase()))
        paths.push(full);
      continue;
    }
    if (
      !named ||
      isAbsolute(named) ||
      /^[a-z]:/i.test(named) ||
      named.startsWith("/") ||
      parts.some((part) => part === ".." || part === "")
    )
      return {
        ok: false,
        reason: `${path} is not a path inside the workspace. Name each file by its path from the workspace folder.`,
      };
    if (parts.some((part) => part.toLowerCase() === ".git"))
      return {
        ok: false,
        reason: `${path} is in Git's folder, which a script may not change.`,
      };
    if (!paths.includes(named)) paths.push(named);
  }
  return { ok: true, paths };
}
