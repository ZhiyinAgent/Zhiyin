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
  type RewindMemoryEffect,
  type RewindMemoryOutcome,
  type TaskAction,
  type TaskUndo,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { isBroadFolder } from "@zhiyin/memory-projects";
import type { Memory } from "@zhiyin/memory";

const notKept: MemoryOutcome = {
  ok: false,
  reason: "Memory is not kept here.",
};

const unreachable: MemoryOutcome = {
  ok: false,
  reason: "Memory could not be reached just now.",
};

/** What memory answered, or that it could not be reached, however it failed. */
async function reached(
  ask: () => Promise<MemoryOutcome>,
): Promise<MemoryOutcome> {
  try {
    return await ask();
  } catch {
    return unreachable;
  }
}

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
  readonly #now: () => Date;
  /**
   * The entry each removal on the Memory page took, by the removal's write,
   * for as long as the app runs: the page offers its Undo only meanwhile.
   */
  readonly #removals = new Map<string, number>();

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
    readonly now: () => Date;
  }) {
    this.#memory = options.memory;
    this.#emit = options.emit;
    this.#tasks = options.tasks;
    this.#ready = options.ready;
    this.#save = options.save;
    this.#folderOf = options.folderOf;
    this.#now = options.now;
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
    // An entry removed is marked on the cards of the conversation that wrote
    // it, opened or not.
    const writer =
      request.kind === "remove"
        ? (await memory.state()).entries.find(
            (entry) => entry.number === request.number,
          )?.conversation?.id
        : undefined;
    const outcome = await this.#apply(memory, request, chooseFolder);
    if (!outcome.ok) return outcome;
    if (from) await this.#ready(from).catch(() => false);
    if (writer) await this.#ready(writer).catch(() => false);
    const putBack =
      request.kind === "undo" ? this.#removals.get(request.writeId) : undefined;
    if (putBack !== undefined && request.kind === "undo") {
      this.#removals.delete(request.writeId);
      await this.#putBack(putBack);
    } else if (request.kind === "undo")
      await this.#mark(
        (change) => change.writeId === request.writeId,
        "undone",
        "card",
      );
    if (request.kind === "remove") {
      if (outcome.writeId) this.#removals.set(outcome.writeId, request.number);
      await this.#mark(
        (change) =>
          change.number === request.number &&
          change.change !== "removed" &&
          (!change.state || change.state === "kept"),
        "removed",
        "memoryPage",
      );
    }
    if (request.kind === "keep" || request.kind === "discard")
      await this.#mark(
        (change) => change.waiting?.id === request.waitingId,
        request.kind === "keep" ? "kept" : "discarded",
      );
    return outcome;
  }

  /**
   * What undoing memory changes would do to each write these actions kept,
   * newest first, as when the turns that made them are gone back past or
   * undone: one the person already kept or discarded is theirs, one memory
   * would refuse now says why, as an entry changed since. A write already
   * undone, or whose entry the person removed, is left out.
   */
  async effects(
    actions: readonly TaskAction[],
  ): Promise<readonly RewindMemoryEffect[]> {
    const writes = actions
      .filter(
        (action) =>
          action.memory &&
          action.memory.state !== "undone" &&
          action.memory.state !== "removed",
      )
      .sort((left, right) => right.sequence - left.sequence)
      .map((action) => action.memory!);
    const effects: RewindMemoryEffect[] = [];
    for (const write of writes) {
      const named = {
        writeId: write.writeId,
        ...(write.number !== undefined ? { number: write.number } : {}),
        title: write.title,
        ...(write.rule ? { rule: write.rule } : {}),
      };
      if (write.state) {
        effects.push({ ...named, status: "decided" });
        continue;
      }
      const memory = this.#memory;
      const outcome = memory
        ? await reached(() => memory.undoable(write.writeId))
        : notKept;
      effects.push(
        outcome.ok
          ? { ...named, status: "undoable" }
          : { ...named, status: "changed", reason: outcome.reason },
      );
    }
    return effects;
  }

  /**
   * Takes back the writes reviewed, newest first, or leaves them, as the
   * person chose, and says what became of each. A write the person already
   * decided on stays theirs; one memory refuses stays kept, with why. When
   * the conversation no longer shows the writes (`cardsStay` false, as after
   * going back), each one left is the person's to undo from then on.
   */
  async takeBack(
    effects: readonly RewindMemoryEffect[],
    choice: "keep" | "undo",
    cardsStay: boolean,
  ): Promise<readonly RewindMemoryOutcome[]> {
    const memory = this.#memory;
    const outcomes: RewindMemoryOutcome[] = [];
    const left: string[] = [];
    for (const effect of effects) {
      const named = {
        writeId: effect.writeId,
        ...(effect.number !== undefined ? { number: effect.number } : {}),
        title: effect.title,
        ...(effect.rule ? { rule: effect.rule } : {}),
      };
      if (effect.status === "decided" || choice === "keep") {
        outcomes.push({ ...named, status: "kept" });
        left.push(effect.writeId);
        continue;
      }
      const outcome = memory
        ? await reached(() =>
            memory.undo(
              effect.writeId,
              cardsStay ? "undoing the turn" : "going back",
            ),
          )
        : notKept;
      if (outcome.ok) outcomes.push({ ...named, status: "undone" });
      else {
        outcomes.push({ ...named, status: "refused", reason: outcome.reason });
        left.push(effect.writeId);
      }
    }
    // A record memory cannot reach now stays the conversation's, as before.
    if (!cardsStay && left.length && memory)
      await reached(async () => {
        await memory.cardsGone(left);
        return { ok: true };
      });
    return outcomes;
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

  /**
   * Says on each card showing a matching change what became of it. With
   * `taken`, the entry is gone from memory, and the conversation's model is
   * told at its next request, as of an undo of that turn's memory alone.
   */
  async #mark(
    matches: (change: MemoryChange) => boolean,
    state: NonNullable<MemoryChange["state"]>,
    taken?: TaskUndo["memoryFrom"],
  ): Promise<void> {
    for (const { id } of this.#tasks()) {
      const task = this.#task(id);
      const marked = task?.actions.filter(
        (action) => action.memory && matches(action.memory),
      );
      if (!task || !marked?.length) continue;
      const at = this.#now().toISOString();
      const undos: TaskUndo[] = taken
        ? marked.flatMap((action) => {
            const opening = openingOf(task, action);
            const write = action.memory!;
            return opening
              ? [
                  {
                    id: `${taken}-${write.writeId}`,
                    messageId: opening,
                    actionIds: [],
                    at,
                    files: [],
                    memory: [
                      {
                        writeId: write.writeId,
                        ...(write.number !== undefined
                          ? { number: write.number }
                          : {}),
                        title: write.title,
                        // Removed on the Memory page, the whole entry is gone.
                        ...(write.rule && taken === "card"
                          ? { rule: write.rule }
                          : {}),
                        status: "undone" as const,
                      },
                    ],
                    memoryFrom: taken,
                  },
                ]
              : [];
          })
        : [];
      await this.#save({
        ...task,
        actions: task.actions.map((action) =>
          action.memory && matches(action.memory)
            ? { ...action, memory: { ...action.memory, state } }
            : action,
        ),
        undos: [...task.undos, ...undos],
      });
    }
  }

  /**
   * An entry the person put back on the Memory page after removing it: each
   * card it marked removed shows the change as before, and its model, told
   * of the removal or not yet, hears it is kept again or nothing at all.
   */
  async #putBack(number: number): Promise<void> {
    const isRemoval = (undo: TaskUndo) =>
      undo.memoryFrom === "memoryPage" &&
      undo.memory?.some((write) => write.number === number) === true;
    for (const { id } of this.#tasks()) {
      const task = this.#task(id);
      const marked = task?.actions.filter(
        (action) =>
          action.memory?.number === number && action.memory.state === "removed",
      );
      if (!task || !marked?.length) continue;
      const told = task.undos.filter((undo) => isRemoval(undo) && undo.told);
      const at = this.#now().toISOString();
      await this.#save({
        ...task,
        actions: task.actions.map((action) =>
          marked.includes(action)
            ? {
                ...action,
                memory: {
                  ...action.memory!,
                  // A waiting change the person kept was kept before it was removed.
                  state:
                    action.memory!.change === "waiting" ? "kept" : undefined,
                },
              }
            : action,
        ),
        undos: [
          ...task.undos.filter((undo) => !isRemoval(undo) || undo.told),
          ...told.map((undo): TaskUndo => ({
            id: `${undo.id}-back`,
            messageId: undo.messageId,
            actionIds: [],
            at,
            files: [],
            memory: (undo.memory ?? []).map((write) => ({
              ...write,
              status: "kept" as const,
            })),
            memoryFrom: "memoryPageBack",
          })),
        ],
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

/** The person's message that opened the turn an action ran in. */
function openingOf(
  task: WorkspaceTask,
  action: TaskAction,
): string | undefined {
  return task.messages
    .filter(
      (message) =>
        message.role === "user" && message.sequence < action.sequence,
    )
    .at(-1)?.id;
}
