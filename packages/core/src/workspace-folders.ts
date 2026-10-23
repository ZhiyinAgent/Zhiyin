/**
 * Each conversation's folder, the folder shown, and the folders worked in
 * recently (ADR 0008). The workspace owns the conversations and their one
 * save path; this keeps which folder each works in and the one the window
 * shows, and changes them only through that path.
 */

import type {
  WorkspaceContext,
  WorkspaceIssue,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import { sameFolder } from "./folder-paths.js";
import type { Issues } from "./issues.js";
import * as startup from "./startup.js";

type Folder = NonNullable<WorkspaceSnapshot["workspace"]>;

/** The queue of folder choices made with no conversation open. */
const nextConversation = "\u0000next";

export type FolderHost = {
  readonly workspace: WorkspaceContext;
  readonly issues: Issues;
  /** The conversations opened so far, as they are now. */
  readonly tasks: () => readonly WorkspaceTask[];
  /** Replaces one conversation's record with what `change` makes of it. */
  readonly changeTask: (
    taskId: string,
    change: (task: WorkspaceTask) => WorkspaceTask,
  ) => void;
  readonly selectedTaskId: () => string | null;
  /**
   * Whether anything works in the conversation: a turn, a specialist that
   * outlived its turn, or a command carried on as a job.
   */
  readonly works: (taskId: string) => boolean;
  /**
   * Before the conversation is changed outside a turn: refuses while its
   * files are being restored, whose save would put its old folder back.
   */
  readonly beforeChange: (taskId: string) => Promise<void>;
  /** The workspace's one save path. */
  readonly save: () => Promise<void>;
  /** Tells the window the whole snapshot has moved. */
  readonly snapshotChanged: () => void;
};

/** A value as a folder choice found it and as it left it. */
type Changed<T> = { readonly before: T; readonly after: T };

/** What a folder choice changed, so one that cannot be saved puts it back. */
type Choice = {
  readonly recents: Changed<WorkspaceSnapshot["recentWorkspaces"]>;
  readonly launch: Changed<readonly string[]>;
  /** What showing the folder chosen replaced, when it was shown. */
  readonly shown?: {
    readonly chosen: Folder;
    readonly before: WorkspaceSnapshot["workspace"];
    /** Whether it withdrew the report that the folder shown is gone. */
    readonly withdrewMoved: boolean;
  };
};

/** The conversation in the folder given, or in none. */
function withFolder(
  task: WorkspaceTask,
  folder: WorkspaceTask["workspace"],
): WorkspaceTask {
  if (folder) return { ...task, workspace: folder };
  const moved = { ...task };
  delete moved.workspace;
  return moved;
}

export class WorkspaceFolders {
  readonly #host: FolderHost;
  /** The folder the window shows, which a new conversation starts in. */
  #shown: WorkspaceSnapshot["workspace"];
  /**
   * The folders named at launch, this one or an earlier one, that the person
   * has not chosen since. Nobody chose them, so none is ever saved as the
   * folder shown, whichever conversation shows it, and the next launch names
   * its own. Saved, so a conversation started in one shows it at a later
   * launch without it being offered among the recent folders.
   */
  #launchFolders: readonly string[] = [];
  #recents: WorkspaceSnapshot["recentWorkspaces"] = [];
  /**
   * The report each conversation was given that its folder would not open,
   * withdrawn as it was given, whatever the conversation is called since.
   */
  readonly #unopened = new Map<string, WorkspaceIssue>();
  /**
   * A folder change under way for a conversation. Its work waits for it, so
   * a turn never starts while the folder it would run in is still changing.
   */
  readonly #changes = new Map<string, Promise<unknown>>();
  /**
   * The folders chosen for a conversation whose save is still under way. A
   * folder chosen with none open needs none: a new conversation waits for it.
   */
  readonly #saving = new Set<Folder>();
  /**
   * Each folder choice that could not be saved, by the folder it chose: the
   * folder shown before it, which a conversation started from it takes.
   */
  readonly #undone = new WeakMap<Folder, Folder | undefined>();

  constructor(host: FolderHost) {
    this.#host = host;
  }

  restore(restored: {
    readonly workspace: WorkspaceSnapshot["workspace"];
    readonly launchFolders: readonly string[];
    readonly recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"];
  }): void {
    this.#shown = restored.workspace;
    this.#launchFolders = restored.launchFolders;
    this.#recents = restored.recentWorkspaces;
    this.#unopened.clear();
  }

  launchFolders(): readonly string[] {
    return this.#launchFolders;
  }

  /** The folder shown, as a field of a snapshot. */
  shownField(): { readonly workspace?: Folder } {
    return this.#shown ? { workspace: this.#shown } : {};
  }

  /** The folder shown now, which a new conversation will start in. */
  forNew(): Folder | undefined {
    return this.#shown;
  }

  /**
   * The folder a new conversation starts in: the one shown, or `from`, the one
   * shown when it was asked for, once the person has opened another meanwhile;
   * a choice of it that could not be saved gives the folder from before. When
   * the one shown is a folder chosen whose save is still under way, it is the
   * new conversation's from now on, as going to it would make it: a failure of
   * that save then finds the folder shown and the recent ones changed since,
   * and leaves them to the new conversation.
   */
  startNew(from?: { readonly folder: Folder | undefined }): {
    readonly workspace?: Folder;
  } {
    if (from) {
      let folder = from.folder;
      while (folder && this.#undone.has(folder))
        folder = this.#undone.get(folder);
      return folder ? { workspace: folder } : {};
    }
    if (!this.#shown) return {};
    if (this.#saving.has(this.#shown)) {
      this.#shown = { ...this.#shown };
      this.#recents = [...this.#recents];
    }
    return { workspace: this.#shown };
  }

  recents(): WorkspaceSnapshot["recentWorkspaces"] {
    return this.#recents;
  }

  /** The folder shown as it is saved: never the one named at launch. */
  savedField(): { readonly workspace?: Folder } {
    return this.#shown && !this.#fromLaunch(this.#shown)
      ? { workspace: this.#shown }
      : {};
  }

  /**
   * A turn runs where its conversation lives, whatever the window shows: each
   * conversation has its own folder, so conversations in different folders
   * work at the same time. The conversation on screen, started before a
   * folder was chosen, takes the one shown; one that is not shown, woken by
   * its own work, has no folder to take. A folder that opens again, after it
   * would not, is shown like one opened by going to its conversation.
   */
  async enterFolderOf(taskId: string): Promise<void> {
    await this.#settled(taskId);
    const { workspace } = this.#host;
    const started = this.#host.tasks().find((task) => task.id === taskId);
    if (!started || !workspace.enterFolder) return;
    const folder =
      started.workspace ??
      (this.#host.selectedTaskId() === taskId ? this.#shown : undefined);
    if (!folder) return;
    let name: string;
    try {
      name = await workspace.enterFolder(taskId, folder.path);
    } catch {
      // Said where the person sees it, a turn woken by the conversation's own
      // work included.
      if (
        started.workspace &&
        this.#host.tasks().some((task) => task.id === taskId) &&
        this.#reportUnopened(started)
      )
        this.#host.snapshotChanged();
      throw new VisibleError(
        "The folder for this conversation could not be opened. Choose its new location, then send again.",
      );
    }
    // Deleted while its folder opened: it keeps none.
    if (!this.#host.tasks().some((task) => task.id === taskId)) {
      workspace.leaveFolder?.(taskId);
      return;
    }
    if (!started.workspace)
      this.#host.changeTask(taskId, (task) => withFolder(task, folder));
    if (this.#opened(started, { path: folder.path, name }))
      this.#host.snapshotChanged();
  }

  /**
   * A conversation's folder has opened: it is shown while its conversation is
   * on screen, the report that it would not is withdrawn, and so is the report
   * that the folder shown is gone once the folder shown is this one. Answers
   * whether that changed anything.
   */
  #opened(task: WorkspaceTask, folder: Folder): boolean {
    const displayed = this.#display(folder, task.id);
    const withdrawn = this.#withdrawUnopened(task.id);
    const moved =
      this.#shown !== undefined &&
      sameFolder(this.#shown.path, folder.path) &&
      this.#withdrawMoved();
    return displayed || withdrawn || moved;
  }

  /** Reports that a conversation's folder would not open, in place of any earlier report. */
  #reportUnopened(task: WorkspaceTask): boolean {
    this.#withdrawUnopened(task.id);
    const issue: WorkspaceIssue = {
      message: startup.unopenedFolderNotice(task),
      conversationId: task.id,
    };
    this.#unopened.set(task.id, issue);
    return this.#host.issues.add(issue);
  }

  /** Withdraws the report that a conversation's folder would not open, and answers whether there was one. */
  #withdrawUnopened(taskId: string): boolean {
    const issue = this.#unopened.get(taskId);
    if (!issue) return false;
    this.#unopened.delete(taskId);
    const said = this.#host.issues
      .list()
      .some(
        (item) =>
          item.message === issue.message &&
          item.conversationId === issue.conversationId,
      );
    this.#host.issues.withdraw(issue);
    return said;
  }

  /** Withdraws the report that the folder shown is gone, and answers whether it was said. */
  #withdrawMoved(): boolean {
    const { issues } = this.#host;
    const said = issues
      .list()
      .some((issue) => issue.message === startup.movedWorkspaceNotice);
    issues.remove(startup.movedWorkspaceNotice);
    return said;
  }

  /**
   * Shows the folder of the conversation now on screen, which a new
   * conversation then starts in, and answers whether anything changed. It
   * waits for a folder change of that conversation under way, and a change
   * chosen after it waits for it.
   *
   * A folder that will not open is reported and nothing else: relabelling the
   * folder shown with the name of one that failed to open would be a lie
   * about where the next action would run, so the folder is opened here
   * rather than taken to be open. For a conversation whose work is running it
   * is only checked: that work keeps the folder it entered for its whole
   * length. A conversation with no recorded folder is left alone rather than
   * given one. The folder shown changes only while the conversation is still
   * the one on screen.
   */
  show(task: WorkspaceTask): Promise<boolean> {
    return this.#queued(task.id, () => this.#show(task.id));
  }

  async #show(taskId: string): Promise<boolean> {
    const { workspace } = this.#host;
    const current = this.#host.tasks().find((item) => item.id === taskId);
    const wanted = current?.workspace;
    if (!current || !wanted || !workspace.enterFolder) return false;
    const exists = () => this.#host.tasks().some((item) => item.id === taskId);
    const check = this.#host.works(taskId)
      ? workspace.checkFolder?.bind(workspace)
      : undefined;
    let name: string;
    try {
      name = check
        ? await check(wanted.path)
        : await workspace.enterFolder(taskId, wanted.path);
    } catch {
      // Deleted meanwhile: there is nobody left to tell.
      if (!exists()) return false;
      // Said about the folder shown, it is now said about its conversation.
      if (this.#shown && sameFolder(wanted.path, this.#shown.path))
        this.#withdrawMoved();
      return this.#reportUnopened(current);
    }
    if (!exists()) {
      if (!check) workspace.leaveFolder?.(taskId);
      return false;
    }
    return this.#opened(current, { path: wanted.path, name });
  }

  /**
   * Shows a conversation's folder, while that conversation is on screen, and
   * answers whether that changed anything.
   */
  #display(folder: Folder, taskId: string): boolean {
    if (this.#host.selectedTaskId() !== taskId) return false;
    const changed =
      folder.path !== this.#shown?.path || folder.name !== this.#shown?.name;
    this.#shown = folder;
    // The folder named at launch is offered again only once it is chosen.
    if (this.#fromLaunch(folder)) return changed;
    const recents = startup.withRecentWorkspace(this.#recents, folder);
    const reordered = recents.some(
      (item, index) => item.path !== this.#recents[index]?.path,
    );
    this.#recents = recents;
    return changed || reordered;
  }

  /**
   * The folder picker: the folder of the conversation on screen, or, with
   * none open, the one the next conversation starts in. A conversation's
   * folder does not change while anything works in it, and one change of it
   * finishes before the next, or its next turn, begins.
   */
  async choose(path: string): Promise<void> {
    const conversationId = this.#host.selectedTaskId();
    // One after another, so the last folder chosen is the one kept.
    if (!conversationId)
      return this.#queued(nextConversation, () => this.#chooseNext(path));
    if (!this.#host.tasks().some((task) => task.id === conversationId))
      throw new VisibleError(
        "This conversation could not be opened, so it has no folder to change.",
      );
    // Asked of what works now: a turn sent after this waits for it, and is no
    // reason to refuse it.
    if (this.#host.works(conversationId))
      throw new VisibleError(
        "Stop this conversation's work before changing its folder.",
      );
    await this.#queued(conversationId, async () => {
      await this.#host.beforeChange(conversationId);
      await this.#move(conversationId, path);
    });
  }

  /** Whether a folder was named at launch and nobody chose it yet. */
  #fromLaunch(folder: WorkspaceSnapshot["workspace"]): boolean {
    return (
      folder !== undefined &&
      this.#launchFolders.some((item) => sameFolder(item, folder.path))
    );
  }

  /**
   * A folder chosen now is no longer one nobody chose: it leaves the list of
   * folders named at launch.
   */
  #chosen(path: string): void {
    if (this.#launchFolders.some((item) => sameFolder(item, path)))
      this.#launchFolders = this.#launchFolders.filter(
        (item) => !sameFolder(item, path),
      );
  }

  /**
   * Makes a folder the one chosen: first among the recent ones, off the list
   * of those named at launch, and shown when `show` says so. Says what it
   * changed.
   */
  #choose(chosen: Folder, show: boolean): Choice {
    const recents = { before: this.#recents, after: this.#recents };
    const launch = { before: this.#launchFolders, after: this.#launchFolders };
    this.#recents = recents.after = startup.withRecentWorkspace(
      this.#recents,
      chosen,
    );
    this.#chosen(chosen.path);
    launch.after = this.#launchFolders;
    if (!show) return { recents, launch };
    const before = this.#shown;
    this.#shown = chosen;
    return {
      recents,
      launch,
      shown: { chosen, before, withdrewMoved: this.#withdrawMoved() },
    };
  }

  /**
   * After a folder choice that could not be saved: each thing it changed goes
   * back unless something else changed it since, which then stands, and the
   * choice is saved away, so a save of something else made meanwhile, which
   * recorded it, is undone on disk too. The folders named at launch go back
   * only with the recent ones, so no folder is both offered among the recent
   * ones and unchosen. `reopened` shows the conversation's own folder when
   * it opened again in its place.
   */
  async #undo(choice: Choice, reopened?: () => void): Promise<void> {
    const { recents, launch, shown } = choice;
    const recentsBack = this.#recents === recents.after;
    if (recentsBack) this.#recents = recents.before;
    if (recentsBack && this.#launchFolders === launch.after)
      this.#launchFolders = launch.before;
    if (shown) this.#undone.set(shown.chosen, shown.before);
    if (shown && this.#shown === shown.chosen) {
      this.#shown = shown.before;
      if (shown.withdrewMoved)
        this.#host.issues.add(startup.movedWorkspaceNotice);
    }
    reopened?.();
    // A failure here is reported by the save itself.
    await this.#host.save().catch(() => undefined);
  }

  /**
   * Runs one folder step of a conversation after the ones before it, and is
   * known at once, so a turn sent right after it waits for it.
   */
  #queued<T>(taskId: string, step: () => Promise<T>): Promise<T> {
    const before = this.#changes.get(taskId);
    const running = (async () => {
      await before?.catch(() => undefined);
      return step();
    })();
    this.#changes.set(taskId, running);
    const done = () => {
      if (this.#changes.get(taskId) === running) this.#changes.delete(taskId);
    };
    running.then(done, done);
    return running;
  }

  /**
   * Waits for the folder steps a new conversation starts after: a folder
   * chosen with none open, and any change of the conversation on screen. New
   * task then starts where the person was looking.
   */
  async settledForNew(): Promise<void> {
    await this.#settled(nextConversation);
    const selected = this.#host.selectedTaskId();
    if (selected) await this.#settled(selected);
  }

  /** Waits until no folder step is under way for the conversation. */
  async #settled(taskId: string): Promise<void> {
    for (
      let change = this.#changes.get(taskId);
      change;
      change = this.#changes.get(taskId)
    )
      await change.catch(() => undefined);
  }

  /** With no conversation open, the folder the next one starts in. */
  async #chooseNext(path: string): Promise<void> {
    const { workspace } = this.#host;
    if (!workspace.checkFolder)
      throw new VisibleError("Folder selection is unavailable.");
    const name = await workspace.checkFolder(path);
    const chosen: Folder = { path, name };
    // Shown only while still no conversation is open.
    const choice = this.#choose(chosen, this.#host.selectedTaskId() === null);
    try {
      await this.#host.save();
    } catch (error) {
      await this.#undo(choice);
      this.#host.snapshotChanged();
      throw error;
    }
    this.#host.snapshotChanged();
  }

  /**
   * Puts a conversation in the folder chosen for it. The folder shown changes
   * only while the conversation is still the one on screen; one deleted
   * meanwhile is left in no folder.
   */
  async #move(conversationId: string, path: string): Promise<void> {
    const { workspace } = this.#host;
    if (!workspace.enterFolder)
      throw new VisibleError("Folder selection is unavailable.");
    const exists = () =>
      this.#host.tasks().some((task) => task.id === conversationId);
    const moving = this.#host
      .tasks()
      .find((task) => task.id === conversationId);
    // Deleted while the change waited its turn.
    if (!moving) return;
    const name = await workspace.enterFolder(moving.id, path);
    if (!exists()) {
      workspace.leaveFolder?.(moving.id);
      return;
    }
    const chosen: Folder = { path, name };
    const choice = this.#choose(
      chosen,
      this.#host.selectedTaskId() === moving.id,
    );
    // The folder was chosen while looking at this conversation, so it is this
    // conversation's folder from now on.
    this.#host.changeTask(moving.id, (task) => withFolder(task, chosen));
    this.#withdrawUnopened(moving.id);
    this.#saving.add(chosen);
    try {
      await this.#host.save();
    } catch (error) {
      // The choice was not recorded, so it did not happen. Put the
      // conversation back in the folder it had, rather than leaving it
      // somewhere it is not shown in. Only its folder goes back: the rest of
      // its record, and the other conversations, may have moved on meanwhile.
      let reopened: (() => void) | undefined;
      if (exists()) {
        this.#host.changeTask(moving.id, (task) =>
          withFolder(task, moving.workspace),
        );
        const unopened = await startup.returnToWorkspace(
          workspace,
          moving.id,
          moving.workspace,
        );
        const current = this.#host
          .tasks()
          .find((task) => task.id === moving.id);
        const old = moving.workspace;
        if (unopened && current) {
          // Out of the folder it was moved to, as well: its next turn is
          // refused rather than run somewhere it is not shown in.
          workspace.leaveFolder?.(moving.id);
          this.#reportUnopened(current);
        } else if (current && old) {
          // Back in its folder, which is shown while it is on screen, though
          // it would not open when the conversation was gone to.
          reopened = () => this.#opened(current, old);
        }
      }
      // Deleted while the choice was being saved, or while its old folder
      // was opened again: it keeps no folder.
      if (!exists()) workspace.leaveFolder?.(moving.id);
      await this.#undo(choice, reopened);
      this.#host.snapshotChanged();
      throw error;
    } finally {
      this.#saving.delete(chosen);
    }
    this.#host.snapshotChanged();
  }
}
