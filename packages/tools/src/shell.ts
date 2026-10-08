/**
 * Which bash the shell tool runs, and whether there is one at all.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { ShellAvailability } from "@zhiyin/contract";

/**
 * Candidate locations for a real bash, in the order they are trusted. An
 * explicit setting wins; otherwise the Git for Windows shells, which are what
 * `bash` means on an ordinary Windows machine.
 */
function bashCandidates(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment["ZHIYIN_BASH"];
  const programFiles = [
    environment["ProgramFiles"],
    environment["ProgramW6432"],
    environment["ProgramFiles(x86)"],
    environment["LOCALAPPDATA"],
  ].filter((value): value is string => Boolean(value));
  const fromPath = (environment["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => [join(entry, "bash.exe"), join(entry, "bash")]);
  return [
    ...(configured ? [configured] : []),
    ...programFiles.flatMap((base) => [
      join(base, "Git", "bin", "bash.exe"),
      join(base, "Git", "usr", "bin", "bash.exe"),
      join(base, "Programs", "Git", "bin", "bash.exe"),
    ]),
    ...fromPath,
  ];
}

/**
 * Resolved once, when the tool registry is built: a shell that is not present
 * is a capability that does not exist, and a capability that does not exist is
 * never advertised to the model.
 */
export function resolveShell(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const candidate of bashCandidates(environment)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The one unavailable reading, so a caller can report it without re-probing. */
export const shellUnavailable: ShellAvailability = {
  available: false,
  reason:
    "No shell was found. Zhiyin runs shell commands through the bash that ships with Git for Windows.",
  installUrl: "https://git-scm.com/download/win",
};

/**
 * The same detection `resolveShell` uses, reported for a person rather than
 * silently folded into whether the `bash` tool exists. Queried live — no
 * caching here — so asking again after an install is enough to pick it up.
 */
export function shellAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): ShellAvailability {
  return resolveShell(environment) ? { available: true } : shellUnavailable;
}
