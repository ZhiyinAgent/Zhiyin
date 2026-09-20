/**
 * Persists conversations so they can be resumed, and tracks each turn's file
 * changes so they can be undone.
 *
 * Boundaries and invariants: docs/architecture/features/session/README.md
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  REASONING_EFFORTS,
  type ProducedImage,
  type StoredPicture,
  type WorkspaceSnapshot,
} from "@zhiyin/contract";
const mib = 1024 * 1024;

/**
 * Signal 0 delivers nothing and only reports whether the process is there.
 * `EPERM` means it exists and belongs to someone else, which still counts.
 */
function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * How much disk the pictures a conversation refers to may occupy.
 *
 * Screenshots arrive faster than anything else the app keeps — a browser task
 * takes a dozen without being asked — and unlike a recovery copy nobody ever
 * deletes one deliberately. Bounded the same way recovery is (ADR 0019): a
 * ceiling for one picture, a ceiling for all of them, and an age past which a
 * picture is not worth its bytes.
 */
export type PictureLimits = {
  /** The whole store. Oldest pictures go first when this is exceeded. */
  readonly totalBytes: number;
  /** The largest one picture may be. A larger one is not stored at all. */
  readonly pictureBytes: number;
  /** How long a picture is kept, however much room there is. */
  readonly maximumAgeMs: number;
};

export const defaultPictureLimits: PictureLimits = {
  totalBytes: 128 * mib,
  pictureBytes: 12 * mib,
  maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
};

export type WorkspaceFileOperations = {
  readonly write: (path: string, source: string) => Promise<void>;
  readonly replace: (temporaryPath: string, path: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
};

/**
 * What is left where a picture was, so a conversation can say what happened
 * instead of showing a gap. A few dozen bytes: the record of an eviction must
 * not itself be what fills the disk.
 */
type PictureRemoval = { readonly reason: string; readonly at: string };

const evictedReason = "This screenshot was deleted to save disk space.";
const oversizeReason = "This screenshot was too large to keep.";
const unknownReason = "This picture is no longer stored with the conversation.";

export interface SessionSummary {
  readonly id: string;
  /** Always producible, even for a session trimmed for the model's context. */
  readonly label: string;
}

/**
 * What a history file holds: the conversations and the choices a person made.
 * Connection, plugin, usage, and browser state are only true while the app
 * runs and are read again at every launch, so they are never stored.
 */
export type SavedWorkspace = Pick<
  WorkspaceSnapshot,
  "preferences" | "workspace" | "recentWorkspaces" | "tasks" | "selectedTaskId"
>;

export interface Sessions {
  loadWorkspace(): Promise<SavedWorkspace | undefined>;
  /** Stores the durable part of a workspace; anything else given is not written. */
  saveWorkspace(
    workspace: SavedWorkspace,
    options?: { readonly commit?: () => boolean },
  ): Promise<void>;
  /**
   * Keeps a picture a conversation refers to, and answers with the name it is
   * referred to by. Stored beside the conversation rather than inside it: the
   * history file is rewritten whenever anything changes, and an encoded image
   * would be rewritten with it every time.
   */
  savePicture(image: ProducedImage): Promise<string>;
  /**
   * The picture, or why it is not there — never a guess at what it was. A
   * picture the store deleted to stay inside its limits says so, because
   * "missing" and "removed on purpose" are different things to be told.
   */
  readPicture(source: string): Promise<StoredPicture>;
  /** Drops pictures nothing refers to any more. */
  forgetPictures(sources: readonly string[]): Promise<void>;
  list(): Promise<readonly SessionSummary[]>;
  /** Idempotent: undoing twice does nothing the second time. */
  undo(turnId: string): Promise<void>;
  /** What is left of a history file that will not open. Changes nothing. */
  inspectDamage(): Promise<DamageReport>;
  /** Copies the damaged file somewhere safe and answers where. Changes nothing else. */
  preserveDamaged(): Promise<string>;
  /** Keeps the damaged file, then rewrites the history with what could be read. */
  recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }>;
}

/** What is left of a history file that will not open. */
export type DamageReport =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "partial";
      readonly readable: number;
      readonly damaged: number;
    };

export class SessionStoreError extends Error {
  readonly code: "corrupted" | "unavailable" | "in-use";

  constructor(
    code: SessionStoreError["code"],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SessionStoreError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFolder(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string"
  );
}

function validReasoningSelection(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return value.enabled === false
    ? value.effort === undefined
    : value.enabled === true &&
        (value.effort === undefined ||
          REASONING_EFFORTS.some((effort) => effort === value.effort));
}

function validReasoningTrace(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.text === "string" &&
      ["streaming", "complete", "interrupted"].includes(String(value.status)))
  );
}

function validModelResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    optionalText(value.requestId) &&
    optionalText(value.model) &&
    optionalText(value.provider) &&
    (value.finishReason === null || typeof value.finishReason === "string") &&
    ["sentinel", "finishReason", "usage"].includes(String(value.termination)) &&
    typeof value.complete === "boolean"
  );
}

function validIsoDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function stringArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function validSpecialist(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.provenance)) return false;
  const provenance = value.provenance;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.instructions === "string" &&
    provenance.source === "plugin" &&
    typeof provenance.pluginId === "string"
  );
}

function validSpecialistHandoff(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    typeof value.summary === "string" &&
    stringArray(value.findings) &&
    stringArray(value.recommendations) &&
    stringArray(value.limitations),
  );
}

function validSpecialistRun(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const status = String(value.status);
  if (
    typeof value.id !== "string" ||
    !optionalText(value.parentRunId) ||
    !validSpecialist(value.specialist) ||
    typeof value.task !== "string" ||
    !Number.isInteger(value.depth) ||
    Number(value.depth) < 1 ||
    !["running", "completed", "failed", "interrupted"].includes(status) ||
    !validIsoDate(value.startedAt) ||
    !stringArray(value.actionIds) ||
    !optionalText(value.reason)
  )
    return false;
  if (status === "running")
    return value.finishedAt === undefined && value.handoff === undefined;
  if (!validIsoDate(value.finishedAt)) return false;
  return status === "completed"
    ? validSpecialistHandoff(value.handoff)
    : value.handoff === undefined && typeof value.reason === "string";
}

/** Only the fields a history file holds, whatever else the value carries. */
function durable(workspace: SavedWorkspace): SavedWorkspace {
  return {
    ...(workspace.preferences ? { preferences: workspace.preferences } : {}),
    ...(workspace.workspace ? { workspace: workspace.workspace } : {}),
    ...(workspace.recentWorkspaces
      ? { recentWorkspaces: workspace.recentWorkspaces }
      : {}),
    tasks: workspace.tasks,
    selectedTaskId: workspace.selectedTaskId,
  };
}

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!isRecord(value)) return false;
  if (value.version !== undefined && value.version !== 1) return false;
  if (
    value.preferences !== undefined &&
    (!isRecord(value.preferences) ||
      typeof value.preferences.onboarded !== "boolean" ||
      !Array.isArray(value.preferences.interests) ||
      !value.preferences.interests.every((item) => typeof item === "string") ||
      (value.preferences.capabilitiesApplied !== undefined &&
        typeof value.preferences.capabilitiesApplied !== "boolean"))
  )
    return false;
  if (value.workspace !== undefined && !isFolder(value.workspace)) return false;
  if (
    value.recentWorkspaces !== undefined &&
    (!Array.isArray(value.recentWorkspaces) ||
      !value.recentWorkspaces.every(isFolder))
  )
    return false;
  if (!Array.isArray(value.tasks)) return false;
  if (value.selectedTaskId !== null && typeof value.selectedTaskId !== "string")
    return false;
  if (
    new Set(value.tasks.map((task) => (isRecord(task) ? task.id : undefined)))
      .size !== value.tasks.length
  )
    return false;
  return value.tasks.every(isWorkspaceTask);
}

/**
 * One conversation, checked on its own. Separate from the whole-file check so a
 * single damaged conversation can be identified and left behind instead of
 * taking every other conversation in the file with it.
 */
function isWorkspaceTask(task: unknown): boolean {
  return Boolean(
    isRecord(task) &&
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    validReasoningSelection(task.reasoning) &&
    (task.titleSource === undefined ||
      task.titleSource === "generated" ||
      task.titleSource === "manual") &&
    (task.workspace === undefined || isFolder(task.workspace)) &&
    optionalText(task.updatedLabel) &&
    validContext(task.context) &&
    (task.updatedAt === undefined || typeof task.updatedAt === "string") &&
    Array.isArray(task.messages) &&
    task.messages.every(
      (message) =>
        isRecord(message) &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string" &&
        validReasoningTrace(message.reasoning) &&
        optionalText(message.interactionId) &&
        validSequence(message.sequence),
    ) &&
    (task.modelResponses === undefined ||
      (Array.isArray(task.modelResponses) &&
        task.modelResponses.every(validModelResponse))) &&
    validCompaction(task.compaction, task.messages, task.actions) &&
    validPhase(task.phase) &&
    (task.actions === undefined ||
      (Array.isArray(task.actions) &&
        task.actions.every(
          (action) =>
            isRecord(action) &&
            typeof action.id === "string" &&
            typeof action.action === "string" &&
            typeof action.target === "string" &&
            [
              action.command,
              action.toolName,
              action.evidence,
              action.policy,
              action.description,
              action.detail,
              action.claim,
              action.reason,
            ].every(optionalText) &&
            validChanges(action.changes) &&
            validDetails(action.details) &&
            [
              "running",
              "completed",
              // An action that ran and answered without succeeding. Absent
              // here, a saved task holding one loaded as corrupted state and
              // took the whole workspace with it.
              "reported",
              "failed",
              "denied",
              "blocked",
              "cancelled",
            ].includes(String(action.status)) &&
            validSequence(action.sequence),
        ))) &&
    (task.artifacts === undefined ||
      (Array.isArray(task.artifacts) &&
        task.artifacts.every(
          (item) =>
            isRecord(item) &&
            typeof item.path === "string" &&
            typeof item.name === "string" &&
            (item.change === "created" || item.change === "updated") &&
            typeof item.bytes === "number" &&
            typeof item.updatedAt === "string",
        ))) &&
    (task.specialistRuns === undefined ||
      (Array.isArray(task.specialistRuns) &&
        task.specialistRuns.every(validSpecialistRun) &&
        new Set(
          task.specialistRuns.map((run) =>
            isRecord(run) ? run.id : undefined,
          ),
        ).size === task.specialistRuns.length)) &&
    (task.views === undefined ||
      (Array.isArray(task.views) &&
        task.views.every(
          (view) =>
            isRecord(view) &&
            typeof view.id === "string" &&
            typeof view.callId === "string" &&
            typeof view.title === "string" &&
            [
              "diagram",
              "bar-chart",
              "line-chart",
              "scatter-plot",
              "histogram",
              "box-plot",
            ].includes(String(view.kind)) &&
            typeof view.source === "string" &&
            validSequence(view.sequence),
        ))) &&
    (task.interactions === undefined ||
      (Array.isArray(task.interactions) &&
        task.interactions.every(validInteraction))) &&
    (task.plan === undefined ||
      (Array.isArray(task.plan) &&
        task.plan.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.criterion === "string" &&
            optionalText(item.verification) &&
            [
              "pending",
              "active",
              "checking",
              "verified",
              "needs-attention",
            ].includes(String(item.status)),
        ))),
  );
}

function validCompaction(
  value: unknown,
  messages: unknown,
  actions: unknown,
): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !Array.isArray(messages)) return false;
  if (
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.throughMessageId !== "string" ||
    typeof value.summary !== "string" ||
    !value.summary.trim() ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.retainedActionIds) ||
    !value.retainedActionIds.every((id) => typeof id === "string") ||
    new Set(value.retainedActionIds).size !== value.retainedActionIds.length
  )
    return false;
  const messageIds = new Set(
    messages.filter(isRecord).map((message) => message.id),
  );
  if (!messageIds.has(value.throughMessageId)) return false;
  const actionIds = new Set(
    Array.isArray(actions)
      ? actions
          .filter(
            (action) => isRecord(action) && typeof action.evidence === "string",
          )
          .map((action) => action.id)
      : [],
  );
  return value.retainedActionIds.every((id) => actionIds.has(id));
}

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validContext(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "browser")
    return typeof value.title === "string" && typeof value.url === "string";
  return (
    value.kind === "workspace" &&
    typeof value.project === "string" &&
    typeof value.changes === "string" &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        isRecord(file) &&
        typeof file.name === "string" &&
        typeof file.meta === "string",
    )
  );
}

function validSequence(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function uniqueIds(values: readonly unknown[]): boolean {
  const ids = values.map((value) => (isRecord(value) ? value.id : undefined));
  return (
    ids.every((id) => typeof id === "string") &&
    new Set(ids).size === ids.length
  );
}

function validUserInputRequest(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    !uniqueIds(value.questions)
  )
    return false;
  if (value.kind === "clarification")
    return (
      value.questions.length <= 3 &&
      value.questions.every(
        (question) =>
          isRecord(question) &&
          typeof question.id === "string" &&
          typeof question.prompt === "string" &&
          (question.allowText === undefined || question.allowText === true) &&
          (question.options === undefined ||
            (Array.isArray(question.options) &&
              question.options.length >= 2 &&
              question.options.length <= 5 &&
              uniqueIds(question.options) &&
              question.options.every(
                (option) =>
                  isRecord(option) &&
                  typeof option.id === "string" &&
                  typeof option.label === "string" &&
                  optionalText(option.description),
              ))) &&
          (question.allowText === true || Array.isArray(question.options)),
      )
    );
  if (value.kind !== "quiz" || value.questions.length > 12) return false;
  return value.questions.every(
    (question) =>
      isRecord(question) &&
      typeof question.id === "string" &&
      typeof question.prompt === "string" &&
      (question.selection === "single" || question.selection === "multiple") &&
      typeof question.explanation === "string" &&
      question.explanation.trim().length > 0 &&
      Array.isArray(question.answers) &&
      question.answers.length >= 2 &&
      question.answers.length <= 8 &&
      uniqueIds(question.answers) &&
      question.answers.every(
        (answer) =>
          isRecord(answer) &&
          typeof answer.id === "string" &&
          typeof answer.label === "string",
      ) &&
      Array.isArray(question.correctAnswerIds) &&
      question.correctAnswerIds.length >= 1 &&
      new Set(question.correctAnswerIds).size ===
        question.correctAnswerIds.length &&
      question.correctAnswerIds.every(
        (answerId) =>
          typeof answerId === "string" &&
          (question.answers as unknown[]).some(
            (answer) => isRecord(answer) && answer.id === answerId,
          ),
      ) &&
      (question.selection !== "single" ||
        question.correctAnswerIds.length === 1),
  );
}

function validPendingUserInputRequest(value: unknown): boolean {
  return (
    validUserInputRequest(value) ||
    (isRecord(value) &&
      value.kind === "workBudget" &&
      typeof value.title === "string" &&
      typeof value.message === "string" &&
      typeof value.completedRounds === "number" &&
      Number.isSafeInteger(value.completedRounds) &&
      value.completedRounds > 0)
  );
}

function validUserInputResponse(request: unknown, value: unknown): boolean {
  if (
    !isRecord(request) ||
    !Array.isArray(request.questions) ||
    !isRecord(value) ||
    !Array.isArray(value.answers) ||
    value.answers.length !== request.questions.length
  )
    return false;
  const answers = value.answers;
  const questionIds = answers.map((answer) =>
    isRecord(answer) ? answer.questionId : undefined,
  );
  if (
    questionIds.some((id) => typeof id !== "string") ||
    new Set(questionIds).size !== questionIds.length
  )
    return false;
  return request.questions.every((question) => {
    if (!isRecord(question)) return false;
    const answer = answers.find(
      (candidate) =>
        isRecord(candidate) && candidate.questionId === question.id,
    );
    if (!isRecord(answer)) return false;
    const ids = answer.answerIds;
    const text = answer.text;
    if (request.kind === "clarification") {
      const validChoice =
        Array.isArray(ids) &&
        ids.length === 1 &&
        text === undefined &&
        Array.isArray(question.options) &&
        question.options.some(
          (option) => isRecord(option) && option.id === ids[0],
        );
      const validText =
        ids === undefined &&
        typeof text === "string" &&
        Boolean(text.trim()) &&
        question.allowText === true;
      return validChoice || validText;
    }
    return (
      text === undefined &&
      Array.isArray(ids) &&
      ids.length >= 1 &&
      new Set(ids).size === ids.length &&
      (question.selection !== "single" || ids.length === 1) &&
      Array.isArray(question.answers) &&
      ids.every((id) =>
        (question.answers as unknown[]).some(
          (option) => isRecord(option) && option.id === id,
        ),
      )
    );
  });
}

function validInteraction(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.callId === "string" &&
    validSequence(value.sequence) &&
    validUserInputRequest(value.request) &&
    validUserInputResponse(value.request, value.response)
  );
}

function validChanges(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (change) =>
          isRecord(change) &&
          typeof change.path === "string" &&
          (change.change === "created" || change.change === "updated") &&
          optionalText(change.before) &&
          optionalText(change.after) &&
          optionalText(change.omitted),
      ))
  );
}

/**
 * Each shape checked as itself. A detail is drawn without further inspection,
 * so a stored one whose items are the wrong shape would reach the interface as
 * a crash rather than as damaged data.
 */
function validDetail(detail: unknown): boolean {
  if (!isRecord(detail)) return false;
  switch (detail.kind) {
    case "text":
      return (
        typeof detail.label === "string" && typeof detail.text === "string"
      );
    case "facts":
      return (
        Array.isArray(detail.items) &&
        detail.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.label === "string" &&
            typeof item.value === "string",
        )
      );
    case "matches":
      return (
        Array.isArray(detail.items) &&
        optionalText(detail.note) &&
        detail.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.path === "string" &&
            typeof item.line === "number" &&
            typeof item.text === "string",
        )
      );
    case "list":
      return (
        typeof detail.label === "string" &&
        Array.isArray(detail.items) &&
        detail.items.every((item) => typeof item === "string")
      );
    case "image":
      return (
        typeof detail.label === "string" &&
        typeof detail.mediaType === "string" &&
        typeof detail.source === "string" &&
        typeof detail.alt === "string"
      );
    default:
      return false;
  }
}

function validDetails(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(validDetail))
  );
}

function validPhase(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "draft":
    case "loading":
    case "interrupted":
      return optionalText(value.reason);
    case "failed":
      return typeof value.reason === "string";
    case "completed":
      return (
        isRecord(value.outcome) &&
        typeof value.outcome.title === "string" &&
        typeof value.outcome.summary === "string" &&
        optionalText(value.outcome.file)
      );
    case "working":
    case "browser":
    case "approval":
    case "input": {
      if (
        !Array.isArray(value.steps) ||
        !value.steps.every(
          (step) =>
            isRecord(step) &&
            typeof step.id === "string" &&
            typeof step.label === "string" &&
            ["complete", "active", "queued", "failed"].includes(
              String(step.status),
            ),
        )
      )
        return false;
      const prompt = value.prompt;
      if (value.kind === "input")
        return (
          isRecord(prompt) &&
          typeof prompt.id === "string" &&
          validPendingUserInputRequest(prompt)
        );
      return (
        value.kind !== "approval" ||
        (isRecord(prompt) &&
          ["id", "action", "target", "reason", "command"].every(
            (key) => typeof prompt[key] === "string",
          ) &&
          optionalText(prompt.detail) &&
          optionalText(prompt.claim) &&
          validChanges(prompt.changes))
      );
    }
    default:
      return false;
  }
}

export class FileSessions implements Sessions {
  readonly #directory: string;
  readonly #workspaceFile: string;
  readonly #lockFile: string;
  readonly #pictureLimits: PictureLimits;
  readonly #now: () => Date;
  readonly #processIsRunning: (pid: number) => boolean;
  readonly #workspaceFiles: WorkspaceFileOperations;
  readonly #pid: number;
  #writes: Promise<void> = Promise.resolve();
  #owned = false;

  constructor(
    directory: string,
    options: {
      readonly pictures?: Partial<PictureLimits>;
      readonly now?: () => Date;
      /** Replaced in tests, where a dead process id has to be a known quantity. */
      readonly processIsRunning?: (pid: number) => boolean;
      /** Which process this instance speaks for. Injected so two owners can be tested. */
      readonly pid?: number;
      /** Replaced by boundary tests that make a workspace write fail. */
      readonly workspaceFiles?: WorkspaceFileOperations;
    } = {},
  ) {
    this.#directory = directory;
    this.#workspaceFile = join(directory, "workspace.json");
    this.#lockFile = join(directory, "owner.lock");
    this.#pictureLimits = { ...defaultPictureLimits, ...options.pictures };
    this.#now = options.now ?? (() => new Date());
    this.#processIsRunning = options.processIsRunning ?? processIsRunning;
    this.#pid = options.pid ?? process.pid;
    this.#workspaceFiles = options.workspaceFiles ?? {
      write: (path, source) => writeFile(path, source, "utf8"),
      replace: rename,
      remove: (path) => rm(path, { force: true }),
    };
  }

  /**
   * Takes ownership of the data directory for this process, or refuses.
   *
   * The write queue orders this process's saves and knows nothing about any
   * other process. Two instances each replacing the whole workspace file would
   * lose whichever set of changes finished first, with nothing to say it had
   * happened, so a second instance is prohibited rather than coordinated.
   *
   * A lock whose process is no longer running is taken over: the previous
   * launch was killed, and refusing forever would need the person to delete a
   * file they have no reason to know about. This trusts process ids not to be
   * reused between an unclean exit and the next launch, which is the same
   * assumption every lock file of this shape makes.
   */
  async claim(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const holder = await this.#currentOwner();
    if (holder !== undefined && holder !== this.#pid)
      throw new SessionStoreError(
        "in-use",
        "Another copy of the app is already using this data. Close it and try again.",
      );
    try {
      await writeFile(
        this.#lockFile,
        JSON.stringify({
          pid: this.#pid,
          since: this.#now().toISOString(),
        }),
        "utf8",
      );
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "This data folder could not be claimed.",
        { cause: error },
      );
    }
    this.#owned = true;
  }

  /** Gives the folder up so the next launch does not have to wait out a lock. */
  async release(): Promise<void> {
    this.#owned = false;
    await rm(this.#lockFile, { force: true }).catch(() => {});
  }

  /**
   * The process holding the folder, or nothing if it is free. A lock that
   * cannot be read or parsed is treated as free: an unreadable lock would
   * otherwise be an app that never starts again.
   */
  async #currentOwner(): Promise<number | undefined> {
    let source: string;
    try {
      source = await readFile(this.#lockFile, "utf8");
    } catch {
      return undefined;
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isRecord(value) || typeof value.pid !== "number") return undefined;
      return this.#processIsRunning(value.pid) ? value.pid : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Every durable write goes through here first. An instance that was refused
   * ownership must not be able to write anyway — a refusal that only stops the
   * launch, and not the writes, is not a lock.
   */
  async #requireOwnership(): Promise<void> {
    if (this.#owned) return;
    const holder = await this.#currentOwner();
    if (holder !== undefined && holder !== this.#pid)
      throw new SessionStoreError(
        "in-use",
        "Another copy of the app is using this data, so nothing was saved.",
      );
    this.#owned = true;
  }

  /**
   * One file per picture, named by the id the conversation refers to it by.
   * The id is generated here and never taken from anywhere else, so nothing a
   * model or a server chose can name a path.
   */
  #pictureFile(source: string): string | undefined {
    return /^[0-9a-f-]{36}$/.test(source)
      ? join(this.#directory, "pictures", source)
      : undefined;
  }

  /** Where the note left in a removed picture's place lives. */
  #removalFile(source: string): string | undefined {
    const file = this.#pictureFile(source);
    return file ? `${file}.removed` : undefined;
  }

  async savePicture(image: ProducedImage): Promise<string> {
    const id = randomUUID();
    const file = this.#pictureFile(id);
    if (!file)
      throw new SessionStoreError("unavailable", "Invalid picture id.");
    const encoded = JSON.stringify(image);
    try {
      await mkdir(join(this.#directory, "pictures"), { recursive: true });
      // A picture past the per-picture ceiling is refused whole rather than
      // stored and immediately evicted: one oversized screenshot must not be
      // able to push out every picture that came before it.
      if (Buffer.byteLength(encoded, "utf8") > this.#pictureLimits.pictureBytes)
        await this.#recordRemoval(id, oversizeReason);
      else await writeFile(file, encoded, "utf8");
    } catch (error) {
      throw new SessionStoreError(
        "unavailable",
        "A picture could not be saved.",
        { cause: error },
      );
    }
    // After the write, so the picture just saved is the one kept when the
    // store is already at its limit.
    await this.#cleanupPictures(id);
    return id;
  }

  async readPicture(source: string): Promise<StoredPicture> {
    const file = this.#pictureFile(source);
    if (!file) return { status: "missing", reason: unknownReason };
    try {
      const stored: unknown = JSON.parse(await readFile(file, "utf8"));
      if (
        isRecord(stored) &&
        typeof stored.mediaType === "string" &&
        typeof stored.data === "string"
      )
        return {
          status: "ready",
          mediaType: stored.mediaType,
          data: stored.data,
        };
    } catch {
      // Falls through to whatever was left in its place.
    }
    return { status: "missing", reason: await this.#removalReason(source) };
  }

  async #removalReason(source: string): Promise<string> {
    const note = this.#removalFile(source);
    if (!note) return unknownReason;
    try {
      const stored: unknown = JSON.parse(await readFile(note, "utf8"));
      if (isRecord(stored) && typeof stored.reason === "string")
        return stored.reason;
    } catch {
      // No note: the picture was never here, or predates this record.
    }
    return unknownReason;
  }

  async #recordRemoval(source: string, reason: string): Promise<void> {
    const note = this.#removalFile(source);
    if (!note) return;
    const removal: PictureRemoval = {
      reason,
      at: this.#now().toISOString(),
    };
    await writeFile(note, JSON.stringify(removal), "utf8").catch(() => {
      // A conversation that cannot say why a picture is gone still says it is.
    });
  }

  /**
   * Age first, then size, oldest going first — the same order recovery uses.
   * `keep` is the picture this cleanup was triggered by: it is never the one
   * evicted to make room for itself.
   */
  async #cleanupPictures(keep?: string): Promise<void> {
    const folder = join(this.#directory, "pictures");
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return;
    }
    const cutoff = this.#now().getTime() - this.#pictureLimits.maximumAgeMs;
    const kept: { id: string; bytes: number; at: number }[] = [];
    for (const name of names) {
      if (name.endsWith(".removed")) {
        // The note outlives the picture, but not for ever.
        const info = await stat(join(folder, name)).catch(() => undefined);
        if (info && info.mtimeMs < cutoff)
          await rm(join(folder, name), { force: true });
        continue;
      }
      const info = await stat(join(folder, name)).catch(() => undefined);
      if (!info) continue;
      if (name !== keep && info.mtimeMs < cutoff) {
        await rm(join(folder, name), { force: true });
        await this.#recordRemoval(name, evictedReason);
        continue;
      }
      kept.push({ id: name, bytes: info.size, at: info.mtimeMs });
    }
    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of kept.sort((a, b) => a.at - b.at)) {
      if (total <= this.#pictureLimits.totalBytes) break;
      if (entry.id === keep) continue;
      await rm(join(folder, entry.id), { force: true });
      await this.#recordRemoval(entry.id, evictedReason);
      total -= entry.bytes;
    }
  }

  async forgetPictures(sources: readonly string[]): Promise<void> {
    await Promise.all(
      sources.map(async (source) => {
        const file = this.#pictureFile(source);
        if (file) await rm(file, { force: true });
      }),
    );
  }

  async loadWorkspace(): Promise<SavedWorkspace | undefined> {
    let source: string;
    try {
      source = await readFile(this.#workspaceFile, "utf8");
    } catch (error) {
      if (isRecord(error) && "code" in error && error.code === "ENOENT")
        return undefined;
      throw new SessionStoreError(
        "unavailable",
        "Saved task history could not be read.",
        { cause: error },
      );
    }

    try {
      const value: unknown = JSON.parse(source);
      if (!isSavedWorkspace(value)) throw new Error("Invalid workspace");
      return durable(value);
    } catch (error) {
      throw new SessionStoreError(
        "corrupted",
        "Saved task history is damaged and cannot be opened safely.",
        { cause: error },
      );
    }
  }

  /**
   * What is left of a history file that will not open, without changing it.
   *
   * `unreadable` means the file is not JSON at all and nothing can be salvaged.
   * `partial` means the shape is intact and some conversations are readable,
   * so there is a real choice to offer rather than only an apology.
   */
  async inspectDamage(): Promise<DamageReport> {
    let source: string;
    try {
      source = await readFile(this.#workspaceFile, "utf8");
    } catch {
      return { kind: "unreadable" };
    }
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      return { kind: "unreadable" };
    }
    if (!isRecord(value) || !Array.isArray(value.tasks))
      return { kind: "unreadable" };
    const readable = value.tasks.filter(isWorkspaceTask);
    return readable.length
      ? {
          kind: "partial",
          readable: readable.length,
          damaged: value.tasks.length - readable.length,
        }
      : { kind: "unreadable" };
  }

  /**
   * Copies the damaged file somewhere it will not be written over, and leaves
   * the original exactly where it is. Every copy is kept: a second damaged
   * launch must not erase the evidence from the first.
   */
  async preserveDamaged(): Promise<string> {
    const source = await readFile(this.#workspaceFile, "utf8").catch(
      (error: unknown) => {
        throw new SessionStoreError(
          "unavailable",
          "The damaged history could not be read in order to keep it.",
          { cause: error },
        );
      },
    );
    const directory = join(this.#directory, "damaged-history");
    await mkdir(directory, { recursive: true });
    const stamp = this.#now().toISOString().replace(/[:.]/g, "-");
    const kept = join(directory, `workspace-${stamp}.json`);
    await writeFile(kept, source, "utf8");
    return kept;
  }

  /**
   * Keeps the damaged file, then rewrites the history with the conversations
   * that could be read. A file with nothing readable is refused rather than
   * turned into an empty history: starting over is a choice for the person to
   * make, not a consequence of asking what could be recovered.
   */
  async recoverReadable(): Promise<{
    readonly recovered: number;
    readonly discarded: number;
    readonly kept: string;
  }> {
    const damage = await this.inspectDamage();
    if (damage.kind !== "partial")
      throw new SessionStoreError(
        "corrupted",
        "Nothing in the saved history could be read, so there is nothing to recover.",
      );
    const kept = await this.preserveDamaged();
    const value = JSON.parse(
      await readFile(this.#workspaceFile, "utf8"),
    ) as Record<string, unknown>;
    const tasks = (value.tasks as unknown[]).filter(isWorkspaceTask);
    const ids = new Set(tasks.map((task) => (task as { id: string }).id));
    const recovered: SavedWorkspace = {
      ...(isRecord(value.preferences)
        ? {
            preferences: value.preferences as NonNullable<
              WorkspaceSnapshot["preferences"]
            >,
          }
        : {}),
      ...(isFolder(value.workspace)
        ? {
            workspace: value.workspace as NonNullable<
              WorkspaceSnapshot["workspace"]
            >,
          }
        : {}),
      tasks: tasks as WorkspaceSnapshot["tasks"],
      // A conversation that did not survive cannot stay selected: the window
      // would open on a conversation that is not there.
      selectedTaskId:
        typeof value.selectedTaskId === "string" &&
        ids.has(value.selectedTaskId)
          ? value.selectedTaskId
          : ((tasks[0] as { id: string } | undefined)?.id ?? null),
    };
    await this.saveWorkspace(recovered);
    return {
      recovered: tasks.length,
      discarded: (value.tasks as unknown[]).length - tasks.length,
      kept,
    };
  }

  async saveWorkspace(
    workspace: SavedWorkspace,
    options: { readonly commit?: () => boolean } = {},
  ): Promise<void> {
    const source = JSON.stringify(
      { version: 1, ...durable(workspace) },
      null,
      2,
    );
    // The queue is joined before anything is awaited, so saves commit in the
    // order they were submitted. Ownership is checked inside the queued work
    // for the same reason: awaiting it out here would let a later save overtake
    // an earlier one while the check was in flight.
    const write = this.#writes.then(async () => {
      await this.#requireOwnership();
      await this.#write(source, options.commit);
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async #write(
    source: string,
    commit: () => boolean = () => true,
  ): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporaryFile = `${this.#workspaceFile}.${randomUUID()}.tmp`;
    try {
      await this.#workspaceFiles.write(temporaryFile, source);
      if (!commit()) {
        await this.#workspaceFiles.remove(temporaryFile);
        return;
      }
      await this.#workspaceFiles.replace(temporaryFile, this.#workspaceFile);
    } catch (error) {
      await this.#workspaceFiles.remove(temporaryFile).catch(() => undefined);
      throw new SessionStoreError(
        "unavailable",
        "Task history could not be saved.",
        { cause: error },
      );
    }
  }

  async list(): Promise<readonly SessionSummary[]> {
    const workspace = await this.loadWorkspace();
    return (
      workspace?.tasks.map((task) => ({ id: task.id, label: task.title })) ?? []
    );
  }

  async undo(): Promise<void> {
    throw new SessionStoreError(
      "unavailable",
      "File undo is not available yet.",
    );
  }
}
