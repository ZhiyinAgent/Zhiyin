/**
 * What a saved workspace must look like to be loaded. Anything else is treated
 * as damaged rather than trusted: a history file is read back into a running
 * app, and a record of the wrong shape would fail somewhere far from here.
 */

import {
  byKind,
  oneOf,
  REASONING_EFFORTS,
  viewKinds,
  type ActionDetail,
  type ModelResponseRecord,
  type ModelRetryRecord,
  type PendingUserInputRequest,
  type QuizQuestion,
  type ReasoningTrace,
  type SpecialistRun,
  type TaskAction,
  type TaskArtifact,
  type TaskMessage,
  type TaskPhase,
  type TaskPlanItem,
  type TurnRemedy,
  type UserInputRequest,
  type WorkLimit,
  type WorkspaceTask,
  type WorkStep,
} from "@zhiyin/contract";
import {
  validCondensing,
  validContextBudget,
  validContextUsage,
} from "./saved-context.js";
import { validChanges } from "./saved-changes.js";
import {
  optionalTrue,
  validApproval,
  validCommandChanges,
  validInvocation,
  validRecovery,
} from "./saved-action-parts.js";
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
import {
  listOf,
  validAttachment,
  validConversationPermission,
  validGuidance,
  validModelHistoryEntry,
  validPluginId,
  validRunningJob,
  validUndo,
} from "./saved-records.js";

const titleSource = oneOf<WorkspaceTask["titleSource"]>({
  generated: true,
  manual: true,
});
const messageRole = oneOf<TaskMessage["role"]>({ user: true, assistant: true });
const traceStatus = oneOf<ReasoningTrace["status"]>({
  streaming: true,
  complete: true,
  interrupted: true,
});
const termination = oneOf<ModelResponseRecord["termination"]>({
  sentinel: true,
  finishReason: true,
  usage: true,
});
const retryKind = oneOf<ModelRetryRecord["kind"]>({
  silent: true,
  restart: true,
});
const actionStatus = oneOf<TaskAction["status"]>({
  running: true,
  completed: true,
  reported: true,
  failed: true,
  denied: true,
  blocked: true,
  cancelled: true,
});
const artifactChange = oneOf<TaskArtifact["change"]>({
  created: true,
  updated: true,
});
const runStatus = oneOf<SpecialistRun["status"]>({
  running: true,
  completed: true,
  failed: true,
  interrupted: true,
});
const planStatus = oneOf<TaskPlanItem["status"]>({
  pending: true,
  in_progress: true,
  done: true,
  skipped: true,
});
const stepStatus = oneOf<WorkStep["status"]>({
  complete: true,
  active: true,
  queued: true,
  failed: true,
});
const quizSelection = oneOf<QuizQuestion["selection"]>({
  single: true,
  multiple: true,
});
const turnRemedy = oneOf<TurnRemedy>({
  tryAgain: true,
  continue: true,
  updateApiKey: true,
  openSettings: true,
  chooseModel: true,
  chooseLargerModel: true,
  addCredits: true,
  editMessage: true,
});

const specialistAccess = oneOf<
  NonNullable<SpecialistRun["specialist"]["access"]>
>({ read: true, change: true });

const workLimit = oneOf<WorkLimit>({
  toolRounds: true,
  elapsed: true,
  providerCost: true,
});

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
      traceStatus(value.status))
  );
}

function validModelResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    optionalText(value.requestId) &&
    optionalText(value.model) &&
    optionalText(value.provider) &&
    (value.finishReason === null || typeof value.finishReason === "string") &&
    termination(value.termination) &&
    typeof value.complete === "boolean" &&
    (value.retries === undefined ||
      (Array.isArray(value.retries) && value.retries.every(validModelRetry))) &&
    [value.startedAt, value.firstTokenAt, value.finishedAt].every(
      optionalIsoDate,
    ) &&
    (value.usage === undefined || validResponseUsage(value.usage))
  );
}

function validResponseUsage(value: unknown): boolean {
  const count = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  return (
    isRecord(value) &&
    count(value.inputTokens) &&
    count(value.outputTokens) &&
    [
      value.reasoningTokens,
      value.cacheReadTokens,
      value.cacheWriteTokens,
      value.costUsd,
    ].every((item) => item === undefined || count(item)) &&
    (value.estimatedCost === undefined ||
      (validAmountIn(value.estimatedCost) &&
        isRecord(value.estimatedCost) &&
        typeof value.estimatedCost.priceList === "string" &&
        value.estimatedCost.priceList !== ""))
  );
}

/** Absent, or amounts each in their own currency. */
function optionalAmounts(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(validAmountIn))
  );
}

/** An amount in one currency, named by its ISO 4217 code. */
function validAmountIn(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount >= 0 &&
    typeof value.currency === "string" &&
    /^[A-Z]{3}$/.test(value.currency)
  );
}

function optionalIsoDate(value: unknown): boolean {
  return value === undefined || validIsoDate(value);
}

function validModelRetry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.failure === "string" &&
    typeof value.delayMs === "number" &&
    Number.isFinite(value.delayMs) &&
    retryKind(value.kind) &&
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
    (value.tools === undefined || stringArray(value.tools)) &&
    (value.access === undefined || specialistAccess(value.access)) &&
    provenance.source === "plugin" &&
    typeof provenance.pluginId === "string"
  );
}

function validSpecialistHandoff(value: unknown): boolean {
  return isRecord(value) && typeof value.report === "string";
}

function validSpecialistRun(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const status = value.status;
  if (
    typeof value.id !== "string" ||
    !optionalText(value.parentRunId) ||
    !validSpecialist(value.specialist) ||
    typeof value.task !== "string" ||
    !Number.isInteger(value.depth) ||
    Number(value.depth) < 1 ||
    !runStatus(status) ||
    !validIsoDate(value.startedAt) ||
    !stringArray(value.actionIds) ||
    !validSequence(value.sequence) ||
    !optionalText(value.reason) ||
    (value.quiet !== undefined && value.quiet !== true) ||
    (value.handoffDelivered !== undefined &&
      typeof value.handoffDelivered !== "boolean")
  )
    return false;
  if (status === "running")
    return value.finishedAt === undefined && value.handoff === undefined;
  if (!validIsoDate(value.finishedAt)) return false;
  return status === "completed"
    ? validSpecialistHandoff(value.handoff)
    : value.handoff === undefined && typeof value.reason === "string";
}

function validMessage(message: unknown): boolean {
  return (
    isRecord(message) &&
    typeof message.id === "string" &&
    messageRole(message.role) &&
    typeof message.text === "string" &&
    (message.attachments === undefined ||
      listOf(message.attachments, validAttachment)) &&
    validReasoningTrace(message.reasoning) &&
    optionalText(message.interactionId) &&
    validSequence(message.sequence)
  );
}

function validAction(action: unknown): boolean {
  return (
    isRecord(action) &&
    typeof action.id === "string" &&
    typeof action.action === "string" &&
    typeof action.target === "string" &&
    [
      action.command,
      action.toolName,
      action.evidence,
      action.description,
      action.detail,
      action.claim,
      action.reason,
      action.folder,
    ].every(optionalText) &&
    validChanges(action.changes) &&
    validDetails(action.details) &&
    validApproval(action.approval) &&
    validRecovery(action.recovery) &&
    validCommandChanges(action.commandChanges) &&
    validInvocation(action.invocation) &&
    optionalTrue(action.readOnly) &&
    optionalText(action.specialistRunId) &&
    actionStatus(action.status) &&
    optionalIsoDate(action.startedAt) &&
    optionalIsoDate(action.finishedAt) &&
    validSequence(action.sequence)
  );
}

function validArtifact(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    artifactChange(item.change) &&
    typeof item.bytes === "number" &&
    typeof item.updatedAt === "string" &&
    optionalText(item.folder)
  );
}

function validView(view: unknown): boolean {
  return (
    isRecord(view) &&
    typeof view.id === "string" &&
    typeof view.callId === "string" &&
    typeof view.title === "string" &&
    (viewKinds as readonly string[]).includes(String(view.kind)) &&
    typeof view.source === "string" &&
    validSequence(view.sequence)
  );
}

/**
 * How each part of a conversation is checked, under the name it is saved by.
 * Every part the type names has its check here: one added to the type without
 * one does not compile.
 */
const conversationParts: {
  readonly [Part in keyof WorkspaceTask]-?: (
    task: Record<string, unknown>,
  ) => boolean;
} = {
  id: (task) => typeof task.id === "string",
  title: (task) => typeof task.title === "string",
  reasoning: (task) => validReasoningSelection(task.reasoning),
  contextBudget: (task) => validContextBudget(task.contextBudget),
  titleSource: (task) => titleSource(task.titleSource),
  workspace: (task) => task.workspace === undefined || isFolder(task.workspace),
  updatedLabel: (task) => typeof task.updatedLabel === "string",
  updatedAt: (task) => validIsoDate(task.updatedAt),
  turnStartedAt: (task) => optionalIsoDate(task.turnStartedAt),
  messages: (task) => listOf(task.messages, validMessage),
  guidance: (task) => listOf(task.guidance, validGuidance),
  modelResponses: (task) => listOf(task.modelResponses, validModelResponse),
  modelHistory: (task) => listOf(task.modelHistory, validModelHistoryEntry),
  conversationPermissions: (task) =>
    listOf(task.conversationPermissions, validConversationPermission),
  runningJobs: (task) => listOf(task.runningJobs, validRunningJob),
  activatedPlugins: (task) => listOf(task.activatedPlugins, validPluginId),
  undos: (task) => listOf(task.undos, validUndo),
  compaction: (task) =>
    validCompaction(task.compaction, task.messages, task.actions),
  condensings: (task) => listOf(task.condensings, validCondensing),
  contextUsage: (task) => validContextUsage(task.contextUsage),
  standingInstructions: (task) =>
    validStandingInstructions(task.standingInstructions),
  phase: (task) => validPhase(task.phase),
  actions: (task) => listOf(task.actions, validAction),
  artifacts: (task) => listOf(task.artifacts, validArtifact),
  specialistRuns: (task) =>
    listOf(task.specialistRuns, validSpecialistRun) &&
    uniqueIds(task.specialistRuns as unknown[]),
  views: (task) => listOf(task.views, validView),
  interactions: (task) => listOf(task.interactions, validInteraction),
  plan: (task) => listOf(task.plan, validPlanItem),
};

/**
 * What is wrong with a saved conversation, naming the first part of it that is
 * not what Zhiyin writes there; nothing when all of it reads.
 */
export function conversationProblem(task: unknown): string | undefined {
  if (!isRecord(task)) return "what was saved is not a conversation";
  const part = Object.entries(conversationParts).find(
    ([, reads]) => !reads(task),
  )?.[0];
  return part === undefined
    ? undefined
    : `what it holds as “${part}” is not what Zhiyin saves there`;
}

/**
 * One conversation, checked on its own when it is opened. Each conversation
 * is its own file, so one that fails this is left behind without taking any
 * other conversation with it.
 */
export function isWorkspaceTask(task: unknown): boolean {
  return conversationProblem(task) === undefined;
}

/** One plan item: a title and where the working model says it stands. */
function validPlanItem(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    planStatus(item.status)
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
    typeof value.throughEntryId !== "string" ||
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

function uniqueIds(values: readonly unknown[]): boolean {
  const ids = values.map((value) => (isRecord(value) ? value.id : undefined));
  return (
    ids.every((id) => typeof id === "string") &&
    new Set(ids).size === ids.length
  );
}

/** One to `most` questions under a title, each with an id of its own. */
function asked(
  request: Record<string, unknown>,
  most: number,
): readonly unknown[] | undefined {
  const questions = request.questions;
  return typeof request.title === "string" &&
    Array.isArray(questions) &&
    questions.length >= 1 &&
    questions.length <= most &&
    uniqueIds(questions)
    ? questions
    : undefined;
}

function validClarificationQuestion(question: unknown): boolean {
  return (
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
    (question.allowText === true || Array.isArray(question.options))
  );
}

function validQuizQuestion(question: unknown): boolean {
  return (
    isRecord(question) &&
    typeof question.id === "string" &&
    typeof question.prompt === "string" &&
    quizSelection(question.selection) &&
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
    (question.selection !== "single" || question.correctAnswerIds.length === 1)
  );
}

const validUserInputRequest = byKind<UserInputRequest["kind"]>({
  clarification: (request) =>
    asked(request, 3)?.every(validClarificationQuestion) ?? false,
  quiz: (request) => asked(request, 12)?.every(validQuizQuestion) ?? false,
});

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const validPendingUserInputRequest = byKind<PendingUserInputRequest["kind"]>({
  clarification: validUserInputRequest,
  quiz: validUserInputRequest,
  folderInstructions: validFolderInstructionsRequest,
  workBudget: (request) =>
    typeof request.title === "string" &&
    count(request.completedRounds) &&
    Array.isArray(request.reached) &&
    request.reached.length > 0 &&
    request.reached.every(workLimit) &&
    amount(request.elapsedMs) &&
    (request.costUsd === undefined || amount(request.costUsd)) &&
    optionalAmounts(request.estimatedCosts) &&
    isRecord(request.allowance) &&
    count(request.allowance.toolRounds) &&
    amount(request.allowance.elapsedMs) &&
    amount(request.allowance.providerCostUsd) &&
    optionalAmounts(request.allowance.providerCosts) &&
    optionalText(request.reason) &&
    (request.sinceStart === undefined || workSoFar(request.sinceStart)),
});

/** The whole task's figures a checkpoint after Keep going carries. */
function workSoFar(value: unknown): boolean {
  return (
    isRecord(value) &&
    count(value.completedRounds) &&
    amount(value.elapsedMs) &&
    (value.costUsd === undefined || amount(value.costUsd)) &&
    optionalAmounts(value.estimatedCosts)
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

/**
 * Each shape checked as itself. A detail is drawn without further inspection,
 * so a stored one whose items are the wrong shape would reach the interface as
 * a crash rather than as damaged data.
 */
const validDetail = byKind<ActionDetail["kind"]>({
  text: (detail) =>
    typeof detail.label === "string" && typeof detail.text === "string",
  facts: (detail) =>
    Array.isArray(detail.items) &&
    detail.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.label === "string" &&
        typeof item.value === "string",
    ),
  matches: (detail) =>
    Array.isArray(detail.items) &&
    optionalText(detail.note) &&
    detail.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === "string" &&
        typeof item.line === "number" &&
        typeof item.text === "string",
    ),
  list: (detail) =>
    typeof detail.label === "string" &&
    Array.isArray(detail.items) &&
    detail.items.every((item) => typeof item === "string"),
  image: (detail) =>
    typeof detail.label === "string" &&
    typeof detail.mediaType === "string" &&
    typeof detail.source === "string" &&
    typeof detail.alt === "string",
});

function validDetails(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every(validDetail))
  );
}

function validSteps(steps: unknown): boolean {
  return listOf(
    steps,
    (step) =>
      isRecord(step) &&
      typeof step.id === "string" &&
      typeof step.label === "string" &&
      stepStatus(step.status),
  );
}

/** What the person is asked to allow, as the approval prompt draws it. */
function validApprovalRequest(prompt: unknown): boolean {
  return (
    isRecord(prompt) &&
    ["id", "action", "target", "reason", "command"].every(
      (key) => typeof prompt[key] === "string",
    ) &&
    optionalText(prompt.detail) &&
    optionalText(prompt.claim) &&
    optionalText(prompt.effect) &&
    optionalText(prompt.destination) &&
    optionalTrue(prompt.reasonByModel) &&
    validInvocation(prompt.invocation) &&
    validRecovery(prompt.recovery) &&
    validChanges(prompt.changes) &&
    (prompt.conversationRule === undefined ||
      (isRecord(prompt.conversationRule) &&
        typeof prompt.conversationRule.label === "string"))
  );
}

const reasonIfAny = (phase: Record<string, unknown>) =>
  optionalText(phase.reason);

const validPhase = byKind<TaskPhase["kind"]>({
  draft: reasonIfAny,
  interrupted: reasonIfAny,
  failed: (phase) =>
    typeof phase.reason === "string" &&
    (phase.remedies === undefined || listOf(phase.remedies, turnRemedy)),
  completed: (phase) =>
    isRecord(phase.outcome) &&
    typeof phase.outcome.title === "string" &&
    typeof phase.outcome.summary === "string" &&
    (phase.backgroundSpecialistIds === undefined ||
      stringArray(phase.backgroundSpecialistIds)),
  working: (phase) =>
    validSteps(phase.steps) && validRetryDeadline(phase.retry),
  approval: (phase) =>
    validSteps(phase.steps) && validApprovalRequest(phase.prompt),
  input: (phase) =>
    validSteps(phase.steps) &&
    isRecord(phase.prompt) &&
    typeof phase.prompt.id === "string" &&
    validPendingUserInputRequest(phase.prompt),
});
