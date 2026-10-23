import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runProcess,
  type ProcessContainment,
  type ProcessRun,
} from "@zhiyin/process-ownership";

export type GitContainment = ProcessContainment;
export type GitContainer = ReturnType<ProcessContainment["open"]>;
export type GitInvocation = Pick<
  ProcessRun,
  "exitCode" | "stdout" | "stderr" | "ending"
>;

const timeoutMs = 30_000;

/** What is said of a git command Zhiyin ended, rather than git. */
export const endings: Readonly<
  Record<NonNullable<GitInvocation["ending"]>, string>
> = {
  timeout: "The git command took longer than 30 seconds and was stopped.",
  stopped: "The git command was stopped before it finished.",
  outputLimit:
    "The git command printed more than a command may, and was stopped.",
};

/**
 * Git's own variables that tie a command to one repository, index or work
 * tree, as `git rev-parse --local-env-vars` lists them in git 2.47. Git reads
 * them before the working directory, so one Zhiyin inherited from a terminal
 * or a hook would send the agent's commit or stash to another repository than
 * the workspace's. Variables that only configure git, such as
 * `GIT_SSH_COMMAND`, are kept.
 */
const repositoryVariables = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

/** Zhiyin's environment without them; Windows names ignore case. */
function workspaceEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !repositoryVariables.has(name.toUpperCase()),
    ),
  );
}

/** One argv-based git invocation — never a shell string, so no quoting risk. */
export async function runGit(
  git: string,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  containment?: GitContainment,
  settings: readonly (readonly [string, string])[] = [],
  variables: Readonly<Record<string, string>> = {},
  /** Handed what git printed, whole and as bytes, once it has ended. */
  keep?: (stdout: Buffer) => void,
): Promise<GitInvocation> {
  const result = await runProcess({
    ...(keep
      ? {
          keep: async (files: { readonly stdout: string }) =>
            keep(await readFile(files.stdout)),
        }
      : {}),
    executable: git,
    arguments: args,
    cwd,
    timeoutMs,
    ...(signal ? { signal } : {}),
    ...(containment ? { containment } : {}),
    environment: {
      ...workspaceEnvironment(),
      GIT_TERMINAL_PROMPT: "0",
      // Git Credential Manager, Git for Windows' default helper, shows its own
      // login window whatever the terminal setting says; "never" makes it fail
      // instead, as GCM's environment documentation describes.
      GCM_INTERACTIVE: "never",
      GIT_EDITOR: "true",
      GIT_PAGER: "cat",
      ...configuredBy(settings),
      ...variables,
    },
  });
  if (result.failure === "containment")
    return {
      exitCode: null,
      stdout: "",
      stderr: "git could not be started, because it could not be contained.",
    };
  if (result.failure === "start")
    return {
      exitCode: null,
      stdout: "",
      stderr: "git could not be started.",
    };
  return result;
}

/**
 * Settings given to git as its environment's own: each name and value apart,
 * so a name holding "=", which `-c name=value` would split in the wrong
 * place, is set as it is. They pass to any git a git call starts.
 */
function configuredBy(
  settings: readonly (readonly [string, string])[],
): Record<string, string> {
  if (!settings.length) return {};
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(settings.length)],
    ...settings.flatMap(([name, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, name],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
}

/**
 * Where reads look for hooks: a folder no one can know of, never made, so it
 * holds none whichever git looks.
 */
const noHooks = join(tmpdir(), `zhiyin-no-hooks-${randomUUID()}`);

/** The settings that name a program a read could start: filters and hooks. */
const programSettings =
  "^(filter\\..+\\.(clean|smudge|process)|hook\\..+\\.[^.]+)$";

const unnamable =
  "This repository's settings name a filter or hook in characters Zhiyin cannot pass back to git, so it read nothing from it.";

/** A setting's scope and name. */
type Entry = readonly [scope: string, name: string];

type Listing =
  { readonly entries: readonly Entry[] } | { readonly refused: GitInvocation };

/** The scopes whose filters and hooks are the repository's, and Zhiyin's. */
const namedScopes = new Set(["local", "worktree", "command"]);

/**
 * The filters and hooks the repository's settings and Zhiyin's name, each
 * after the scope it is set in, with `settings` given. Read as the bytes git
 * printed, split at each NUL, which no name holds in any encoding: a name
 * that is not UTF-8 would come back decoded in the console's code page, where
 * no setting Zhiyin gives, which Windows hands git as UTF-8, can name it, and
 * where a multibyte code page can join it to what follows. So such a name of
 * the repository's refuses the listing. The person's own settings are left as
 * they are, so how theirs are named is not checked. Listing nothing ends with
 * 1; a listing cut short or failed would leave a filter or hook on, so it is
 * refused too.
 */
async function listed(
  git: string,
  cwd: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
  settings: readonly (readonly [string, string])[] = [],
): Promise<Listing> {
  let bytes: Buffer | undefined;
  const run = await runGit(
    git,
    cwd,
    [
      "config",
      "-z",
      "--show-scope",
      "--name-only",
      "--get-regexp",
      programSettings,
    ],
    signal,
    containment,
    settings,
    {},
    (stdout) => {
      bytes = stdout;
    },
  );
  if (run.ending !== undefined) return { refused: run };
  if ((run.exitCode !== 0 && run.exitCode !== 1) || bytes === undefined)
    return {
      refused: {
        exitCode: null,
        stdout: "",
        stderr:
          `Zhiyin could not read this repository's settings whole, so it read nothing from it. ${run.stderr}`.trim(),
      },
    };
  const parts: Buffer[] = [];
  for (let from = 0; from < bytes.length;) {
    const end = bytes.indexOf(0, from);
    parts.push(bytes.subarray(from, end === -1 ? bytes.length : end));
    from = end === -1 ? bytes.length : end + 1;
  }
  const entries: Entry[] = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const scope = parts[at]!.toString("latin1");
    const name = parts[at + 1]!;
    if (!namedScopes.has(scope)) continue;
    if (!isUtf8(name))
      return { refused: { exitCode: null, stdout: "", stderr: unnamable } };
    entries.push([scope, name.toString("utf8")]);
  }
  return { entries };
}

/** The filters and hooks of a listing, by the scopes they are set in. */
function scoped(entries: readonly Entry[]) {
  const named = (scopes: readonly string[], pattern: RegExp) =>
    new Set(
      entries.flatMap(([scope, setting]) => {
        if (!scopes.includes(scope)) return [];
        const name = pattern.exec(setting)?.[1];
        return name === undefined ? [] : [name];
      }),
    );
  return {
    drivers: (...scopes: string[]) =>
      named(scopes, /^filter\.(.+)\.(?:clean|smudge|process)$/s),
    // Git 2.54 and later run hooks named in settings, wherever hooks are
    // looked for.
    hooks: (...scopes: string[]) => named(scopes, /^hook\.(.+)\.[^.]+$/s),
  };
}

const tooOld =
  "Reading a repository needs Git 2.31 or newer, which takes the settings that keep a read from starting a program the repository brings. Update Git, then try again.";

/** Whether each git takes settings through its environment, asked once. */
const checkedGits = new Map<string, Promise<boolean>>();

/**
 * Git takes settings through its environment from 2.31 on; an older one
 * ignores them, and would start the programs they turn off.
 */
function takesSettings(
  git: string,
  cwd: string,
  signal?: AbortSignal,
  containment?: GitContainment,
): Promise<boolean> {
  const known = checkedGits.get(git);
  if (known) return known;
  const checking = runGit(git, cwd, ["--version"], signal, containment).then(
    ({ stdout }) => {
      const found = /^git version (\d+)\.(\d+)/.exec(stdout.trim());
      if (!found) return false;
      const [major, minor] = [Number(found[1]), Number(found[2])];
      return major > 2 || (major === 2 && minor >= 31);
    },
  );
  // A check that could not run is asked again next time.
  checkedGits.set(git, checking);
  void checking.then((trusted) => {
    if (!trusted) checkedGits.delete(git);
  });
  return checking;
}

/**
 * A git call that only reads, run so it starts no program the repository
 * brings. A folder can arrive with its `.git`, from an archive or a shared
 * drive, and its settings can name a file monitor, a signature checker and
 * filters, each a program git would otherwise start. A diff that finds a
 * file touched but unchanged writes the index, which runs a hook, so reads
 * look for hooks where there are none, and turn off each hook the
 * repository's settings define. A partial clone fetches what it is missing
 * through a program its settings can name, so reads allow no transport, even
 * one the repository allows itself, and fetch nothing.
 * Diff tools and converters are left out by the calls that show
 * changes, and a submodule's work tree, whose own settings this never reads,
 * by the calls that look at work trees.
 */
export async function readGit(
  git: string,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  containment?: GitContainment,
): Promise<GitInvocation> {
  if (!(await takesSettings(git, cwd, signal, containment)))
    return {
      exitCode: null,
      stdout: "",
      stderr: tooOld,
    };
  // Reading settings starts nothing. Each name after the scope it is set
  // in, each ended by a NUL, so a value cannot read as part of a name. Only
  // the repository's own filters and hooks are turned off: the person's, as
  // Git LFS is, are theirs, and a file stored through one would read as
  // changed.
  const configured = await listed(git, cwd, signal, containment);
  if ("refused" in configured) return configured.refused;
  const named = scoped(configured.entries);
  const drivers = named.drivers("local", "worktree");
  const hooks = named.hooks("local", "worktree");
  const settings: [string, string][] = [
    // No transport at all: a read has nothing to fetch, and a fetch can run
    // a program the repository's settings name.
    ["protocol.allow", "never"],
    ["core.hooksPath", noHooks],
    // Empty: no file monitor, read as false from Git 2.36 on, and before it
    // no program, where "false" would name one.
    ["core.fsmonitor", ""],
    ["log.showSignature", "false"],
    // Looking inside a submodule starts a git of its own there, which reads
    // the submodule's settings. Status, read in its porcelain form, never
    // shows a submodule's summary.
    ["diff.submodule", "short"],
    ...[...drivers].flatMap((driver): [string, string][] => [
      [`filter.${driver}.clean`, ""],
      [`filter.${driver}.smudge`, ""],
      [`filter.${driver}.process`, ""],
      [`filter.${driver}.required`, "false"],
    ]),
    ...[...hooks].map((hook): [string, string] => [
      `hook.${hook}.enabled`,
      "false",
    ]),
  ];
  // Each filter and hook of the repository's must be among the settings
  // Zhiyin gives, as git reads them both, or it would stay on.
  if (drivers.size || hooks.size) {
    const given = await listed(git, cwd, signal, containment, settings);
    if ("refused" in given) return given.refused;
    const seen = scoped(given.entries);
    const turnedOff = (repository: Set<string>, ours: Set<string>) =>
      [...repository].every((name) => ours.has(name));
    if (
      !turnedOff(seen.drivers("local", "worktree"), seen.drivers("command")) ||
      !turnedOff(seen.hooks("local", "worktree"), seen.hooks("command"))
    )
      return { exitCode: null, stdout: "", stderr: unnamable };
  }
  return runGit(
    git,
    cwd,
    ["--no-optional-locks", ...args],
    signal,
    containment,
    settings,
    // A variable, which a git too old to know it ignores, where the flag
    // --no-lazy-fetch would fail the call. An empty list of transports
    // allows none, whatever the repository's settings allow.
    { GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
  );
}
