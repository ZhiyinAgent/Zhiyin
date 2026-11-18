/**
 * Which bash the shell tool runs, and whether there is one at all.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { ShellAvailability } from "@zhiyin/contract";
import { staysInside } from "@zhiyin/workspace-containment";

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
  ].filter((candidate) => !startsWsl(candidate, environment));
}

/**
 * The `bash.exe` Windows keeps in its own folder and among its app aliases
 * starts WSL: a command would run in a Linux machine, outside the containment
 * every command Zhiyin starts is given.
 */
function startsWsl(candidate: string, environment: NodeJS.ProcessEnv): boolean {
  const local = environment["LOCALAPPDATA"];
  return [
    environment["SystemRoot"],
    environment["windir"],
    local ? join(local, "Microsoft", "WindowsApps") : undefined,
  ].some((folder) => folder !== undefined && staysInside(folder, candidate));
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
const shellUnavailable: ShellAvailability = {
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

/**
 * The bash commands run in, found once when the tools are built and again
 * when asked. Where commands cannot be contained, there is none, and asking
 * again does not change that.
 */
export class CommandShell {
  #path: string | undefined;
  readonly #withheld: string | undefined;

  /**
   * `given` is the shell to use, or `undefined` for none; when it is not
   * given at all, one is looked for on this computer. `uncontained` says why
   * no command can be contained here.
   */
  constructor(options: {
    readonly given?: { readonly shell: string | undefined };
    readonly uncontained?: string | undefined;
  }) {
    this.#withheld =
      options.uncontained === undefined
        ? undefined
        : `Zhiyin cannot contain what a command starts on this computer, so it runs none. ${options.uncontained}`;
    this.#path = this.#withheld
      ? undefined
      : options.given
        ? options.given.shell
        : resolveShell();
  }

  /** Where the bash is, or nothing when no command can run. */
  get path(): string | undefined {
    return this.#path;
  }

  availability(): ShellAvailability {
    if (this.#withheld) return { available: false, reason: this.#withheld };
    return this.#path ? { available: true } : shellUnavailable;
  }

  recheck(environment: NodeJS.ProcessEnv = process.env): ShellAvailability {
    if (!this.#withheld) this.#path = resolveShell(environment);
    return this.availability();
  }
}
