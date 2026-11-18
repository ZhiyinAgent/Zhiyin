/**
 * The demo's own store.
 *
 * The window's state is event-derived (ADR 0003): every change comes from the
 * core. A demo has no core, so it makes the changes itself — and that
 * simulation lives here, beside the demo, rather than in the reducer the real
 * window uses. Everything the real core would send is left to the reducer this
 * one delegates to.
 */

import {
  selectedBeside,
  windowReducer,
  type WindowAction,
  type WindowState,
  type WorkspaceTask,
} from "../ui/app/index.js";
import {
  emptyConversationLists,
  type Appearance,
  type ContextBudgetChoice,
  type LookChoice,
  type ReviewerModelChoice,
  type SpellingChoice,
  type WorkPauses,
} from "@zhiyin/contract";
import { demoImportedPlugin } from "./fixtures/capabilities.js";
import { closedDocument } from "./fixtures/documents.js";

type TaskAction = NonNullable<WorkspaceTask["actions"]>[number];
type ApprovalRequest = Extract<
  WorkspaceTask["phase"],
  { kind: "approval" }
>["prompt"];
type TaskOutcome = Extract<
  WorkspaceTask["phase"],
  { kind: "completed" }
>["outcome"];

/** What the demo makes happen for itself, beside everything the core sends. */
export type DemoAction =
  | WindowAction
  | { type: "taskCreated"; id: string }
  | { type: "taskSelected"; id: string }
  | { type: "taskRenamed"; taskId: string; title: string }
  | { type: "taskDeleted"; taskId: string }
  | { type: "contextBudgetChosen"; taskId: string; budget: ContextBudgetChoice }
  | { type: "defaultContextBudgetChosen"; budget: ContextBudgetChoice }
  | { type: "notificationsChosen"; enabled: boolean }
  | { type: "studioReviewsChosen"; enabled: boolean }
  | { type: "reviewerModelChosen"; choice: ReviewerModelChoice | null }
  | { type: "workPausesChosen"; pauses: WorkPauses }
  | { type: "appearanceChosen"; appearance: Appearance }
  | { type: "lookChosen"; choice: LookChoice }
  | { type: "spellingChosen"; choice: SpellingChoice }
  | { type: "messageSubmitted"; taskId: string; message: string }
  | { type: "approvalRequested"; taskId: string; prompt: ApprovalRequest }
  | { type: "approvalResolved"; taskId: string; allowed: boolean }
  | { type: "taskCompleted"; taskId: string; outcome: TaskOutcome }
  | { type: "taskFailed"; taskId: string; reason: string }
  | { type: "taskInterrupted"; taskId: string }
  | { type: "answerAsked"; taskId: string }
  | { type: "waitingSent"; taskId: string }
  | { type: "waitingTakenBack"; taskId: string; messageId: string }
  | { type: "pluginToggled"; id: string; enabled: boolean }
  | { type: "componentToggled"; id: string; enabled: boolean }
  | { type: "pluginImported" }
  | { type: "documentClosed"; taskId: string };

/** The place after everything already on the conversation's timeline. */
function nextPlace(task: WorkspaceTask): number {
  return (
    Math.max(
      -1,
      ...[
        ...task.messages,
        ...task.actions,
        ...task.views,
        ...task.interactions,
        ...task.specialistRuns,
      ].map((entry) => entry.sequence),
    ) + 1
  );
}

function updateTask(
  state: WindowState,
  id: string,
  update: (task: WorkspaceTask) => WorkspaceTask,
): WorkspaceTask[] {
  return state.tasks.map((task) => (task.id === id ? update(task) : task));
}

export function demoReducer(
  state: WindowState,
  action: DemoAction,
): WindowState {
  switch (action.type) {
    case "taskCreated": {
      const task: WorkspaceTask = {
        id: action.id,
        title: "New conversation",
        updatedLabel: "Now",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        messages: [],
        actions: [],
        phase: { kind: "draft" },
      };
      return {
        ...state,
        surface: "thread",
        selectedTaskId: action.id,
        tasks: [task, ...state.tasks],
      };
    }
    case "taskSelected":
      return {
        ...state,
        surface: "thread",
        selectedTaskId: action.id,
      };
    case "taskRenamed": {
      const title = action.title.trim();
      if (!title) return state;
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({ ...task, title })),
      };
    }
    case "contextBudgetChosen":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          contextBudget: action.budget,
        })),
      };
    case "defaultContextBudgetChosen":
      return { ...state, contextBudget: action.budget };
    // The window's theme follows the operating system in a browser; the demo
    // keeps the choice so the page shows what was picked.
    case "appearanceChosen": {
      const { appearance, ...rest } = state;
      void appearance;
      return action.appearance === "system"
        ? rest
        : { ...rest, appearance: action.appearance };
    }
    // The demo dresses itself in the look chosen, as the core's word would.
    case "lookChosen":
      return { ...state, look: action.choice };
    // Every dictionary is at hand in the demo, so each language is ready.
    case "spellingChosen":
      return state.spelling
        ? {
            ...state,
            spelling: {
              ...state.spelling,
              enabled: action.choice.enabled,
              languages: action.choice.languages.map((code) => ({
                code,
                status: "ready" as const,
              })),
            },
          }
        : state;
    case "notificationsChosen": {
      const { notifications, ...rest } = state;
      void notifications;
      return action.enabled ? rest : { ...rest, notifications: "off" };
    }
    case "studioReviewsChosen": {
      const { studioReviews, ...rest } = state;
      void studioReviews;
      return action.enabled ? rest : { ...rest, studioReviews: "off" };
    }
    case "reviewerModelChosen": {
      const { reviewerModel, ...rest } = state;
      void reviewerModel;
      return action.choice ? { ...rest, reviewerModel: action.choice } : rest;
    }
    case "workPausesChosen":
      return { ...state, workPauses: action.pauses };
    // Which conversation is left open once one is deleted is a question about
    // the state, so it is answered here rather than by whoever asked.
    case "taskDeleted": {
      const remaining = state.tasks.filter((task) => task.id !== action.taskId);
      return demoReducer(state, {
        type: "taskRemoved",
        taskId: action.taskId,
        selectedTaskId:
          state.selectedTaskId === action.taskId
            ? (remaining[0]?.id ?? null)
            : state.selectedTaskId,
      });
    }
    case "messageSubmitted": {
      if (state.runtime.tasks === "unavailable") return state;
      const message = action.message.trim();
      if (!message) return state;
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          title:
            task.title === "New conversation"
              ? message.length > 42
                ? `${message.slice(0, 39)}…`
                : message
              : task.title,
          updatedLabel: "Now",
          messages: [
            ...task.messages,
            {
              sequence: nextPlace(task),
              id: `${task.id}-user-${task.messages.length}`,
              role: "user",
              text: message,
            },
          ],
          phase: { kind: "working", steps: [] },
        })),
      };
    }
    case "approvalRequested":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          phase: {
            kind: "approval",
            steps: task.phase.kind === "working" ? task.phase.steps : [],
            prompt: action.prompt,
          },
        })),
      };
    case "approvalResolved":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => {
          const approval =
            task.phase.kind === "approval" ? task.phase : undefined;
          const prompt = approval?.prompt;
          const actionRecord: TaskAction | undefined = prompt
            ? {
                sequence: nextPlace(task),
                id: `${task.id}-action-${task.actions.length}`,
                action: prompt.action,
                target: prompt.target,
                status: action.allowed ? "running" : "denied",
                // Carried across from the request: what was reviewed is what
                // the record should still show afterwards.
                ...(prompt.changes ? { changes: prompt.changes } : {}),
                ...(!action.allowed
                  ? { reason: "The action was denied. No further work ran." }
                  : {}),
              }
            : undefined;
          return {
            ...task,
            actions: actionRecord
              ? [...task.actions, actionRecord]
              : task.actions,
            phase: action.allowed
              ? {
                  kind: "working",
                  steps: prompt
                    ? [
                        ...(approval?.steps ?? []),
                        {
                          id: `tool-${prompt.id}`,
                          label: prompt.action,
                          detail: prompt.target,
                          status: "active" as const,
                        },
                      ]
                    : [],
                }
              : {
                  kind: "interrupted",
                  reason: "The action was denied. No further work ran.",
                },
          };
        }),
      };
    case "taskCompleted":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          phase: { kind: "completed", outcome: action.outcome },
        })),
      };
    case "taskFailed":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          phase: { kind: "failed", reason: action.reason },
        })),
      };
    // The core stops the reasoning request and asks again; here what was
    // reasoned goes, and the status says what the core's would.
    case "answerAsked":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          messages: task.messages.filter(
            (message) =>
              message.role !== "assistant" ||
              message.reasoning?.status !== "streaming",
          ),
          phase: { kind: "working", steps: [], note: "Answering now" },
        })),
      };
    // As the core does it: the reasoning goes, and what waited is read.
    case "waitingSent":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => {
          const read = task.messages.filter(
            (message) =>
              message.role !== "assistant" ||
              message.reasoning?.status !== "streaming",
          );
          const from =
            Math.max(-1, ...read.map((message) => message.sequence)) + 1;
          return {
            ...task,
            messages: [
              ...read,
              ...task.guidance
                .filter((item) => item.status === "pending")
                .map((item, index) => ({
                  id: item.id,
                  role: "user" as const,
                  text: item.text,
                  sequence: from + index,
                })),
            ],
            guidance: task.guidance.filter((item) => item.status !== "pending"),
            phase: { kind: "working", steps: [], note: "Reading your message" },
          };
        }),
      };
    // Back to the message box, which shows a conversation's drafts.
    case "waitingTakenBack":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          guidance: task.guidance.map((item) =>
            item.id === action.messageId
              ? { ...item, status: "draft" as const }
              : item,
          ),
        })),
      };
    case "taskInterrupted":
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({
          ...task,
          phase: { kind: "interrupted" },
        })),
      };
    // The core derives a plugin's readiness from its components; the demo
    // only flips the switches a person pressed.
    case "pluginToggled":
      return {
        ...state,
        plugins: state.plugins.map((plugin) =>
          plugin.id === action.id
            ? {
                ...plugin,
                enabled: action.enabled,
                status: action.enabled ? "partial" : "off",
              }
            : plugin,
        ),
      };
    case "componentToggled":
      return {
        ...state,
        plugins: state.plugins.map((plugin) => ({
          ...plugin,
          components: plugin.components.map((component) =>
            component.id === action.id
              ? {
                  ...component,
                  enabled: action.enabled,
                  status: action.enabled ? "ready" : "off",
                }
              : component,
          ),
        })),
      };
    case "pluginImported":
      return state.plugins.some((plugin) => plugin.id === demoImportedPlugin.id)
        ? state
        : { ...state, plugins: [...state.plugins, demoImportedPlugin] };
    // The core falls back to an open browser when the document closes, or to
    // the conversation; the demo answers the same way.
    case "documentClosed": {
      const closed = windowReducer(state, {
        type: "documentChanged",
        taskId: action.taskId,
        document: closedDocument,
      });
      const browserOpen =
        action.taskId === state.selectedTaskId &&
        selectedBeside(state).browser.status !== "closed";
      return windowReducer(closed, {
        type: "workspaceViewChanged",
        taskId: action.taskId,
        view: browserOpen ? "browser" : "conversation",
      });
    }
    default:
      return windowReducer(state, action);
  }
}
