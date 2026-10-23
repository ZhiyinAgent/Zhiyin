import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { endings, readGit, type GitContainment } from "./run-git.js";

export type RepositoryCheck =
  /** `top` is the work tree git acts on. */
  | { readonly ok: true; readonly top: string }
  | { readonly ok: false; readonly reason: string };

const real = (path: string) => realpath(path).catch(() => resolve(path));

/** A path on another computer, which looking at would reach over the network. */
const remote = (path: string) => /^[\\/]{2}/.test(path);

function within(folder: string, path: string): boolean {
  return (
    path === folder ||
    path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
  );
}

const isLink = async (path: string) =>
  (await lstat(path).catch(() => undefined))?.isSymbolicLink() ?? false;

/** The folder holding the nearest `.git` at or above `folder`. */
async function nearestGitEntry(folder: string) {
  for (let current = folder; ; current = dirname(current)) {
    const entry = await lstat(join(current, ".git")).catch(() => undefined);
    if (entry)
      return {
        holder: current,
        file: entry.isFile(),
        link: entry.isSymbolicLink(),
      };
    if (dirname(current) === current) return undefined;
  }
}

/** Where a `.git` file points, as git reads it: relative to the file's folder. */
async function pointedTo(gitFile: string): Promise<string | undefined> {
  const text = await readFile(gitFile, "utf8").catch(() => undefined);
  const named = /^gitdir: (.+)$/m.exec(text ?? "")?.[1]?.trim();
  return named === undefined ? undefined : resolve(dirname(gitFile), named);
}

/**
 * Whether `history` is the record git keeps for the linked work tree whose
 * `.git` file is `gitFile`: `<common>/worktrees/<name>`, naming that file
 * back, by a full path or one relative to the record.
 */
async function linkedRecord(
  history: string,
  common: string,
  gitFile: string,
): Promise<boolean> {
  const named = await readFile(join(history, "gitdir"), "utf8").catch(
    () => undefined,
  );
  return (
    named !== undefined &&
    (await real(resolve(history, named.trim()))) === (await real(gitFile)) &&
    common === (await real(join(history, "..", "..")))
  );
}

/**
 * The histories of the repositories above `folder`: each `.git` folder, and
 * each linked work tree's record and its common history, once the record
 * names that work tree back. A submodule's history is kept inside one.
 */
async function enclosingHistories(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (let current = dirname(folder); ; current = dirname(current)) {
    const gitPath = join(current, ".git");
    const entry = await lstat(gitPath).catch(() => undefined);
    if (entry?.isDirectory()) found.push(await real(gitPath));
    else if (entry?.isFile()) {
      const pointed = await pointedTo(gitPath);
      if (pointed) {
        const record = await real(pointed);
        const common = await real(join(record, "..", ".."));
        if (await linkedRecord(record, common, gitPath))
          found.push(record, common);
      }
    }
    if (dirname(current) === current) return found;
  }
}

/** Git reads alternates up to five deep. */
const alternateDepth = 5;

/**
 * Whether a history keeps its objects and references where it is: none of
 * its own entries, nothing in its objects or its references at any depth, is
 * a link, and every object store its `alternates` borrow from, however deep,
 * is inside `folder`. Its hooks may be links: they are not its history.
 */
async function keptInside(history: string, folder: string): Promise<boolean> {
  const objects = join(history, "objects");
  for (const name of await readdir(history).catch(() => []))
    if (await isLink(join(history, name))) return false;
  for (const kept of [objects, join(history, "refs")]) {
    // Listed as the folder holds them: a link is reported, never followed.
    const entries = await readdir(kept, {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    if (entries.some((entry) => entry.isSymbolicLink())) return false;
  }
  const stores = [objects];
  for (let depth = 0; depth < alternateDepth && stores.length; depth += 1) {
    const store = stores.shift()!;
    const listed = await readFile(
      join(store, "info", "alternates"),
      "utf8",
    ).catch(() => "");
    for (const line of listed.split(/\r?\n/)) {
      const named = line.trim();
      if (!named || named.startsWith("#")) continue;
      const borrowed = isAbsolute(named) ? named : resolve(store, named);
      if (remote(borrowed) || !within(folder, await real(borrowed)))
        return false;
      stores.push(borrowed);
    }
  }
  return true;
}

/**
 * Whether git, run in `root`, acts on the repository the folder holds. A
 * folder can arrive with its `.git` from anywhere, and the repository's own
 * files can send git elsewhere: its settings can name another work tree
 * (`core.worktree`), its `.git` can be a file or a link naming another
 * repository's history, as can a `commondir`, and its history can borrow
 * another's objects, through `alternates` or a link. Git runs only where the
 * folder holding the nearest `.git` is the work tree, and the history is
 * that folder's own, a submodule's kept in an enclosing repository's
 * history, or a linked work tree's whose record names this folder back; and
 * where that history keeps its objects and references inside the
 * repository's own folders.
 *
 * Asked as a read, so it starts nothing. Where git cannot say, nothing runs,
 * and git's answer, or the read's refusal, says why.
 */
export async function checkRepository(
  git: string,
  root: string,
  signal: AbortSignal | undefined,
  containment: GitContainment | undefined,
): Promise<RepositoryCheck> {
  const asked = await readGit(
    git,
    root,
    [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ],
    signal,
    containment,
  );
  const [top, gitDir, commonDir] = asked.stdout.trim().split(/\r?\n/);
  if (asked.exitCode !== 0 || asked.ending || !top || !gitDir || !commonDir)
    return {
      ok: false,
      reason:
        (asked.ending && endings[asked.ending]) ||
        asked.stderr.trim() ||
        "Git could not say which repository this folder holds, so Zhiyin runs no git in it.",
    };
  const nearby = remote(root);
  if (!nearby && [top, gitDir, commonDir].some(remote))
    return {
      ok: false,
      reason: `Git would reach a repository over the network, where this folder's .git points. Zhiyin runs no git in it.`,
    };
  const actsOn = await real(top);
  const history = await real(gitDir);
  const common = await real(commonDir);
  const entry = await nearestGitEntry(await real(root));
  const holder = entry ? await real(entry.holder) : undefined;
  if (!entry || !holder || actsOn !== holder)
    return {
      ok: false,
      reason: `Git would act on ${actsOn}, not on the folder that holds this repository, ${holder ?? root}: its own files point there. Zhiyin runs no git in it.`,
    };
  const elsewhere = {
    ok: false,
    reason: `Git would read the history kept in ${common === history ? history : common}, which is not this folder's own: its .git points there. Zhiyin runs no git in it.`,
  } as const;
  const gitPath = join(holder, ".git");
  if (entry.link) return elsewhere;
  let own: boolean;
  if (!entry.file)
    own = history === (await real(gitPath)) && common === history;
  else {
    const submodule =
      common === history &&
      (await enclosingHistories(holder)).some(
        (kept) => kept !== history && within(kept, history),
      );
    own = submodule || (await linkedRecord(history, common, gitPath));
  }
  if (!own) return elsewhere;
  // The history's objects stay within the repository it belongs to: the
  // folder holding the `.git` it is kept in, which for a linked work tree or
  // a submodule is the repository keeping it.
  const kept = common.split(sep);
  const dotGit = kept.lastIndexOf(".git");
  const keeper = dotGit > 0 ? kept.slice(0, dotGit).join(sep) : holder;
  for (const store of new Set([history, common]))
    if (!(await keptInside(store, keeper)))
      return {
        ok: false,
        reason: `The history git would read here keeps objects or references somewhere else, through a link or a list of other object stores. Zhiyin runs no git in it.`,
      };
  return { ok: true, top: actsOn };
}
