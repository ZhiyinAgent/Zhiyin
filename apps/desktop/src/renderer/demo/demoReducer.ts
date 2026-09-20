/**
 * The demo's own store.
 *
 * The window's state is event-derived (ADR 0006): every change comes from the
 * core. A demo has no core, so it makes the changes itself — and that
 * simulation lives here, beside the demo, rather than in the reducer the real
 * window uses. Everything the real core would send is left to the reducer this
 * one delegates to.
 */

import {
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceTask,
} from "../ui/app/index.js";

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
  | WorkspaceAction
  | { type: "taskCreated"; id: string }
  | { type: "taskSelected"; id: string }
  | { type: "taskRenamed"; taskId: string; title: string }
  | { type: "taskDeleted"; taskId: string }
  | { type: "messageSubmitted"; taskId: string; message: string }
  | { type: "approvalRequested"; taskId: string; prompt: ApprovalRequest }
  | { type: "approvalResolved"; taskId: string; allowed: boolean }
  | { type: "taskCompleted"; taskId: string; outcome: TaskOutcome }
  | { type: "taskFailed"; taskId: string; reason: string }
  | { type: "taskInterrupted"; taskId: string }
  | { type: "pluginToggled"; id: string; enabled: boolean }
  | { type: "componentToggled"; id: string; enabled: boolean };

const closedBrowser = {
  status: "closed" as const,
  url: "",
  title: "",
  loading: false,
};

function updateTask(
  state: WorkspaceState,
  id: string,
  update: (task: WorkspaceTask) => WorkspaceTask,
): WorkspaceTask[] {
  return state.tasks.map((task) => (task.id === id ? update(task) : task));
}

export function demoReducer(
  state: WorkspaceState,
  action: DemoAction,
): WorkspaceState {
  switch (action.type) {
    case "taskCreated": {
      const task: WorkspaceTask = {
        id: action.id,
        title: "New task",
        updatedLabel: "Now",
        messages: [],
        actions: [],
        phase: { kind: "draft" },
      };
      return {
        ...state,
        surface: "thread",
        selectedTaskId: action.id,
        browser: state.browsers[action.id] ?? closedBrowser,
        tasks: [task, ...state.tasks],
      };
    }
    case "taskSelected":
      return {
        ...state,
        surface: "thread",
        selectedTaskId: action.id,
        browser: state.browsers[action.id] ?? closedBrowser,
      };
    case "taskRenamed": {
      const title = action.title.trim();
      if (!title) return state;
      return {
        ...state,
        tasks: updateTask(state, action.taskId, (task) => ({ ...task, title })),
      };
    }
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
            task.title === "New task"
              ? message.length > 42
                ? `${message.slice(0, 39)}…`
                : message
              : task.title,
          updatedLabel: "Now",
          messages: [
            ...task.messages,
            {
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
            steps:
              task.phase.kind === "working" || task.phase.kind === "browser"
                ? task.phase.steps
                : [],
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
                id: `${task.id}-action-${task.actions?.length ?? 0}`,
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
              ? [...(task.actions ?? []), actionRecord]
              : (task.actions ?? []),
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
    default:
      return workspaceReducer(state, action);
  }
}
