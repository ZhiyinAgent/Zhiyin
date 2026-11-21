/**
 * git for a sealed-off shell (ADR 0029). git opens the null device whenever
 * it starts, which a container refuses, so the container's `git` hands its
 * arguments, folder and input to Zhiyin, and this runs the person's git
 * outside the container on its behalf:
 *
 * - only in a folder the shell may change, and only on a repository inside
 *   one: the folder, the repository's own folder and its work tree all;
 * - with every setting that makes git start a program turned off, at the
 *   command's scope, which outranks every file, the repository's own and any
 *   it includes: hooks, filters, textconv and external diff and merge
 *   drivers, the file monitor, the pager and editors, aliases that run
 *   commands, credential helpers, ssh commands, signing programs and the
 *   rest below. The names a repository gives its drivers, helpers and
 *   aliases are read from its settings, includes followed, and each is
 *   turned off by name;
 * - with none of the person's credentials and none of their settings: its
 *   home is the conversation's, and the system's settings are not read;
 * - reaching only the conversation's hosts, over HTTPS, through Zhiyin's
 *   proxy.
 *
 * Global options that move git elsewhere or set its settings, the commands
 * that exist to run a program, and a path outside the folders it may change
 * are refused before git starts, a path that leads out through a junction or
 * a symbolic link too. So is a repository, or outside one the folder, that
 * holds such a link anywhere, since git follows a junction as a folder. The
 * shell asking is held still from before these checks until git ends, by
 * its caller, so no link appears in between.
 */

import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  openLoopbackProxy,
  runProcess,
  windowsEnvironment,
  type HostReach,
  type ProcessContainment,
  type ProxyRoute,
} from "@zhiyin/sandbox";
import { holds } from "@zhiyin/workspace-containment";
import { resolveGit } from "./resolve-git.js";

export type ShellGitCall = {
  /** git's arguments, as the shell gave them. */
  readonly args: readonly string[];
  /** The folder the shell ran git in. */
  readonly cwd: string;
  /** The folders the shell may change: the workspace and those granted. */
  readonly folders: readonly string[];
  /** The hosts the conversation may reach, as a confinement names them. */
  readonly hosts: readonly string[];
  /** The conversation's home: git's own settings are kept there. */
  readonly home: string;
  /** git's standard input, as a file; absent, it reads nothing. */
  readonly input?: string;
  readonly signal: AbortSignal;
};

export type ShellGitAnswer = {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  /** Each host git asked for and Zhiyin's proxy refused. */
  readonly refusedHosts: readonly string[];
  /** Whether a host sent git anything: what it fetched is outside content. */
  readonly received: boolean;
};

/** How long one git command may run, as a clone may take. */
const timeoutMs = 10 * 60_000;
const largestOutput = 64 * 1024 * 1024;

/** A folder no one can know of, never made, so a program named in it is never there. */
const nowhere = join(tmpdir(), `zhiyin-git-nothing-${randomUUID()}`);
const noProgram = join(nowhere, "none.exe");

/** The global options that change nothing of where git works or what it runs. */
const harmlessGlobals = new Set([
  "--no-pager",
  "-P",
  "--paginate",
  "-p",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-optional-locks",
  "--no-advice",
  "--version",
]);

/** Commands that exist to start a program, or hand the person's work elsewhere. */
const refusedCommands: Readonly<Record<string, string>> = {
  help: "it opens a viewer",
  difftool: "it starts a diff tool",
  mergetool: "it starts a merge tool",
  "send-email": "it sends mail",
  "imap-send": "it starts a program to reach the mail server",
  "filter-branch": "it runs the commands it is given",
  "filter-repo": "it runs the code it is given",
  submodule: "a submodule's own settings would run",
  daemon: "it serves the repository",
  instaweb: "it starts a web server",
  "web--browse": "it opens a browser",
  credential: "it reaches credentials",
  "credential-store": "it reaches credentials",
  "credential-cache": "it reaches credentials",
  "credential-manager": "it reaches credentials",
  "upload-pack": "it serves the repository",
  "receive-pack": "it serves the repository",
  "upload-archive": "it serves the repository",
  shell: "it is a login shell",
  gui: "it opens a window",
  citool: "it opens a window",
  gitk: "it opens a window",
  "fsmonitor--daemon": "it starts the file monitor",
  p4: "it starts Perforce",
  svn: "it starts Subversion",
  cvsimport: "it starts CVS",
  cvsserver: "it serves the repository",
  archimport: "it starts Arch",
  quiltimport: "it reads patches from elsewhere",
};

/** Options of a command that name a program to run, and the commands they belong to. */
const programOptions: readonly {
  readonly commands: readonly string[] | "any";
  readonly options: readonly string[];
}[] = [
  { commands: "any", options: ["--upload-pack", "--receive-pack", "--exec"] },
  {
    commands: ["clone", "fetch", "pull", "ls-remote", "archive"],
    options: ["-u"],
  },
  { commands: ["rebase"], options: ["-x"] },
  { commands: ["grep"], options: ["-O", "--open-files-in-pager"] },
  { commands: "any", options: ["--extcmd", "--tool", "--recurse-submodules"] },
  { commands: ["bisect"], options: ["run"] },
  { commands: ["worktree", "clone"], options: ["--template"] },
];

/** The option `argument` names, without a value written after `=`. */
function optionName(argument: string): string {
  return argument.startsWith("--") ? argument.split("=")[0]! : argument;
}

/**
 * Why git's arguments are refused before it starts, or nothing. Answers the
 * command they run, past the global options.
 */
function argumentsRefusal(
  args: readonly string[],
): { readonly refused: string } | { readonly command: string | undefined } {
  let at = 0;
  for (; at < args.length; at += 1) {
    const argument = args[at]!;
    if (!argument.startsWith("-")) break;
    if (!harmlessGlobals.has(argument))
      return {
        refused: `git through Zhiyin does not take the global option ${optionName(argument)}: it would change where git works or what it runs. Run git in the folder itself, without it.`,
      };
  }
  const command = args[at];
  if (command === undefined) return { command };
  const why = refusedCommands[command];
  if (why)
    return {
      refused: `git ${command} does not run through Zhiyin, as ${why}. If it is needed, run it with full access, which the person approves.`,
    };
  const rest = args.slice(at + 1);
  if (rest.includes("--help"))
    return {
      refused: "git --help opens a viewer, so it does not run through Zhiyin.",
    };
  for (const rule of programOptions) {
    if (rule.commands !== "any" && !rule.commands.includes(command)) continue;
    const found = rest.find((argument) =>
      rule.options.includes(optionName(argument)),
    );
    if (found)
      return {
        refused: `git ${command} ${optionName(found)} does not run through Zhiyin: it would start a program, or work beyond the folder. If it is needed, run it with full access, which the person approves.`,
      };
  }
  return { command };
}

const fullAccess =
  "If it is needed, run it with full access, which the person approves.";

/** Whether `text` reads as a path, rather than a name, a revision or an address. */
function pathLike(text: string): boolean {
  if (!text || text.includes("://")) return false;
  if (/^[A-Za-z]:/.test(text) || isAbsolute(text) || text.startsWith("\\\\"))
    return true;
  return text.split(/[\\/]/).includes("..");
}

/**
 * What an argument could name as a path: itself, an option's value after
 * `=`, and a short option's value written right after it, as in `-Ffile`.
 */
function pathValues(argument: string): string[] {
  const values = [argument];
  const equals = argument.indexOf("=");
  if (argument.startsWith("-") && equals !== -1)
    values.push(argument.slice(equals + 1));
  if (/^-[^-]./s.test(argument)) values.push(argument.slice(2));
  return values.filter((value) => value && !value.startsWith("-"));
}

/**
 * The first argument naming a path outside every folder git may change, as
 * an option's value too. A relative path that never climbs stays below git's
 * folder, which is checked apart.
 */
function pathOutside(
  args: readonly string[],
  cwd: string,
  folders: readonly string[],
): string | undefined {
  for (const argument of args)
    for (const value of pathValues(argument)) {
      if (!pathLike(value)) continue;
      const path = resolve(cwd, value);
      if (!folders.some((folder) => holds(folder, path))) return value;
    }
  return undefined;
}

/**
 * Where `path` really is, every link on the way followed: its nearest part
 * that exists, as `realpath` gives it, with the rest of its name after.
 */
async function reallyAt(path: string): Promise<string> {
  const rest: string[] = [];
  for (let at = path; ;) {
    const real = await realpath(at).catch(() => undefined);
    if (real !== undefined) return join(real, ...rest);
    const up = dirname(at);
    if (up === at) return path;
    rest.unshift(basename(at));
    at = up;
  }
}

/**
 * The first argument naming, through a junction or a symbolic link, a path
 * outside every folder git may change, and where it leads: git would follow
 * the link with the person's own access.
 */
async function pathThroughLink(
  args: readonly string[],
  cwd: string,
  folders: readonly string[],
): Promise<{ readonly value: string; readonly real: string } | undefined> {
  for (const argument of args)
    for (const value of pathValues(argument)) {
      if (value.includes("://")) continue;
      const real = await reallyAt(resolve(cwd, value));
      if (!folders.some((folder) => holds(folder, real)))
        return { value, real };
    }
  return undefined;
}

/**
 * The first junction or symbolic link below `roots` that leads outside every
 * folder git may change, and where, or nothing. git follows a junction as a
 * folder, so through one it would read and write elsewhere. A link that
 * leads into another of the folders is walked too; one whose target is
 * missing is judged by the target it names.
 */
async function linkLeadingOut(
  roots: readonly string[],
  folders: readonly string[],
): Promise<{ readonly link: string; readonly real: string } | undefined> {
  const walked: string[] = [];
  let found: { link: string; real: string } | undefined;
  const walk = async (folder: string): Promise<void> => {
    if (found) return;
    const entries = await readdir(folder, { withFileTypes: true }).catch(
      () => [],
    );
    const deeper: Promise<void>[] = [];
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        const real = await realpath(path).catch(async () =>
          resolve(folder, await readlink(path).catch(() => path)),
        );
        if (!folders.some((inside) => holds(inside, real))) {
          found ??= { link: path, real };
          break;
        }
        deeper.push(enter(real));
      } else if (entry.isDirectory()) deeper.push(walk(path));
    }
    await Promise.all(deeper);
  };
  const enter = async (root: string): Promise<void> => {
    if (walked.some((done) => holds(done, root))) return;
    walked.push(root);
    await walk(root);
  };
  for (const root of roots) await enter(root);
  return found;
}

/** A setting's name and value, as git lists them. */
type Setting = readonly [name: string, value: string];

/**
 * Every setting git reads in the folder, includes followed, read as bytes
 * and split at each NUL, which no name or value holds. Undefined when they
 * cannot be read whole, or a name is not UTF-8 and so could not be named
 * back to git.
 */
async function settingsIn(
  git: string,
  cwd: string,
  environment: Record<string, string | undefined>,
  signal: AbortSignal,
  containment: ProcessContainment | undefined,
): Promise<readonly Setting[] | undefined> {
  let bytes: Buffer | undefined;
  const run = await runProcess({
    executable: git,
    arguments: ["config", "--includes", "-z", "--list"],
    cwd,
    timeoutMs: 30_000,
    maximumOutputCharacters: 2_000,
    environment,
    signal,
    ...(containment ? { containment } : {}),
    keep: async (files) => {
      bytes = await readFile(files.stdout);
    },
  });
  if (run.ending || run.failure || bytes === undefined) return undefined;
  // Outside a repository there may be no settings, which git answers with 1.
  if (run.exitCode !== 0 && run.exitCode !== 1) return undefined;
  const settings: Setting[] = [];
  for (let from = 0; from < bytes.length;) {
    const end = bytes.indexOf(0, from);
    const entry = bytes.subarray(from, end === -1 ? bytes.length : end);
    from = end === -1 ? bytes.length : end + 1;
    if (!entry.length) continue;
    const line = entry.indexOf(10);
    const name = line === -1 ? entry : entry.subarray(0, line);
    if (!isUtf8(name)) return undefined;
    const value = line === -1 ? "" : entry.subarray(line + 1).toString("utf8");
    settings.push([name.toString("utf8"), value]);
  }
  return settings;
}

/**
 * The settings that keep git from starting any program the repository, its
 * includes or the conversation's own settings name, and that send it out
 * only through Zhiyin's proxy, when there is one.
 */
function turnedOff(
  found: readonly Setting[],
  proxy: string | undefined,
  hooks: string,
  /** An empty folder, which no container may write, that `git init` copies nothing from. */
  templates: string = hooks,
): readonly Setting[] {
  const named = (pattern: RegExp) =>
    new Set(
      found.flatMap(([name]) => {
        const match = pattern.exec(name);
        return match ? [match[1]!] : [];
      }),
    );
  const fixed: Setting[] = [
    ["core.hooksPath", hooks],
    ["core.fsmonitor", ""],
    ["core.pager", "cat"],
    ["core.editor", ":"],
    ["sequence.editor", ":"],
    // A command git hands its shell is emptied, which git takes as none; a
    // program git starts itself, where empty would mean its default, is
    // named where no program is.
    ["core.askPass", noProgram],
    ["core.sshCommand", noProgram],
    ["core.gitProxy", ""],
    ["core.alternateRefsCommand", ""],
    ["diff.external", ""],
    ["credential.helper", ""],
    ["credential.interactive", "never"],
    ["gpg.program", noProgram],
    ["gpg.openpgp.program", noProgram],
    ["gpg.ssh.program", noProgram],
    ["gpg.x509.program", noProgram],
    ["gpg.ssh.defaultKeyCommand", noProgram],
    ["commit.gpgSign", "false"],
    ["tag.gpgSign", "false"],
    ["tag.forceSignAnnotated", "false"],
    ["push.gpgSign", "false"],
    ["log.showSignature", "false"],
    ["merge.verifySignatures", "false"],
    ["uploadpack.packObjectsHook", ""],
    ["http.cookieFile", ""],
    ["init.templateDir", templates],
    ["submodule.recurse", "false"],
    ["fetch.recurseSubmodules", "false"],
    ["diff.submodule", "short"],
    ["status.submoduleSummary", "false"],
    ["gc.auto", "0"],
    ["maintenance.auto", "false"],
    ["protocol.allow", "never"],
    // HTTPS alone, and only with a proxy to reach the hosts given.
    ["protocol.https.allow", proxy ? "always" : "never"],
    ...(proxy ? [["http.proxy", proxy] as const] : []),
  ];
  const byName: Setting[] = [
    ...[...named(/^filter\.(.+)\.(?:clean|smudge|process|required)$/s)].flatMap(
      (driver): Setting[] => [
        [`filter.${driver}.clean`, ""],
        [`filter.${driver}.smudge`, ""],
        [`filter.${driver}.process`, ""],
        [`filter.${driver}.required`, "false"],
      ],
    ),
    ...[...named(/^diff\.(.+)\.(?:textconv|command)$/s)].flatMap(
      (driver): Setting[] => [
        [`diff.${driver}.textconv`, ""],
        [`diff.${driver}.command`, ""],
        [`diff.${driver}.cachetextconv`, "false"],
      ],
    ),
    ...[...named(/^merge\.(.+)\.driver$/s)].map((driver): Setting => [
      `merge.${driver}.driver`,
      "",
    ]),
    ...[...named(/^hook\.(.+)\.[^.]+$/s)].map((hook): Setting => [
      `hook.${hook}.enabled`,
      "false",
    ]),
    ...[...named(/^credential\.(.+)\.helper$/s)].map((url): Setting => [
      `credential.${url}.helper`,
      "",
    ]),
    ...[...named(/^http\.(.+)\.proxy$/s)].map((url): Setting => [
      `http.${url}.proxy`,
      proxy ?? "",
    ]),
    ...[...named(/^http\.(.+)\.cookieFile$/is)].map((url): Setting => [
      `http.${url}.cookieFile`,
      "",
    ]),
    ...[...named(/^remote\.(.+)\.(?:uploadpack|receivepack)$/s)].flatMap(
      (remote): Setting[] => [
        [`remote.${remote}.uploadpack`, ""],
        [`remote.${remote}.receivepack`, ""],
      ],
    ),
    ...[...named(/^submodule\.(.+)\.update$/s)].map((name): Setting => [
      `submodule.${name}.update`,
      "none",
    ]),
    ...[...named(/^pager\.(.+)$/s)].map((command): Setting => [
      `pager.${command}`,
      "false",
    ]),
    // An alias that starts a program is emptied, which git refuses to run.
    ...found.flatMap(([name, value]): Setting[] =>
      /^alias\./.test(name) && value.trimStart().startsWith("!")
        ? [[name, ""]]
        : [],
    ),
  ];
  return [...fixed, ...byName];
}

/**
 * The commands that show changes start an external diff or a converter by
 * default, which no setting turns off: an empty one is still started, and
 * fails. Each is told to start neither, right after its name.
 */
const showingChanges: Readonly<Record<string, readonly string[]>> = {
  diff: ["--no-ext-diff", "--no-textconv"],
  log: ["--no-ext-diff", "--no-textconv"],
  show: ["--no-ext-diff", "--no-textconv"],
  whatchanged: ["--no-ext-diff", "--no-textconv"],
  blame: ["--no-textconv"],
  annotate: ["--no-textconv"],
};

/** git's arguments with the command that shows changes told to start nothing. */
function withoutConverters(args: readonly string[]): string[] {
  const at = args.findIndex((argument) => !argument.startsWith("-"));
  if (at === -1) return [...args];
  let command = at;
  if (args[at] === "stash" && args[at + 1] === "show") command = at + 1;
  const added =
    args[at] === "stash" && command !== at
      ? showingChanges["diff"]!
      : (showingChanges[args[at]!] ?? []);
  return [...args.slice(0, command + 1), ...added, ...args.slice(command + 1)];
}

/** Settings as git's environment gives them, each name and value apart. */
function asEnvironment(settings: readonly Setting[]): Record<string, string> {
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(settings.length)],
    ...settings.flatMap(([name, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, name],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
}

/** The person's name and email as their own git has them, asked once. */
let identity: Promise<readonly Setting[]> | undefined;

function personsIdentity(
  git: string,
  containment: ProcessContainment | undefined,
): Promise<readonly Setting[]> {
  identity ??= (async () => {
    const asked: Setting[] = [];
    for (const name of ["user.name", "user.email"]) {
      const run = await runProcess({
        executable: git,
        arguments: ["config", "--global", "--get", name],
        cwd: tmpdir(),
        timeoutMs: 30_000,
        ...(containment ? { containment } : {}),
      });
      const value = run.exitCode === 0 ? run.stdout.trim() : "";
      if (value && !value.includes("\n")) asked.push([name, value]);
    }
    return asked;
  })();
  return identity;
}

/** Git's settings file in the conversation's home, given the person's name. */
async function homeSettings(home: string, named: readonly Setting[]) {
  const file = join(home, ".gitconfig");
  const known = await readFile(file, "utf8").catch(() => undefined);
  if (known === undefined && named.length) {
    const lines = named.map(
      ([name, value]) =>
        `\t${name.split(".")[1]} = "${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    );
    await writeFile(file, `[user]\n${lines.join("\n")}\n`).catch(
      () => undefined,
    );
  }
  return file;
}

function answer(
  exitCode: number,
  stderr: string,
  extra: Partial<ShellGitAnswer> = {},
): ShellGitAnswer {
  return {
    exitCode,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(stderr.endsWith("\n") ? stderr : `${stderr}\n`),
    refusedHosts: [],
    received: false,
    ...extra,
  };
}

/**
 * Why the repository is refused, when a path git names for it is outside
 * the folders it may change; otherwise those paths, as they really are, or
 * none outside a repository.
 */
async function repositoryInside(
  git: string,
  cwd: string,
  folders: readonly string[],
  environment: Record<string, string | undefined>,
  signal: AbortSignal,
  containment: ProcessContainment | undefined,
): Promise<{ readonly refused: string } | { readonly paths: string[] }> {
  const run = await runProcess({
    executable: git,
    arguments: [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ],
    cwd,
    timeoutMs: 30_000,
    environment,
    signal,
    ...(containment ? { containment } : {}),
  });
  // Not in a repository, as before `git init` or `git clone`.
  if (run.exitCode !== 0) return { paths: [] };
  const named = run.stdout.split(/\r?\n/).filter(Boolean);
  const real = await Promise.all(
    named.map((path) => realpath(path).catch(() => resolve(path))),
  );
  const outside = real.find(
    (path) => !folders.some((folder) => holds(folder, path)),
  );
  if (outside)
    return {
      refused: `This repository keeps its files or its history at ${outside}, outside the folders this shell may change, so git through Zhiyin does not run in it.`,
    };
  const alternates = await readFile(
    join(real.at(-1) ?? "", "objects", "info", "alternates"),
    "utf8",
  ).catch(() => "");
  const borrowed = alternates
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => resolve(real.at(-1) ?? "", "objects", line))
    .find((path) => !folders.some((folder) => holds(folder, path)));
  return borrowed
    ? {
        refused: `This repository reads objects from ${borrowed}, outside the folders this shell may change, so git through Zhiyin does not run in it.`,
      }
    : { paths: real };
}

/** Each host the proxy refused, as `host:port`. */
function refused(reached: readonly HostReach[]): string[] {
  return reached
    .filter((reach) => reach.refused)
    .map((reach) =>
      reach.port === 443 ? reach.host : `${reach.host}:${reach.port}`,
    );
}

/**
 * Runs one git command for a sealed-off shell, as the module describes.
 * Answers git's exit code and output, or, for a refusal, 128 and why.
 */
export function shellGit(options: {
  readonly containment?: ProcessContainment;
  /** How this computer reaches a URL; absent, the proxy goes out directly. */
  readonly route?: ProxyRoute;
  readonly resolveGit?: () => string | undefined;
}): (call: ShellGitCall) => Promise<ShellGitAnswer> {
  const find = options.resolveGit ?? resolveGit;
  const { containment } = options;
  return async (call) => {
    const git = find();
    if (!git)
      return answer(
        127,
        "git: no git is installed for Zhiyin to run. Install Git for Windows.",
      );
    const checked = argumentsRefusal(call.args);
    if ("refused" in checked) return answer(128, `git: ${checked.refused}`);
    const folders = await Promise.all(
      call.folders.map((folder) =>
        realpath(folder).catch(() => resolve(folder)),
      ),
    );
    const cwd = await realpath(call.cwd).catch(() => resolve(call.cwd));
    if (!folders.some((folder) => holds(folder, cwd)))
      return answer(
        128,
        `git: ${cwd} is outside the folders this shell may change, so git through Zhiyin does not run there.`,
      );
    const outside = pathOutside(call.args, cwd, folders);
    if (outside !== undefined)
      return answer(
        128,
        `git: ${outside} is outside the folders this shell may change, so git through Zhiyin does not reach it.`,
      );
    const through = await pathThroughLink(call.args, cwd, folders);
    if (through)
      return answer(
        128,
        `git: ${through.value} leads through a junction or symbolic link to ${through.real}, outside the folders this shell may change, so git through Zhiyin does not reach it. ${fullAccess}`,
      );
    const gitFolder = dirname(git);
    const base: Record<string, string | undefined> = {
      ...windowsEnvironment(),
      PATH: [
        gitFolder,
        join(process.env["SystemRoot"] ?? "C:\\Windows", "System32"),
      ].join(";"),
      HOME: call.home,
      GIT_CONFIG_GLOBAL: await homeSettings(
        call.home,
        await personsIdentity(git, containment),
      ),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CEILING_DIRECTORIES: folders
        .map((folder) => dirname(folder))
        .join(";"),
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_EDITOR: ":",
      GIT_SEQUENCE_EDITOR: ":",
      GIT_PAGER: "cat",
      GIT_NO_LAZY_FETCH: "1",
    };
    const proxy = call.hosts.length
      ? await openLoopbackProxy(call.hosts, options.route).catch(
          () => undefined,
        )
      : undefined;
    // Empty, and Zhiyin's alone for the command: `git init` copies nothing
    // from it, and finds it there.
    const templates = await mkdtemp(join(tmpdir(), "zhiyin-git-templates-"));
    try {
      // The settings are read with every program already turned off, so
      // reading them starts none.
      const safe = {
        ...base,
        ...asEnvironment(turnedOff([], proxy?.address, nowhere, templates)),
      };
      const found = await settingsIn(git, cwd, safe, call.signal, containment);
      if (!found)
        return answer(
          128,
          "git: Zhiyin could not read this repository's settings whole, so git did not run.",
        );
      const environment = {
        ...base,
        ...asEnvironment(turnedOff(found, proxy?.address, nowhere, templates)),
        ...(proxy
          ? { HTTPS_PROXY: proxy.address, HTTP_PROXY: proxy.address }
          : {}),
      };
      const away = await repositoryInside(
        git,
        cwd,
        folders,
        environment,
        call.signal,
        containment,
      );
      if ("refused" in away) return answer(128, `git: ${away.refused}`);
      const leading = await linkLeadingOut(
        away.paths.length ? away.paths : [cwd],
        folders,
      );
      if (leading)
        return answer(
          128,
          `git: ${leading.link} is a junction or symbolic link to ${leading.real}, outside the folders this shell may change. git would read and write through it with the person's own access, so git through Zhiyin does not run in this ${away.paths.length ? "repository" : "folder"}. ${fullAccess}`,
        );
      const kept: { stdout?: Buffer; stderr?: Buffer } = {};
      const run = await runProcess({
        executable: git,
        arguments: withoutConverters(call.args),
        cwd,
        timeoutMs,
        maximumOutputBytes: largestOutput,
        maximumOutputCharacters: 2_000,
        environment,
        signal: call.signal,
        ...(call.input ? { input: call.input } : {}),
        ...(containment ? { containment } : {}),
        keep: async (files) => {
          [kept.stdout, kept.stderr] = await Promise.all([
            readFile(files.stdout),
            readFile(files.stderr),
          ]);
        },
      });
      const reached = proxy?.reached() ?? [];
      const network = {
        refusedHosts: refused(reached),
        received: reached.some((reach) => reach.received > 0),
      };
      if (run.failure)
        return answer(128, "git: git could not be started.", network);
      const ended =
        run.ending === "timeout"
          ? `git: the command ran longer than ${timeoutMs / 60_000} minutes and was stopped.\n`
          : run.ending === "outputLimit"
            ? "git: the command printed more than 64 MB and was stopped.\n"
            : "";
      return {
        exitCode: run.exitCode ?? 128,
        stdout: kept.stdout ?? Buffer.alloc(0),
        stderr: Buffer.concat([
          kept.stderr ?? Buffer.alloc(0),
          Buffer.from(ended),
        ]),
        ...network,
      };
    } finally {
      await proxy?.close();
      await rm(templates, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  };
}
