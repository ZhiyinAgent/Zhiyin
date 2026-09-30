/**
 * What a saved workspace must look like to be loaded. Anything else is treated
 * as damaged rather than trusted: a history file is read back into a running
 * app, and a record of the wrong shape would fail somewhere far from here.
 */

import { REASONING_EFFORTS } from "@zhiyin/contract";
import {
  validCondensing,
  validContextBudget,
  validContextUsage,
} from "./saved-context.js";
import {
  isRecord,
  isFolder,
  optionalText,
  validRetryDeadline,
  validSequence,
} from "./saved-values.js";
export { isFolder } from "./saved-values.js";
import {
  validFolderInstructionsRequest,
  validStandingInstructions,
} from "./saved-instructions.js";

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
    typeof value.complete === "boolean" &&
    (value.retries === undefined ||
      (Array.isArray(value.retries) && value.retries.every(validModelRetry)))
  );
}

function validModelRetry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.failure === "string" &&
    typeof value.delayMs === "number" &&
    Number.isFinite(value.delayMs) &&
    (value.kind === "silent" || value.kind === "restart") &&
    (value.discardedCharacters === undefined ||
      (typeof value.discardedCharacters === "number" &&
        Number.isFinite(value.discardedCharacters)))
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

/**
 * One conversation, checked on its own when it is opened. Each conversation
 * is its own file, so one that fails this is left behind without taking any
 * other conversation with it.
 */
export function isWorkspaceTask(task: unknown): boolean {
  return Boolean(
    isRecord(task) &&
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    validReasoningSelection(task.reasoning) &&
    validContextBudget(task.contextBudget) &&
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
    (task.condensings === undefined ||
      (Array.isArray(task.condensings) &&
        task.condensings.every(validCondensing))) &&
    validContextUsage(task.contextUsage) &&
    validStandingInstructions(task.standingInstructions) &&
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
      (Array.isArray(task.plan) && task.plan.every(validPlanItem))),
  );
}

/** One plan item: a title and where the working model says it stands. */
function validPlanItem(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    ["pending", "in_progress", "done", "skipped"].includes(String(item.status))
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
    !optionalText(value.throughEntryId) ||
    !optionalText(value.carried) ||
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

const workLimits = new Set<unknown>(["toolRounds", "elapsed", "providerCost"]);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function validPendingUserInputRequest(value: unknown): boolean {
  return (
    validUserInputRequest(value) ||
    validFolderInstructionsRequest(value) ||
    (isRecord(value) &&
      value.kind === "workBudget" &&
      typeof value.title === "string" &&
      count(value.completedRounds) &&
      Array.isArray(value.reached) &&
      value.reached.length > 0 &&
      value.reached.every((limit) => workLimits.has(limit)) &&
      amount(value.elapsedMs) &&
      (value.costUsd === undefined || amount(value.costUsd)) &&
      isRecord(value.allowance) &&
      count(value.allowance.toolRounds) &&
      amount(value.allowance.elapsedMs) &&
      amount(value.allowance.providerCostUsd) &&
      optionalText(value.reason))
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
      if (value.kind === "working" && !validRetryDeadline(value.retry))
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
