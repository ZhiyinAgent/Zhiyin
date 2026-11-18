/**
 * Where a file runs later without anyone starting it: in a `.git` folder,
 * whose hooks and configuration name programs git runs, or in a Startup
 * folder, whose programs Windows starts at sign-in. One definition, for what
 * a call says it leaves behind, what a grant may cover, and what a sealed-off
 * program is held from.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { holds } from "./workspace-containment.js";

/** The Startup folders Windows keeps for this computer: the person's, and the one for every account. */
export function startupFolders(): readonly string[] {
  const programs = join("Microsoft", "Windows", "Start Menu", "Programs");
  return [
    join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      programs,
      "Startup",
    ),
    join(process.env.ProgramData ?? "C:\\ProgramData", programs, "StartUp"),
  ].map((folder) => resolve(folder));
}

/** A path's parts as Windows compares them: letter case and trailing dots and spaces ignored. */
function partsOf(path: string): string[] {
  return path
    .split(/[\\/]+/)
    .map((part) => part.replace(/[. ]+$/, "").toLowerCase());
}

/**
 * Whether a file at `path` can run later without anyone starting it: one in
 * a `.git` folder at any depth, or in a Startup folder, any account's, known
 * by where it sits under the Start Menu, or one of `startup`. Names compare
 * as Windows compares them, whatever their case.
 */
export function runsLater(
  path: string,
  startup: readonly string[] = startupFolders(),
): boolean {
  const parts = partsOf(path);
  return (
    parts.includes(".git") ||
    parts.some(
      (part, index) =>
        part === "start menu" &&
        parts[index + 1] === "programs" &&
        parts[index + 2] === "startup",
    ) ||
    startup.some((folder) => holds(folder, path))
  );
}
