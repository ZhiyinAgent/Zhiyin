/**
 * The backups around one action (ADR 0012): the files a change names, copied
 * before it is decided and completed once it ran, and, for a program that may
 * change any file in its folder, the folder and those outside it it is given,
 * copied before approval and again just before it runs. What a program
 * changed is recorded against that copy, or as the program left the files
 * when there was none, so going back puts each file back.
 */

import type {
  CommandFileChanges,
  FileChange,
  ToolCallInspection,
  ToolInvocationResult,
  ToolOwner,
} from "@zhiyin/contract";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
  FileBackup,
  FileBackups,
  RunBackup,
  RunStart,
} from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "../dependencies.js";
import { changedBy } from "../turn/written-files.js";
import { heldForRun } from "./held-for-run.js";
import { changesFiles } from "./declared-effects.js";
import { whoseWord } from "@zhiyin/trust-rules";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

const slashed = (path: string) => path.replaceAll("\\", "/");

/**
 * What a command said it changed, each file marked kept where the copy of
 * its folder recorded it so (ADR 0031): only recovery knows that undo can
 * put the file back.
 */
export function withKept(
  said: CommandFileChanges,
  recorded: CommandFileChanges,
): CommandFileChanges {
  if (said.status !== "checked" || recorded.status !== "checked") return said;
  const kept = new Set(
    recorded.files.flatMap((file) => (file.kept ? [slashed(file.path)] : [])),
  );
  if (!kept.size) return said;
  return {
    ...said,
    files: said.files.map((file) =>
      kept.has(slashed(file.path)) ? { ...file, kept: true } : file,
    ),
  };
}

/**
 * What a program changed, once it ended: against the copy of its folder when
 * that copy recorded it, and otherwise as the command left the files, so
 * going back can remove what it created. A call and a job that carried on
 * after it both end here.
 */
export async function keepWhatRanChanged(
  backups: Pick<FileBackups, "keepCommandChanges">,
  {
    actionId,
    folder,
    taskId,
    recorded,
    changes,
  }: {
    readonly actionId: string;
    readonly folder: string | undefined;
    readonly taskId: string;
    /** What the copy of its folder recorded, when there was one. */
    readonly recorded: CommandFileChanges | undefined;
    /** What the command said it changed. */
    readonly changes: CommandFileChanges | undefined;
  },
): Promise<void> {
  if (recorded?.status === "checked") return;
  const left = changedBy(changes);
  // Unrecorded, a file stays where the command left it, and the action still
  // finishes.
  if (!folder || !left.length) return;
  await backups
    .keepCommandChanges(actionId, folder, left, taskId)
    .catch(() => undefined);
}

/**
 * A copy of what a declared file change would overwrite. With no folder, or
 * nowhere to keep a copy, each file is answered as unprotected, saying why.
 */
export async function backUpFiles(
  backups: Pick<FileBackups, "prepare">,
  {
    actionId,
    folder,
    changes,
    taskId,
  }: {
    readonly actionId: string;
    readonly folder: string | undefined;
    readonly changes: readonly FileChange[];
    readonly taskId: string;
  },
): Promise<FileBackup> {
  const unprotected = (reason: string): FileBackup => ({
    actionId,
    files: changes.map((change) => ({
      path: change.path,
      status: "unprotected" as const,
      reason,
    })),
  });
  if (!folder) return unprotected("No workspace was available for recovery.");
  return backups
    .prepare(actionId, folder, changes, taskId)
    .catch(() =>
      unprotected("Recovery storage was unavailable before this action."),
    );
}

/** What an action's backups use: the file backups, and the copies around a run. */
type Backups = Pick<AgentLoopDependencies, "backups" | "runs">;

export class ActionBackup {
  readonly #backups: Backups["backups"];
  readonly #runs: Backups["runs"];
  readonly #actionId: string;
  readonly #taskId: string;
  /** The conversation's folder, asked again as the action ends. */
  readonly #folder: () => string | undefined;
  /** The files the change names, copied before it was decided. */
  readonly files: FileBackup | undefined;
  /** The program's folders, when it may change any file in them. */
  readonly #anyFile: Inspection["changesAnyFile"];
  readonly #run: RunBackup | undefined;
  /** The conversation's folder by its real path, as copies name it. */
  readonly #root: string | undefined;
  #started: RunStart | undefined;

  private constructor(
    { backups, runs }: Backups,
    ids: {
      actionId: string;
      taskId: string;
      folder: () => string | undefined;
      root: string | undefined;
    },
    files: FileBackup | undefined,
    anyFile: Inspection["changesAnyFile"],
    run: RunBackup | undefined,
  ) {
    this.#root = ids.root;
    this.#backups = backups;
    this.#runs = runs;
    this.#actionId = ids.actionId;
    this.#taskId = ids.taskId;
    this.#folder = ids.folder;
    this.files = files;
    this.#anyFile = anyFile;
    this.#run = run;
  }

  /**
   * Takes what an action needs copied before it is decided. Only a built-in
   * tool, or a connection Zhiyin ships, says exactly what it changes, so
   * only theirs are copied.
   */
  static async prepare(
    backups: Backups,
    {
      actionId,
      taskId,
      folder,
      owner,
      inspection,
    }: {
      readonly actionId: string;
      readonly taskId: string;
      readonly folder: () => string | undefined;
      readonly owner: ToolOwner;
      readonly inspection: Inspection;
    },
  ): Promise<ActionBackup> {
    const ours = whoseWord(owner, inspection) === "zhiyin";
    // The files a call declares it changes, in the workspace or outside it.
    const files =
      ours && changesFiles(inspection) && inspection.changes?.length
        ? await backUpFiles(backups.backups, {
            actionId,
            folder: folder(),
            changes: inspection.changes,
            taskId,
          })
        : undefined;
    // A program that may change any file in the folder, and in the folders
    // outside it it is given: each is copied before approval, and again
    // just before it runs.
    const anyFile = ours ? inspection.changesAnyFile : undefined;
    const run = anyFile
      ? await backups.runs.backUp(
          actionId,
          folder(),
          taskId,
          anyFile.outside ?? [],
        )
      : undefined;
    const where = folder();
    const root = where
      ? await realpath(where).catch(() => undefined)
      : undefined;
    return new ActionBackup(
      backups,
      { actionId, taskId, folder, root },
      files,
      anyFile,
      run,
    );
  }

  /**
   * The inspection as it is decided: a change it said could be undone cannot
   * be when a folder could not be copied, so it is decided as one that
   * cannot, wherever it is; nor when it changes files that could not be
   * copied, which it is decided as changing for good, naming them.
   */
  decided(inspection: Inspection): Inspection {
    const effects = inspection.effects;
    if (!effects) return inspection;
    const undoable =
      effects.changes === "workspace" || effects.changes === "elsewhere";
    if (this.#run && !this.#run.ok)
      return undoable
        ? {
            ...inspection,
            effects: { ...effects, changes: "workspace-for-good" },
          }
        : inspection;
    // What it changes without a copy, by file (ADR 0013): a grant for each
    // file may cover it, unless it also changes elsewhere, which only asks
    // each time.
    const uncopied = this.#uncopied();
    if (uncopied === "unnamed")
      return {
        ...inspection,
        effects: { ...effects, changes: "workspace-for-good" },
      };
    if (!uncopied.length) return inspection;
    return {
      ...inspection,
      effects: {
        ...effects,
        changes: "workspace-for-good",
        ...(effects.changes === "elsewhere" ? {} : { uncopied }),
      },
    };
  }

  /**
   * The files the action changes that could not be copied, by their whole
   * real paths: those the call names as changed without a copy, those its
   * program always saves, and those a change declares, each one the limits
   * could not admit. `unnamed` when a file named as changed without a copy
   * is none the copy of the workspace left out, so no grant can name it.
   */
  #uncopied(): readonly string[] | "unnamed" {
    const root = this.#root;
    const left = this.#left();
    const named = this.#anyFile?.writable ?? [];
    if (named.some((path) => !left.has(slashed(path)) || !root))
      return "unnamed";
    const saved = (this.#anyFile?.saves ?? []).filter((path) =>
      left.has(slashed(path)),
    );
    const declared = (this.files?.files ?? []).filter(
      (file) => file.status === "unprotected" && file.tooLarge,
    );
    if (declared.length && !root) return "unnamed";
    return [
      ...new Set([
        ...[...named, ...saved].map((path) => resolve(root!, path)),
        ...declared.map(({ path }) =>
          isAbsolute(path) ? path : resolve(root!, path),
        ),
      ]),
    ];
  }

  /** What a sealed-off program may change though it could not be copied. */
  #writable(): readonly string[] {
    const left = this.#left();
    return [
      ...(this.#anyFile?.writable ?? []),
      ...(this.#anyFile?.saves ?? []).filter((path) => left.has(slashed(path))),
    ];
  }

  /** The files the copy of the workspace left out, by their path there. */
  #left(): ReadonlySet<string> {
    return new Set(
      this.#run?.ok ? this.#run.uncopied.map(({ path }) => slashed(path)) : [],
    );
  }

  /** Lets go of every copy: the action does not run. */
  async discard(): Promise<void> {
    if (this.files) await this.#backups.discard(this.#actionId);
    await this.#discardRun();
  }

  /**
   * Why the action may no longer run, or nothing: a protected file's copy
   * that no longer holds is a promise broken.
   */
  async broken(): Promise<string | undefined> {
    if (!this.files?.files.some((file) => file.status === "protected")) return;
    const valid = await this.#backups.validate(this.#actionId);
    return valid.ok ? undefined : valid.reason;
  }

  /**
   * Copies the program's folders again just before it runs, and keeps a
   * sealed-off program from what could not be copied. Answers why a
   * sealed-off program may not run when that failed. A shell command was
   * asked about and runs as it was approved, its changes recorded as far as
   * they can be.
   */
  async start(sealed: boolean): Promise<string | undefined> {
    if (!this.#anyFile) return;
    const started = await this.#runs.start(this.#actionId, {
      sealed,
      writable: this.#writable(),
    });
    this.#started = started;
    if (started.ok) return;
    if (sealed) return started.reason;
    await this.#discardRun();
    return;
  }

  /**
   * After the action ran: the files' copy completed, and what the program
   * changed recorded against the copy taken before it ran. A command that
   * carries on as a job is recorded when it ends. Answers the result with
   * what the run changed and what was held from it.
   */
  async finish(result: ToolInvocationResult): Promise<ToolInvocationResult> {
    if (this.files) await this.#backups.commit(this.#actionId);
    const started = this.#started;
    let recorded: CommandFileChanges | undefined;
    if (started?.ok && result.commandChanges?.status !== "running")
      recorded = await this.#runs.finish(this.#actionId);
    let answered = result;
    if (recorded && !answered.commandChanges)
      answered = { ...answered, commandChanges: recorded };
    else if (recorded)
      answered = {
        ...answered,
        commandChanges: withKept(answered.commandChanges!, recorded),
      };
    const held =
      started?.ok &&
      heldForRun(started.held, answered, this.#anyFile?.unheldBy);
    if (held) answered = { ...answered, heldForRun: held };
    await keepWhatRanChanged(this.#backups, {
      actionId: this.#actionId,
      folder: this.#folder(),
      taskId: this.#taskId,
      recorded,
      changes: answered.commandChanges,
    });
    return answered;
  }

  async #discardRun(): Promise<void> {
    if (this.#anyFile) await this.#runs.discard(this.#actionId);
  }
}
