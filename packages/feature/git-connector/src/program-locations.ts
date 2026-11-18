/**
 * Git's own records in a folder, which a sealed-off script may only read
 * (ADR 0012). Zhiyin does not copy them, so a script that deleted an object
 * or a ref would lose history nothing could put back; and their
 * configuration and hooks decide what a later git run, with the person's
 * full access, starts. Read from the files alone: nothing runs git.
 *
 * Each git folder in the folder is held whole: the repository's, every
 * repository nested deeper in it, and a submodule's or linked worktree's kept
 * outside it. What installed packages keep is left out: no one commits there. A gitfile, the `.git`
 * file of a submodule or linked worktree that names its git folder, is held
 * too, and the folders it is in cannot be moved, so it cannot be swapped for
 * another.
 */

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { below } from "@zhiyin/path-comparison";

export type GitLocation = {
  /** The full path. */
  readonly path: string;
  /**
   * `tree`: a folder and everything in it may only be read. `read-only`: a
   * sealed-off program may only read it. `in-place`: it may change what the
   * folder holds, but not move it.
   */
  readonly hold: "tree" | "read-only" | "in-place";
};

/** What a path is, without following a link; nothing when it is not there. */
async function kind(
  path: string,
): Promise<"file" | "folder" | "link" | undefined> {
  const found = await lstat(path).catch(() => undefined);
  if (!found) return undefined;
  if (found.isSymbolicLink()) return "link";
  if (found.isDirectory()) {
    // A junction reads as a folder to lstat; its real place says otherwise.
    const real = await realpath(path).catch(() => path);
    return real.toLowerCase() === resolve(path).toLowerCase()
      ? "folder"
      : "link";
  }
  return found.isFile() ? "file" : undefined;
}

/** The value of a key in a git configuration file's `[core]` section. */
function coreValue(text: string, key: string): string | undefined {
  let core = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      core = /^\[\s*core\s*\]/i.test(line);
      continue;
    }
    if (!core) continue;
    const match = new RegExp(`^${key}\\s*=\\s*(.*)$`, "i").exec(line);
    if (match) return match[1]?.replace(/^"(.*)"$/, "$1").trim();
  }
  return undefined;
}

/**
 * Where a gitfile, a `.git` that is a file, says its git folder is, as git
 * reads it: relative to the file's folder.
 */
export async function gitfileTarget(path: string): Promise<string | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  const named = text && /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
  return named ? resolve(dirname(path), named) : undefined;
}

/** Collects the locations of the git folders in `root`. */
class Locations {
  readonly #root: string;
  readonly #found = new Map<string, GitLocation>();
  readonly #gitFolders = new Set<string>();
  /** Git folders held whole. */
  readonly #trees = new Set<string>();

  constructor(root: string) {
    this.#root = root;
  }

  get all(): GitLocation[] {
    return [...this.#found.values()];
  }

  #add(path: string, hold: GitLocation["hold"]) {
    // What a git folder held whole holds is held with it.
    if ([...this.#trees].some((tree) => below(tree, path))) return;
    const key = path.toLowerCase();
    // A path asked for twice keeps the stricter hold.
    if (this.#found.get(key)?.hold === "in-place" || !this.#found.has(key))
      this.#found.set(key, { path, hold });
  }

  /** A gitfile in the workspace, and the folders it is in, kept where they are. */
  async gitfile(path: string) {
    if (!below(this.#root, path) || (await kind(path)) !== "file") return;
    this.#add(path, "read-only");
    for (
      let folder = dirname(path);
      below(this.#root, folder);
      folder = dirname(folder)
    )
      this.#add(folder, "in-place");
    const target = await gitfileTarget(path);
    if (target) await this.gitFolder(target);
  }

  /** One git folder in the workspace: what in it decides what git runs. */
  async gitFolder(folder: string) {
    const key = folder.toLowerCase();
    if (
      this.#gitFolders.has(key) ||
      !below(this.#root, folder) ||
      (await kind(folder)) !== "folder"
    )
      return;
    this.#gitFolders.add(key);
    // Held whole, unless a git folder it is in is held whole already.
    if (![...this.#trees].some((tree) => below(tree, folder))) {
      this.#trees.add(folder);
      this.#add(folder, "tree");
    }
    // A submodule's working folder is named in its configuration.
    const config = await readFile(join(folder, "config"), "utf8").catch(
      () => "",
    );
    const worktree = coreValue(config, "worktree");
    if (worktree) await this.gitfile(join(resolve(folder, worktree), ".git"));
    // A linked worktree's git folder names the gitfile that leads to it.
    const named = await readFile(join(folder, "gitdir"), "utf8").catch(
      () => undefined,
    );
    if (named?.trim()) await this.gitfile(resolve(folder, named.trim()));
    await this.#nested(join(folder, "modules"));
    const worktrees = join(folder, "worktrees");
    if ((await kind(worktrees)) === "folder") {
      for (const name of await readdir(worktrees).catch(() => [] as string[]))
        await this.gitFolder(join(worktrees, name));
    }
  }

  /**
   * The modules folder: a submodule's name may hold slashes, so each folder
   * in it is a git folder or holds more of them.
   */
  async #nested(folder: string) {
    if ((await kind(folder)) !== "folder") return;
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      const path = join(folder, name);
      if ((await kind(path)) !== "folder") continue;
      const isGitFolder =
        (await kind(join(path, "HEAD"))) === "file" ||
        (await kind(join(path, "config"))) === "file";
      if (isGitFolder) await this.gitFolder(path);
      else await this.#nested(path);
    }
  }
}

/** Folders that hold what installers put there, where no one commits. */
const installed = new Set(["node_modules"]);

/** How deep the walk goes, so a folder that leads back into itself ends. */
const deepest = 64;

/**
 * Every repository nested in `root` below its top: each `.git` folder or
 * gitfile found, never walked into, and no link followed.
 */
async function nestedRepositories(root: string, locations: Locations) {
  const pending = [{ folder: root, depth: 0 }];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { folder, depth } = next;
    const entries = await readdir(folder, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.name.toLowerCase() === ".git") {
        // The top's own is found on its own.
        if (folder === root) continue;
        if (entry.isDirectory()) await locations.gitFolder(path);
        else if (entry.isFile()) await locations.gitfile(path);
        continue;
      }
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !installed.has(entry.name.toLowerCase()) &&
        depth < deepest
      )
        pending.push({ folder: path, depth: depth + 1 });
    }
  }
}

/**
 * The places in `root` that decide what a later git run in it starts, each
 * with how a sealed-off program is held from it. Nothing when the folder
 * holds no repository; a `.git` that is a link is not followed.
 */
export async function gitProgramLocations(
  root: string,
): Promise<GitLocation[]> {
  const real = await realpath(root).catch(() => undefined);
  if (!real) return [];
  const locations = new Locations(real);
  const dotGit = join(real, ".git");
  const found = await kind(dotGit);
  if (found === "folder") await locations.gitFolder(dotGit);
  else if (found === "file") await locations.gitfile(dotGit);
  await nestedRepositories(real, locations);
  return locations.all;
}
