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
 * A git call that only reads, run so it starts no program the repository
 * brings. A folder can arrive with its `.git`, from an archive or a shared
 * drive, and its settings can name a file monitor, a signature checker and
 * filters, each a program git would otherwise start. Its hooks run when a
 * read refreshes the index, which a read without optional locks never
 * writes. Diff tools and converters are left out by the calls that show
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
  // Reading settings starts nothing.
  const filters = await runGit(
    git,
    cwd,
    ["config", "--get-regexp", "^filter\\..+\\.(clean|smudge|process)$"],
    signal,
    containment,
  );
  const drivers = new Set(
    filters.stdout
      .split(/\r?\n/)
      .map((line) => /^filter\.(.+)\.(?:clean|smudge|process) /.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  const settings: [string, string][] = [
    ["core.fsmonitor", "false"],
    ["log.showSignature", "false"],
    ...[...drivers].flatMap((driver): [string, string][] => [
      [`filter.${driver}.clean`, ""],
      [`filter.${driver}.smudge`, ""],
      [`filter.${driver}.process`, ""],
      [`filter.${driver}.required`, "false"],
    ]),
  ];
  return runGit(
    git,
    cwd,
    ["--no-optional-locks", ...args],
    signal,
    containment,
    settings,
  );
}
