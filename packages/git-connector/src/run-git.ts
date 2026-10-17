import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runProcess,
  shortenedOutput,
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
): Promise<GitInvocation> {
  const result = await runProcess({
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
  const configured = await runGit(
    git,
    cwd,
    [
      "config",
      "-z",
      "--show-scope",
      "--name-only",
      "--get-regexp",
      "^(filter\\..+\\.(clean|smudge|process)|hook\\..+\\.[^.]+)$",
    ],
    signal,
    containment,
  );
  // A stopped listing is told as stopped. Listing nothing ends with 1. A list
  // cut short or failed would leave a filter or hook on, so nothing is read.
  if (configured.ending !== undefined) return configured;
  if (
    (configured.exitCode !== 0 && configured.exitCode !== 1) ||
    configured.stdout.includes(shortenedOutput)
  )
    return {
      exitCode: null,
      stdout: "",
      stderr:
        `Zhiyin could not read this repository's settings whole, so it read nothing from it. ${configured.stderr}`.trim(),
    };
  const listed = configured.stdout.split("\0");
  const repositorys = (pattern: RegExp) =>
    new Set(
      listed.flatMap((scope, at) => {
        if (at % 2 !== 0 || (scope !== "local" && scope !== "worktree"))
          return [];
        const named = pattern.exec(listed[at + 1] ?? "")?.[1];
        return named === undefined ? [] : [named];
      }),
    );
  const drivers = repositorys(/^filter\.(.+)\.(?:clean|smudge|process)$/s);
  // Git 2.54 and later run hooks named in settings, wherever hooks are
  // looked for.
  const hooks = repositorys(/^hook\.(.+)\.[^.]+$/s);
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
