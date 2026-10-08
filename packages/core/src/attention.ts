/**
 * When Zhiyin asks for the person outside its window: a turn waiting for an
 * approval or an answer, or one that ended after running long enough to have
 * been left alone with. Only while no Zhiyin window has their attention.
 *
 * Decided here, from the conversations as they change; the application only
 * supplies a way to show a notice and to say whether a window is focused. A
 * notice may appear on a locked screen, so it names the conversation and what
 * it needs, never a file's contents, a command, or what the model wrote.
 */

import type { AppEvent, TaskPhase, WorkspaceTask } from "@zhiyin/contract";

export type Notice = {
  readonly taskId: string;
  readonly title: string;
  readonly body: string;
};

/** Supplied by the application: the operating system's notifications. */
export type Notifier = {
  /** Whether a Zhiyin window has the person's attention now. */
  focused(): boolean;
  /** Shows the notice; `open` is called if the person clicks it. */
  notify(notice: Notice, open: () => void): void;
};

/** A turn that ends sooner than this was not left long enough to be missed. */
const leftAlone = 20_000;
/** Notices for one conversation closer together than this are one notice. */
const quiet = 10_000;

const going: readonly TaskPhase["kind"][] = [
  "loading",
  "working",
  "browser",
  "approval",
  "input",
];

type Followed = {
  readonly phase: TaskPhase["kind"];
  /** When the turn under way started, if one is. */
  readonly since?: number;
  /** When this conversation last asked for the person. */
  readonly told?: number;
};

export type AttentionDependencies = {
  readonly notifier: Notifier;
  readonly now: () => Date;
  /** The person's choice in Settings. */
  readonly enabled: () => boolean;
  /** Opens a conversation in the window. */
  readonly open: (taskId: string) => void;
};

export class Attention {
  readonly #deps: AttentionDependencies;
  readonly #followed = new Map<string, Followed>();

  constructor(deps: AttentionDependencies) {
    this.#deps = deps;
  }

  observe(event: AppEvent): void {
    if (event.kind === "taskRemoved") this.#followed.delete(event.data.taskId);
    if (event.kind !== "taskChanged") return;
    const task = event.data;
    const kind = task.phase.kind;
    const before = this.#followed.get(task.id);
    if (before?.phase === kind) return;
    const now = this.#deps.now().getTime();
    const wasGoing = before !== undefined && going.includes(before.phase);
    const since = going.includes(kind)
      ? wasGoing
        ? before.since
        : now
      : undefined;
    const body = before && wasGoing ? this.#need(task, before, now) : undefined;
    const told = before && body ? this.#tell(task, body, before, now) : false;
    this.#followed.set(task.id, {
      phase: kind,
      ...(since === undefined ? {} : { since }),
      ...(told ? { told: now } : before?.told ? { told: before.told } : {}),
    });
  }

  /** What the turn needs said, if anything, now that its phase changed. */
  #need(
    task: WorkspaceTask,
    before: Followed,
    now: number,
  ): string | undefined {
    const { phase } = task;
    if (phase.kind === "approval") {
      const files = phase.prompt.changes?.length ?? 0;
      return files === 0
        ? "Needs your approval"
        : `Needs your approval to change ${files === 1 ? "1 file" : `${files} files`}`;
    }
    if (phase.kind === "input") return "Has a question for you";
    if (phase.kind === "failed") return "Stopped with an error";
    if (phase.kind === "interrupted") return "Stopped before finishing";
    if (phase.kind === "completed")
      return before.since !== undefined && now - before.since >= leftAlone
        ? "Finished"
        : undefined;
    return undefined;
  }

  #tell(
    task: WorkspaceTask,
    body: string,
    before: Followed,
    now: number,
  ): boolean {
    if (!this.#deps.enabled() || this.#deps.notifier.focused()) return false;
    if (before.told !== undefined && now - before.told < quiet) return false;
    this.#deps.notifier.notify(
      { taskId: task.id, title: task.title, body },
      () => this.#deps.open(task.id),
    );
    return true;
  }
}
