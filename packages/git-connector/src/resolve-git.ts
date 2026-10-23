import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Candidate locations for a real git, in the order they are trusted. An
 * explicit setting wins; otherwise the Git for Windows install — verified on
 * a real machine: `Git\cmd\git.exe` and `Git\mingw64\bin\git.exe` both exist,
 * mirroring how `resolveShell` in `@zhiyin/tools` finds `bash.exe` in the
 * same install.
 */
function gitCandidates(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment["ZHIYIN_GIT"];
  const programFiles = [
    environment["ProgramFiles"],
    environment["ProgramW6432"],
    environment["ProgramFiles(x86)"],
    environment["LOCALAPPDATA"],
  ].filter((value): value is string => Boolean(value));
  const fromPath = (environment["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => [join(entry, "git.exe"), join(entry, "git")]);
  return [
    ...(configured ? [configured] : []),
    ...programFiles.flatMap((base) => [
      join(base, "Git", "cmd", "git.exe"),
      join(base, "Git", "bin", "git.exe"),
      join(base, "Git", "mingw64", "bin", "git.exe"),
      join(base, "Programs", "Git", "cmd", "git.exe"),
    ]),
    ...fromPath,
  ];
}

/**
 * Resolved fresh on every call — cheap (a handful of `accessSync` checks) and
 * never cached here, so a person installing git is picked up the next time
 * anything asks, with no separate invalidation step.
 */
export function resolveGit(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const candidate of gitCandidates(environment)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
