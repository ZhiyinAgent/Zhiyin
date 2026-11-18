/**
 * Memory as the app keeps it (ADR 0026): what the Memory page shows and
 * changes, each conversation's choice of project, and the card a change
 * leaves in its conversation. What memory holds and how it is written belong
 * to the memory feature; this part only asks it and tells the window.
 */

import { win32 } from "node:path";
import {
  VisibleError,
  type AppEvent,
  type ConversationMemoryChoice,
  type MemoryChange,
  type MemoryOutcome,
  type MemoryRequest,
  type MemoryState,
  type TaskAction,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { isBroadFolder } from "@zhiyin/memory-projects";
import type { Memory } from "@zhiyin/memory";

const notKept: MemoryOutcome = {
  ok: false,
  reason: "Memory is not kept here.",
};

/** Memory, as the workspace reaches it. */
export type MemoryPort = Memory;

/** Asks the person for a folder; nothing when they chose none. */
export type ChooseFolder = () => Promise<string | undefined>;

export class WorkspaceMemory {
  readonly #memory: Memory | undefined;
  readonly #emit: (event: AppEvent) => void;
  readonly #tasks: () => readonly WorkspaceTask[];
  readonly #ready: (taskId: string) => Promise<boolean>;
  readonly #save: (task: WorkspaceTask) => Promise<void>;
  readonly #folderOf: (taskId: string) => string | undefined;

  constructor(options: {
    readonly memory: Memory | undefined;
    readonly emit: (event: AppEvent) => void;
    /** The conversations opened so far. */
    readonly tasks: () => readonly WorkspaceTask[];
    /**
     * Opens a conversation the person is about to change, settled first and
     * refused while its files are restored; false when it cannot be opened.
     */
    readonly ready: (taskId: string) => Promise<boolean>;
    readonly save: (task: WorkspaceTask) => Promise<void>;
    /** The folder a conversation works in. */
    readonly folderOf: (taskId: string) => string | undefined;
  }) {
    this.#memory = options.memory;
    this.#emit = options.emit;
    this.#tasks = options.tasks;
    this.#ready = options.ready;
    this.#save = options.save;
    this.#folderOf = options.folderOf;
    // The model's writes as much as the person's.
    this.#memory?.onChange(() => void this.#tell());
  }

  /** Everything the Memory page shows; nothing where memory is not kept. */
  state(): Promise<MemoryState | undefined> {
    return this.#memory ? this.#memory.state() : Promise.resolve(undefined);
  }

  /** The folder memory keeps its files in; nothing where it is not kept. */
  folder(): Promise<string | undefined> {
    return this.#memory ? this.#memory.folder() : Promise.resolve(undefined);
  }

  async change(
    request: MemoryRequest,
    chooseFolder?: ChooseFolder,
  ): Promise<MemoryOutcome> {
    const memory = this.#memory;
    if (!memory) return notKept;
    // A waiting change says the conversation it came from, whose card is
    // marked even when that conversation has not been opened yet.
    const from =
      request.kind === "keep" || request.kind === "discard"
        ? (await memory.state()).waiting.find(
            (waiting) => waiting.id === request.waitingId,
          )?.conversation.id
        : undefined;
    const outcome = await this.#apply(memory, request, chooseFolder);
    if (!outcome.ok) return outcome;
    if (from) await this.#ready(from).catch(() => false);
    if (request.kind === "undo")
      await this.#mark(
        (change) => change.writeId === request.writeId,
        "undone",
      );
    if (request.kind === "keep" || request.kind === "discard")
      await this.#mark(
        (change) => change.waiting?.id === request.waitingId,
        request.kind === "keep" ? "kept" : "discarded",
      );
    return outcome;
  }

  /**
   * Takes back what these actions kept, newest first, as when the turns that
   * made them are gone back past or undone. An entry the person changed since
   * stays as they left it, and a change they already decided on is theirs.
   */
  async takeBack(actions: readonly TaskAction[]): Promise<void> {
    const writes = actions
      .filter((action) => action.memory && !action.memory.state)
      .sort((left, right) => right.sequence - left.sequence);
    for (const { memory } of writes)
      // The conversation is already as the person asked; a write memory
      // cannot reach now stays kept, shown on the Memory page.
      await this.change({ kind: "undo", writeId: memory!.writeId }).catch(
        () => undefined,
      );
  }

  /**
   * Lets go of what undid a deleted conversation's memory writes: the cards
   * that offered it are gone. What it wrote stays.
   */
  async conversationDeleted(taskId: string): Promise<void> {
    await this.#memory?.conversationDeleted(taskId);
  }

  /** The conversation's project, and whether it keeps anything. */
  async setConversation(
    taskId: string,
    choice: ConversationMemoryChoice,
  ): Promise<void> {
    if (!(await this.#ready(taskId))) return;
    const project = choice.project;
    if (
      typeof project === "string" &&
      !(await this.#memory?.projects())?.some(
        (one) => one.id === project && !one.archived,
      )
    )
      throw new VisibleError("That project is no longer kept.");
    const folder = this.#folderOf(taskId);
    if (choice.linkFolder && typeof project === "string" && folder) {
      const linked = await this.#memory!.linkFolder(project, folder);
      if (!linked.ok) throw new VisibleError(linked.reason);
    }
    const task = this.#task(taskId);
    if (!task) return;
    const changed: WorkspaceTask = {
      ...task,
      ...(project !== undefined ? { project } : {}),
    };
    if (choice.off === true) await this.#save({ ...changed, memoryOff: true });
    else if (choice.off === false) {
      const kept = { ...changed };
      delete (kept as { memoryOff?: unknown }).memoryOff;
      await this.#save(kept);
    } else await this.#save(changed);
  }

  #apply(
    memory: Memory,
    request: MemoryRequest,
    chooseFolder: ChooseFolder | undefined,
  ): Promise<MemoryOutcome> {
    switch (request.kind) {
      case "switch":
        return memory.switch(request.on).then(() => ({ ok: true }));
      case "add":
        return memory.add(request.draft);
      case "edit":
        return memory.edit(request.number, request.edit);
      case "remove":
        return memory.remove(request.number);
      case "move":
        return memory.move(request.number, request.scope);
      case "keep":
        return memory.keep(request.waitingId);
      case "discard":
        return memory.discard(request.waitingId);
      case "undo":
        return memory.undo(request.writeId);
      case "createProject":
        return memory.createProject(request.name);
      case "projectFromConversation":
        return this.#fromConversation(memory, request.taskId);
      case "forgetConversation":
        return memory.forgetConversation(request.taskId, {
          own: request.own === true,
          general: request.general === true,
        });
      case "renameProject":
        return memory.renameProject(request.id, request.name);
      case "linkFolder":
        return this.#link(memory, request.id, chooseFolder);
      case "unlinkFolder":
        return memory.unlinkFolder(request.id, request.folder);
      case "archiveProject":
        return memory.archiveProject(request.id, request.archived);
      case "mergeProject":
        return memory.mergeProject(request.from, request.into);
      case "deleteProject":
        return memory.deleteProject(request.id);
    }
  }

  /**
   * A project named after the conversation's folder, linked to it unless
   * work of every kind passes there, holding the conversation.
   */
  async #fromConversation(
    memory: Memory,
    taskId: string,
  ): Promise<MemoryOutcome> {
    if (!(await this.#ready(taskId)))
      return { ok: false, reason: "That conversation is no longer kept." };
    const folder = this.#folderOf(taskId);
    if (!folder)
      return {
        ok: false,
        reason: "This conversation has no folder to name a project after.",
      };
    const { broadFolders } = await memory.state();
    const made = await memory.createProject(
      win32.basename(folder),
      isBroadFolder(folder, broadFolders) ? [] : [folder],
    );
    if (!made.ok || !made.project) return made;
    await this.setConversation(taskId, { project: made.project.id });
    return made;
  }

  async #link(
    memory: Memory,
    id: string,
    chooseFolder: ChooseFolder | undefined,
  ): Promise<MemoryOutcome> {
    const folder = await chooseFolder?.();
    // Choosing none is no change, and nothing went wrong.
    return folder ? memory.linkFolder(id, folder) : { ok: true };
  }

  /** Says on each card showing a matching change what became of it. */
  async #mark(
    matches: (change: MemoryChange) => boolean,
    state: NonNullable<MemoryChange["state"]>,
  ): Promise<void> {
    for (const { id } of this.#tasks()) {
      const task = this.#task(id);
      if (
        !task?.actions.some((action) => action.memory && matches(action.memory))
      )
        continue;
      await this.#save({
        ...task,
        actions: task.actions.map((action) =>
          action.memory && matches(action.memory)
            ? { ...action, memory: { ...action.memory, state } }
            : action,
        ),
      });
    }
  }

  /** The conversation as it is now, read again after any wait. */
  #task(taskId: string): WorkspaceTask | undefined {
    return this.#tasks().find((task) => task.id === taskId);
  }

  async #tell(): Promise<void> {
    const state = await this.#memory?.state().catch(() => undefined);
    if (state) this.#emit({ kind: "memoryChanged", data: state });
  }
}
