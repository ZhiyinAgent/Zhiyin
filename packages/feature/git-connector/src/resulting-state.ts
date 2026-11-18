/**
 * What a call that changed the repository left, read back once it has run:
 * the branch and commit it is on, what is staged, what is left uncommitted,
 * and how many stashes are kept. Each is read as any read is, starting none
 * of the repository's own programs, so the answer says what really holds
 * now rather than what was asked for.
 */

import type { GitCall } from "./git-tool.js";

type Reader = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string | undefined>;

/** Reads git's answer to `args`, or nothing when it failed or was ended. */
export function reader(call: GitCall): Reader {
  return async (args, signal) => {
    const ran = await call.read(args, signal);
    return ran.exitCode === 0 && !ran.ending ? ran.stdout : undefined;
  };
}

/** The branch checked out, or nothing when HEAD is on no branch. */
export async function currentBranch(read: Reader): Promise<string | undefined> {
  return (await read(["symbolic-ref", "--quiet", "--short", "HEAD"]))?.trim();
}

/** The commit a reference names, as its short hash and subject. */
export async function commitAt(
  read: Reader,
  ref = "HEAD",
): Promise<string | undefined> {
  return (
    await read([
      "log",
      "-1",
      "--no-show-signature",
      "--format=%h %s",
      ref,
      "--",
    ])
  )?.trim();
}

/** "Now on main at 1a2b3c4 Add note." */
function where(branch: string | undefined, commit: string | undefined) {
  const on = branch ?? "no branch";
  return commit
    ? `Now on ${on} at ${commit}.`
    : `Now on ${on}, with no commit yet.`;
}

/**
 * The branch a status header names, and whether it has a commit yet. A
 * branch name holds no space and no "...", so neither git's words for no
 * branch nor the upstream that follows a name can be read as part of one.
 * Porcelain status is never translated.
 */
function headOf(header: string): {
  readonly branch: string | undefined;
  readonly born: boolean;
} {
  const named = header.slice("## ".length);
  if (named.startsWith("HEAD (no branch)"))
    return { branch: undefined, born: true };
  const unborn = /^No commits yet on (\S+)/.exec(named);
  if (unborn) return { branch: unborn[1], born: false };
  return { branch: named.split(/\.\.\.| /)[0], born: true };
}

/**
 * Where a change left the repository, from one status with its branch:
 * the branch it is on, and "Now on main at 1a2b3c4 Add note." followed by
 * what is left uncommitted.
 */
export async function standing(
  read: Reader,
): Promise<{ readonly branch: string | undefined; readonly said: string }> {
  const status = await read([
    ...statusArguments,
    "--branch",
    "--no-ahead-behind",
  ]);
  const [header, ...entries] = status?.split("\0") ?? [];
  if (status === undefined || !header?.startsWith("## ")) {
    const [branch, commit] = await Promise.all([
      currentBranch(read),
      commitAt(read),
    ]);
    return { branch, said: `${where(branch, commit)} ${notRead}` };
  }
  const { branch, born } = headOf(header);
  const [commit, left] = await Promise.all([
    born ? commitAt(read) : undefined,
    counted(read, entries),
  ]);
  return { branch, said: `${where(branch, commit)} ${left}` };
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** How long counting the files in untracked folders may take. */
const countingMs = 3_000;

/**
 * How many files git does not track lie in untracked folders, from the whole
 * repository, or nothing when git could not say in time. Git lists a folder
 * holding only untracked files as one entry, so its files are counted apart,
 * for a short while only: a huge folder is named without its count.
 */
async function filesInUntrackedFolders(
  read: Reader,
  looseFiles: number,
): Promise<number | undefined> {
  const stop = new AbortController();
  const limit = setTimeout(() => stop.abort(), countingMs);
  const listed = await read(
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ":(top)"],
    stop.signal,
  ).finally(() => clearTimeout(limit));
  if (listed === undefined) return undefined;
  // A repository nested in a folder is listed as itself, not as its files.
  const files = listed
    .split("\0")
    .filter((path) => path && !path.endsWith("/")).length;
  const inFolders = files - looseFiles;
  return inFolders > 0 ? inFolders : undefined;
}

const statusArguments = [
  "status",
  "--porcelain=v1",
  "-z",
  "--ignore-submodules=dirty",
];

const notRead = "What is left uncommitted could not be read.";

/**
 * What is not committed, by count: staged, changed and untracked files, and
 * the untracked folders with how many files they hold.
 */
export async function leftUncommitted(read: Reader): Promise<string> {
  const status = await read(statusArguments);
  return status === undefined ? notRead : counted(read, status.split("\0"));
}

/** What is left uncommitted, from the entries of a status. */
async function counted(
  read: Reader,
  entries: readonly string[],
): Promise<string> {
  let staged = 0;
  let changed = 0;
  let untracked = 0;
  let untrackedFolders = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.length < 3) continue;
    const [x, y] = [entry[0], entry[1]];
    if (x === "?") {
      if (entry.endsWith("/")) untrackedFolders += 1;
      else untracked += 1;
    } else {
      if (x !== " ") staged += 1;
      if (y !== " ") changed += 1;
    }
    // A rename or copy names the path it came from next.
    if (x === "R" || x === "C") index += 1;
  }
  let folders: string | undefined;
  if (untrackedFolders) {
    const files = await filesInUntrackedFolders(read, untracked);
    folders = `${plural(untrackedFolders, "untracked folder")} (${files === undefined ? "files not counted" : plural(files, "file")})`;
  }
  const parts = [
    staged ? `${plural(staged, "staged file")}` : undefined,
    changed ? `${plural(changed, "changed file")}` : undefined,
    untracked ? `${plural(untracked, "untracked file")}` : undefined,
    folders,
  ].filter((part) => part !== undefined);
  return parts.length
    ? `Not committed: ${parts.join(", ")}.`
    : "Nothing is left uncommitted.";
}

/** How many stashes are kept, or nothing when git could not say. */
export async function stashCount(read: Reader): Promise<number | undefined> {
  const list = await read(["stash", "list", "-z"]);
  return list === undefined
    ? undefined
    : list.split("\0").filter(Boolean).length;
}

/** Each index entry under `paths`, by path, as its mode and object. */
export async function indexEntries(
  read: Reader,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string> | undefined> {
  const listed = await read(["ls-files", "--stage", "-z", "--", ...paths]);
  if (listed === undefined) return undefined;
  const entries = new Map<string, string>();
  for (const entry of listed.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    entries.set(entry.slice(tab + 1), entry.slice(0, tab));
  }
  return entries;
}

/** The paths whose index entry differs between two readings of the index. */
export function changedEntries(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}
