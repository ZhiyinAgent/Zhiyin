/**
 * The backup around a program that may change any file in its folder: a
 * Python or Blender script, or a shell command (ADR 0012). The folder is
 * copied before approval and again just before the run, so going back puts
 * back every file the run created, changed or deleted. A script given
 * folders outside the workspace has each of them copied the same way, beside
 * the workspace. What a sealed-off program could change and Zhiyin could not
 * copy, Git's folder whole, and any Startup folder it could reach are held
 * from it for the run instead: it may read them and change nothing of them,
 * and their own permissions come back after.
 */

import { realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { CommandFileChanges } from "@zhiyin/contract";
import type { HeldPath, ReadOnlyHolds } from "@zhiyin/sandbox";
import { holds, startupFolders } from "@zhiyin/workspace-containment";
import type { FolderCopy } from "./folder-copies.js";
import type { Recovery } from "./recovery.js";

/** What a later git run in a folder starts from; handed in. */
export type ProgramLocations = (root: string) => Promise<readonly HeldPath[]>;

/** The backup of a run's folders, taken before approval. */
export type RunBackup = FolderCopy;

/** Why a path is held from a run: not copied, Git's, or a Startup folder. */
export type HeldKind = "uncopied" | "git" | "startup";

/** Whether the run may start, and what is held from it while it runs. */
export type RunStart =
  | {
      readonly ok: true;
      /**
       * What a sealed-off program may only read for this run, and why: in
       * the workspace by its path there, elsewhere by its whole path.
       */
      readonly held: readonly {
        readonly path: string;
        readonly reason: string;
        readonly kind: HeldKind;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

const gitReason =
  "Git's records are not copied, and its configuration and hooks decide what a later git run starts, so a sealed-off program may only read them.";

const startupReason =
  "Windows starts what is put in a Startup folder whenever someone signs in, so a sealed-off program may only read it.";

/** A folder outside the workspace the program is given. */
type Outside = {
  readonly path: string;
  /** Inside another of the folders given, which copies it with its own. */
  readonly nested: boolean;
  /** The workspace, when the folder holds it: its copy is the workspace's. */
  readonly without: readonly string[];
  /** Whether it was copied before approval. */
  copied: boolean;
  /** What its copy just before the run left out, and why; nothing when it was not copied. */
  uncopied?: readonly { readonly path: string; readonly reason: string }[];
};

type Run = {
  readonly root: string;
  readonly conversationId: string;
  readonly outside: readonly Outside[];
  release?: () => Promise<void>;
};

type Held = { readonly reason: string; readonly kind: HeldKind };

export class RunBackups {
  readonly #recovery: Recovery;
  readonly #holds: Pick<ReadOnlyHolds, "hold"> | undefined;
  readonly #locations: ProgramLocations | undefined;
  readonly #startup: () => readonly string[];
  readonly #runs = new Map<string, Run>();

  constructor(
    recovery: Recovery,
    options: {
      /**
       * Holds paths from sealed-off programs while one runs; absent, a
       * sealed-off run whose folder holds what could not be copied, or
       * Git's folder, does not start.
       */
      readonly holds?: Pick<ReadOnlyHolds, "hold">;
      /** Where Git keeps what decides what a later git run starts. */
      readonly programLocations?: ProgramLocations;
      /**
       * The folders whose programs Windows starts at sign-in; absent, the
       * person's and every account's, where Windows keeps them.
       */
      readonly startupFolders?: () => readonly string[];
    } = {},
  ) {
    this.#recovery = recovery;
    this.#holds = options.holds;
    this.#locations = options.programLocations;
    this.#startup = options.startupFolders ?? startupFolders;
  }

  /**
   * Copies the workspace, then each folder outside it the program is given.
   * Fails, saying why, when the workspace could not be copied, or one of
   * those folders could not be.
   */
  async backUp(
    actionId: string,
    workspaceRoot: string | undefined,
    conversationId: string,
    outsideFolders: readonly string[] = [],
  ): Promise<RunBackup> {
    if (!workspaceRoot)
      return { ok: false, reason: "No folder was open to copy." };
    const root = await realpath(workspaceRoot).catch(() => undefined);
    if (!root)
      return {
        ok: false,
        reason: "The conversation's folder could not be opened.",
      };
    const named = await Promise.all(
      outsideFolders.map((path) => realpath(path).catch(() => resolve(path))),
    );
    const outside: Outside[] = named.map((path) => ({
      path,
      nested: named.some(
        (other) =>
          other.toLowerCase() !== path.toLowerCase() && holds(other, path),
      ),
      without: holds(path, root) ? [root] : [],
      copied: false,
    }));
    this.#runs.set(actionId, { root, conversationId, outside });
    const copy = await this.#copy(actionId, root, conversationId);
    if (!copy.ok) return copy;
    let failed: string | undefined;
    for (const folder of outside) {
      if (folder.nested) continue;
      const copied = await this.#copy(actionId, folder.path, conversationId, {
        outside: folder,
      });
      folder.copied = copied.ok;
      if (!copied.ok)
        failed ??= `${folder.path} could not be copied first: ${copied.reason}`;
    }
    return failed ? { ok: false, reason: failed } : copy;
  }

  async start(
    actionId: string,
    {
      sealed,
      writable,
    }: { readonly sealed: boolean; readonly writable: readonly string[] },
  ): Promise<RunStart> {
    const run = this.#runs.get(actionId);
    if (!run)
      return { ok: false, reason: "No copy of the folder was taken first." };
    const copy = await this.#copy(actionId, run.root, run.conversationId, {
      begins: true,
    });
    if (!copy.ok) return copy;
    // A folder copied before approval was let run on that promise, and must
    // be copied again; one that could not be was asked about as a change
    // that cannot be undone, and is copied now only if it can be.
    for (const folder of run.outside) {
      if (folder.nested) continue;
      const again = await this.#copy(
        actionId,
        folder.path,
        run.conversationId,
        { begins: true, outside: folder },
      );
      if (again.ok) folder.uncopied = again.uncopied;
      else if (folder.copied)
        return {
          ok: false,
          reason: `${folder.path} could not be copied again: ${again.reason}`,
        };
    }
    if (!sealed) return { ok: true, held: [] };
    const given = new Set(
      writable.map((path) => path.replaceAll("\\", "/").toLowerCase()),
    );
    const reasons = new Map<string, Held>();
    const groups: { within: string; paths: HeldPath[] }[] = [];
    const add = (
      group: HeldPath[],
      path: HeldPath,
      reason: string,
      kind: HeldKind,
    ) => {
      reasons.set(path.path.toLowerCase(), { reason, kind });
      group.push(path);
    };
    const workspace: HeldPath[] = [];
    for (const { path, reason } of copy.uncopied)
      if (!given.has(path.toLowerCase()))
        add(
          workspace,
          { path: join(run.root, path), hold: "read-only" },
          reason,
          "uncopied",
        );
    const git = await this.#git(run.root);
    if (!git) return this.#noGit;
    for (const location of git) add(workspace, location, gitReason, "git");
    for (const startup of await this.#startupIn(run.root))
      add(workspace, startup, startupReason, "startup");
    groups.push({ within: run.root, paths: workspace });
    for (const folder of run.outside) {
      const paths: HeldPath[] = [];
      for (const { path, reason } of folder.uncopied ?? []) {
        const full = join(folder.path, path);
        if (!given.has(full.replaceAll("\\", "/").toLowerCase()))
          add(paths, { path: full, hold: "read-only" }, reason, "uncopied");
      }
      const found = await this.#git(folder.path);
      if (!found) return this.#noGit;
      for (const location of found) add(paths, location, gitReason, "git");
      for (const startup of await this.#startupIn(folder.path))
        add(paths, startup, startupReason, "startup");
      groups.push({ within: folder.path, paths });
    }
    if (!groups.some((group) => group.paths.length))
      return { ok: true, held: [] };
    if (!this.#holds)
      return {
        ok: false,
        reason:
          "Zhiyin cannot keep a sealed-off program from the files it could not copy here.",
      };
    const releases: (() => Promise<void>)[] = [];
    const releaseAll = async () => {
      for (const release of releases) await release().catch(() => undefined);
    };
    const held: string[] = [];
    for (const group of groups) {
      if (!group.paths.length) continue;
      const holding = await this.#holds.hold(group.within, group.paths);
      releases.push(() => holding.release());
      if (holding.failed.length) {
        await releaseAll();
        const [first] = holding.failed;
        return {
          ok: false,
          reason: `Zhiyin could not keep the program from changing ${this.#shown(run.root, first!.path)}: ${first!.reason}`,
        };
      }
      held.push(...holding.held);
    }
    run.release = releaseAll;
    return {
      ok: true,
      held: held.map((path) => ({
        path: this.#shown(run.root, path),
        ...(reasons.get(path.toLowerCase()) ?? {
          reason: gitReason,
          kind: "git" as const,
        }),
      })),
    };
  }

  async finish(actionId: string): Promise<CommandFileChanges | undefined> {
    const run = this.#runs.get(actionId);
    if (!run) return undefined;
    this.#runs.delete(actionId);
    // What was held gets its permissions back first, however recording goes.
    await run.release?.().catch(() => undefined);
    try {
      return await this.#recovery.keepFolderChanges(actionId);
    } catch {
      return {
        status: "unchecked",
        reason: "What the run changed could not be recorded.",
      };
    }
  }

  async discard(actionId: string): Promise<void> {
    const run = this.#runs.get(actionId);
    this.#runs.delete(actionId);
    await run?.release?.().catch(() => undefined);
    await this.#recovery.discard(actionId).catch(() => undefined);
  }

  /** Whether a backup is waiting for this action's run to end. */
  waiting(actionId: string): boolean {
    return this.#runs.has(actionId);
  }

  readonly #noGit = {
    ok: false as const,
    reason: "Zhiyin could not find where Git keeps its configuration here.",
  };

  /** Where Git keeps what a later git run in the folder starts from, or nothing when that could not be found. */
  async #git(folder: string): Promise<readonly HeldPath[] | undefined> {
    try {
      return (await this.#locations?.(folder)) ?? [];
    } catch {
      return undefined;
    }
  }

  /**
   * The Startup folders a program given `folder` could add to: the folder
   * itself, whole, when it is in one; a Startup folder in it, whole; and,
   * when that Startup folder is not there, the nearest folder it would be
   * made in, which then takes nothing new.
   */
  async #startupIn(folder: string): Promise<HeldPath[]> {
    const found: HeldPath[] = [];
    for (const startup of this.#startup()) {
      if (holds(startup, folder)) {
        found.push({ path: folder, hold: "tree" });
        continue;
      }
      if (!holds(folder, startup)) continue;
      let nearest = startup;
      while (
        !(await stat(nearest).catch(() => undefined))?.isDirectory() &&
        nearest.toLowerCase() !== folder.toLowerCase()
      )
        nearest = dirname(nearest);
      found.push({
        path: nearest,
        hold: nearest === startup ? "tree" : "read-only",
      });
    }
    return found;
  }

  /** `begins`: the copy is taken as the run begins. */
  #copy(
    actionId: string,
    root: string,
    conversationId: string,
    {
      begins = false,
      outside,
    }: { readonly begins?: boolean; readonly outside?: Outside } = {},
  ): Promise<FolderCopy> {
    return this.#recovery
      .copyFolder(actionId, root, conversationId, {
        begins,
        ...(outside ? { outside: true, without: outside.without } : {}),
      })
      .catch(() => ({
        ok: false as const,
        reason: "Recovery storage was unavailable before this action.",
      }));
  }

  /** A path as the model and the person name it: from the workspace, or elsewhere whole. */
  #shown(root: string, path: string): string {
    return holds(root, path)
      ? relative(root, path).replaceAll("\\", "/")
      : path;
  }
}
