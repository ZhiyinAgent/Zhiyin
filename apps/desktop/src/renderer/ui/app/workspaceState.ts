import type { WorkStep } from "../conversation/index.js";
import type {
  BrowserPanelState,
  ConversationSummary,
  DocumentPanelState,
  WorkspaceView,
  ProviderSettings as CoreProviderSettings,
  RunningCommand,
  McpServerState as CoreMcpServerState,
  PluginState as CorePluginState,
  FileChange as CoreFileChange,
  TaskArtifact as CoreTaskArtifact,
  TaskAction as CoreTaskAction,
  TaskPlanItem as CoreTaskPlanItem,
  TaskView as CoreTaskView,
  TaskInteraction as CoreTaskInteraction,
  SpecialistRun as CoreSpecialistRun,
  UsageState as CoreUsageState,
  WorkspaceSnapshot as CoreWorkspaceSnapshot,
  WorkspaceTask as CoreWorkspaceTask,
} from "@zhiyin/contract";

const closedBrowser: BrowserPanelState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

const closedDocument: DocumentPanelState = { status: "closed", documents: [] };

type WorkspaceSurface =
  "thread" | "library" | "usage" | "settings" | "instructions" | "preferences";

export type ApprovalRequest = {
  effect?: string;
  detail?: string;
  claim?: string;
  destination?: string;
  id: string;
  action: string;
  target: string;
  reason: string;
  command: string;
  /** What is being called and with what, laid out rather than rendered. */
  invocation?: import("@zhiyin/contract").ToolInvocation;
  /** Before and after for every file the action would change, when known. */
  changes?: readonly CoreFileChange[];
  recovery?: import("@zhiyin/contract").ApprovalRequest["recovery"];
  conversationRule?: import("@zhiyin/contract").ApprovalRequest["conversationRule"];
};

type TaskOutcome = {
  title: string;
  summary: string;
};

export type TaskAction = CoreTaskAction;
type TaskArtifact = CoreTaskArtifact;
type TaskPlanItem = CoreTaskPlanItem;
export type TaskView = CoreTaskView;
export type TaskInteraction = CoreTaskInteraction;
export type SpecialistRun = CoreSpecialistRun;

type TaskPhase =
  | { kind: "draft" }
  | { kind: "loading" }
  | {
      kind: "working";
      steps: WorkStep[];
      note?: string;
      retry?: { readyAt: string; count?: string };
    }
  | { kind: "approval"; steps: WorkStep[]; prompt: ApprovalRequest }
  | {
      kind: "input";
      steps: WorkStep[];
      prompt: import("@zhiyin/contract").PendingUserInputRequest;
    }
  | { kind: "browser"; steps: WorkStep[]; note?: string }
  | {
      kind: "completed";
      outcome: TaskOutcome;
      /** Specialist runs still going in the background when this turn ended. */
      backgroundSpecialistIds?: readonly string[];
    }
  | {
      kind: "failed";
      reason: string;
      remedies?: readonly import("@zhiyin/contract").TurnRemedy[];
    }
  | { kind: "interrupted"; reason?: string };

type TaskMessage = {
  reasoning?: import("@zhiyin/contract").ReasoningTrace;
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly import("@zhiyin/contract").MessageAttachment[];
  interactionId?: string;
  sequence: number;
};

export type WorkspaceTask = {
  reasoning?: import("@zhiyin/contract").ReasoningSelection;
  /** Absent follows the app's default. */
  contextBudget?: CoreWorkspaceTask["contextBudget"];
  /** The size of the last request the loop sent. */
  contextUsage?: CoreWorkspaceTask["contextUsage"];
  condensings: CoreWorkspaceTask["condensings"];
  /** The standing instructions its last turn sent, by source. */
  standingInstructions: CoreWorkspaceTask["standingInstructions"];
  /** The last message the model now knows only from a summary. */
  condensedThrough?: string;
  id: string;
  title: string;
  /** The folder this conversation was last worked in. */
  workspace?: CoreWorkspaceSnapshot["workspace"];
  updatedAt: string;
  updatedLabel: string;
  messages: TaskMessage[];
  guidance: CoreWorkspaceTask["guidance"];
  actions: readonly TaskAction[];
  conversationPermissions: CoreWorkspaceTask["conversationPermissions"];
  plan: readonly TaskPlanItem[];
  artifacts: readonly TaskArtifact[];
  specialistRuns: readonly SpecialistRun[];
  views: readonly TaskView[];
  interactions: readonly TaskInteraction[];
  undos: CoreWorkspaceTask["undos"];
  phase: TaskPhase;
};

export type UsageState = CoreUsageState;

export type WorkspaceState = {
  /** Present only while saved conversations could not be opened. */
  historyRecovery?: CoreWorkspaceSnapshot["historyRecovery"];
  /** Present only while the history was saved by a newer version. */
  newerHistory?: CoreWorkspaceSnapshot["newerHistory"];
  /** Conversations whose earlier part is being summarised now. */
  compacting: readonly string[];
  preferences?: CoreWorkspaceSnapshot["preferences"];
  /** The budget a conversation without its own choice follows. */
  contextBudget?: CoreWorkspaceSnapshot["contextBudget"];
  /** What the person asks of every conversation, set in Settings. */
  personalInstructions?: CoreWorkspaceSnapshot["personalInstructions"];
  /** Set when the person turned notifications off. */
  notifications?: CoreWorkspaceSnapshot["notifications"];
  /** Set when the person chose light or dark over Windows' setting. */
  appearance?: CoreWorkspaceSnapshot["appearance"];
  /** Whether spelling is checked, in which languages, and how each loaded. */
  spelling?: CoreWorkspaceSnapshot["spelling"];
  workspace?: CoreWorkspaceSnapshot["workspace"];
  recentWorkspaces: CoreWorkspaceSnapshot["recentWorkspaces"];
  issues?: CoreWorkspaceSnapshot["issues"];
  /** The last command failure on screen. Empty once it is dismissed. */
  commandError?: string;
  connection: "loading" | "ready" | "offline";
  runtime: {
    tasks: "available" | "unavailable";
    capabilities: "available" | "unavailable";
  };
  surface: WorkspaceSurface;
  browser: BrowserPanelState;
  browsers: Record<string, BrowserPanelState>;
  /** Each conversation's document, as the core last said. */
  documents: Record<string, DocumentPanelState>;
  /** What each conversation's workspace shows, as the core last said. */
  workspaceViews: Record<string, WorkspaceView>;
  /** Each conversation's commands running as jobs, as the core last said. */
  runningCommands: Record<string, readonly RunningCommand[]>;
  /** The conversations opened so far. */
  tasks: WorkspaceTask[];
  /**
   * Every conversation as the core last listed it. Read through
   * `listedConversations`, which shows opened ones as they are now.
   */
  conversations: readonly ConversationSummary[];
  selectedTaskId: string | null;
  mcpServers: CoreMcpServerState[];
  plugins: CorePluginState[];
  pluginDirectory: "loading" | "ready";
  usage: UsageState;
  provider: CoreProviderSettings;
};

type WorkspaceStateInput = Partial<WorkspaceState>;

export type WorkspaceAction =
  | { type: "connected" }
  | { type: "connectionLost" }
  | { type: "workspaceHydrated"; snapshot: CoreWorkspaceSnapshot }
  | { type: "taskReplaced"; task: CoreWorkspaceTask }
  | { type: "selectionReceived"; taskId: string | null }
  | { type: "usageReceived"; usage: CoreUsageState }
  | { type: "mcpServersReceived"; servers: readonly CoreMcpServerState[] }
  | { type: "pluginsReceived"; plugins: readonly CorePluginState[] }
  | { type: "providerReceived"; provider: CoreProviderSettings }
  | { type: "surfaceOpened"; surface: WorkspaceSurface }
  | { type: "commandErrorShown"; message: string }
  | {
      type: "browserChanged";
      taskId: string;
      browser: BrowserPanelState;
    }
  | {
      type: "documentChanged";
      taskId: string;
      document: DocumentPanelState;
    }
  | { type: "workspaceViewChanged"; taskId: string; view: WorkspaceView }
  | {
      type: "commandsChanged";
      taskId: string;
      commands: readonly RunningCommand[];
    }
  | { type: "newTaskStarted" }
  | {
      type: "taskRemoved";
      taskId: string;
      selectedTaskId: string | null;
    };

/** The document beside the selected conversation; closed when it has none. */
export function selectedDocument(
  state: Pick<WorkspaceState, "documents" | "selectedTaskId">,
): DocumentPanelState {
  return state.selectedTaskId
    ? (state.documents[state.selectedTaskId] ?? closedDocument)
    : closedDocument;
}

/**
 * What the space beside the selected conversation shows. The core decides
 * (ADR 0018); the window only draws it and passes on the person's choice.
 */
export function selectedWorkspaceView(
  state: Pick<WorkspaceState, "workspaceViews" | "selectedTaskId">,
): WorkspaceView {
  return state.selectedTaskId
    ? (state.workspaceViews[state.selectedTaskId] ?? "conversation")
    : "conversation";
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([item]) => item !== key),
  );
}

/**
 * The list the sidebar shows: every conversation the core listed, an opened
 * one as it is now, and one opened since the last list — a new conversation —
 * first; then the one changed last first. Undated conversations and ties keep
 * the order the core gave.
 */
export function listedConversations(
  state: Pick<WorkspaceState, "tasks" | "conversations">,
): {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly updatedLabel: string;
  readonly needsUpdate?: { readonly writtenBy: string };
}[] {
  const listed = new Set(state.conversations.map((item) => item.id));
  const opened = new Map(state.tasks.map((task) => [task.id, task]));
  return [
    ...state.tasks.filter((task) => !listed.has(task.id)),
    ...state.conversations.map((item) => opened.get(item.id) ?? item),
  ]
    .sort((a, b) =>
      a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1,
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      updatedLabel: item.updatedLabel,
      ...("needsUpdate" in item && item.needsUpdate
        ? { needsUpdate: item.needsUpdate }
        : {}),
    }));
}

export function createWorkspaceState(
  input: WorkspaceStateInput = {},
): WorkspaceState {
  return {
    ...(input.newerHistory ? { newerHistory: input.newerHistory } : {}),
    compacting: input.compacting ?? [],
    ...(input.preferences ? { preferences: input.preferences } : {}),
    ...(input.contextBudget ? { contextBudget: input.contextBudget } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.spelling ? { spelling: input.spelling } : {}),
    recentWorkspaces: input.recentWorkspaces ?? [],
    ...(input.issues ? { issues: input.issues } : {}),
    connection: input.connection ?? "loading",
    runtime: input.runtime ?? {
      tasks: "unavailable",
      capabilities: "unavailable",
    },
    surface: input.surface ?? "thread",
    browser: input.browser ?? closedBrowser,
    browsers: input.browsers ?? {},
    documents: input.documents ?? {},
    workspaceViews: input.workspaceViews ?? {},
    runningCommands: input.runningCommands ?? {},
    tasks: input.tasks ?? [],
    conversations: input.conversations ?? [],
    selectedTaskId: input.selectedTaskId ?? null,
    mcpServers: input.mcpServers ?? [],
    plugins: input.plugins ?? [],
    pluginDirectory: input.pluginDirectory ?? "loading",
    usage: input.usage ?? {
      status: "unavailable",
      reason: "Usage will appear after the first model request.",
    },
    provider: input.provider ?? {
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential: { status: "missing", source: "none" },
    },
  };
}

/**
 * Each part of a conversation the core sent, converted once. The core sends
 * what changed and keeps the rest as it was, so an unchanged message, action
 * or view stays the same object here too, and is not drawn again.
 */
const converted = new WeakMap<object, object>();

function once<From extends object, To extends object>(
  item: From,
  convert: (item: From) => To,
): To {
  const known = converted.get(item);
  if (known) return known as To;
  const made = convert(item);
  converted.set(item, made);
  return made;
}

function taskFromCore(task: CoreWorkspaceTask): WorkspaceTask {
  return once(task, convertTask);
}

function convertTask(task: CoreWorkspaceTask): WorkspaceTask {
  const phase =
    task.phase.kind === "working" || task.phase.kind === "browser"
      ? { ...task.phase, steps: task.phase.steps.map((step) => ({ ...step })) }
      : task.phase.kind === "approval"
        ? {
            ...task.phase,
            steps: task.phase.steps.map((step) => ({ ...step })),
            prompt: { ...task.phase.prompt },
          }
        : task.phase.kind === "input"
          ? {
              ...task.phase,
              steps: task.phase.steps.map((step) => ({ ...step })),
              prompt: { ...task.phase.prompt },
            }
          : task.phase.kind === "completed"
            ? {
                ...task.phase,
                outcome: { ...task.phase.outcome },
                ...(task.phase.backgroundSpecialistIds
                  ? {
                      backgroundSpecialistIds: [
                        ...task.phase.backgroundSpecialistIds,
                      ],
                    }
                  : {}),
              }
            : { ...task.phase };

  return {
    id: task.id,
    title: task.title,
    ...(task.reasoning ? { reasoning: { ...task.reasoning } } : {}),
    ...(task.contextBudget ? { contextBudget: task.contextBudget } : {}),
    ...(task.contextUsage ? { contextUsage: task.contextUsage } : {}),
    condensings: task.condensings,
    standingInstructions: task.standingInstructions,
    ...(task.compaction
      ? { condensedThrough: task.compaction.throughMessageId }
      : {}),
    ...(task.workspace ? { workspace: { ...task.workspace } } : {}),
    updatedAt: task.updatedAt,
    updatedLabel: task.updatedLabel,
    messages: task.messages.map((message) => once(message, copied)),
    guidance: task.guidance.map((item) => once(item, copied)),
    actions: task.actions.map((action) => once(action, copied)),
    conversationPermissions: task.conversationPermissions,
    plan: task.plan.map((item) => once(item, copied)),
    artifacts: task.artifacts.map((item) => once(item, copied)),
    specialistRuns: task.specialistRuns.map((run) => once(run, copied)),
    views: task.views.map((item) => once(item, copied)),
    interactions: task.interactions.map((item) =>
      once(item, (interaction) => ({
        ...interaction,
        request: { ...interaction.request },
        response: { ...interaction.response },
      })),
    ),
    undos: task.undos,
    phase,
  };
}

function copied<T extends object>(item: T): T {
  return { ...item };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "connected":
      return { ...state, connection: "ready" };
    case "connectionLost":
      return { ...state, connection: "offline" };
    case "workspaceHydrated":
      return {
        ...state,
        historyRecovery: action.snapshot.historyRecovery,
        newerHistory: action.snapshot.newerHistory,
        compacting: action.snapshot.compacting ?? [],
        preferences: action.snapshot.preferences,
        contextBudget: action.snapshot.contextBudget,
        personalInstructions: action.snapshot.personalInstructions,
        notifications: action.snapshot.notifications,
        appearance: action.snapshot.appearance,
        spelling: action.snapshot.spelling,
        workspace: action.snapshot.workspace,
        recentWorkspaces: action.snapshot.recentWorkspaces,
        issues: action.snapshot.issues ?? [],
        connection: "ready",
        runtime: { ...action.snapshot.runtime },
        browser: action.snapshot.browser ?? closedBrowser,
        browsers: action.snapshot.selectedTaskId
          ? {
              ...state.browsers,
              [action.snapshot.selectedTaskId]:
                action.snapshot.browser ?? closedBrowser,
            }
          : state.browsers,
        documents: action.snapshot.selectedTaskId
          ? {
              ...state.documents,
              [action.snapshot.selectedTaskId]:
                action.snapshot.document ?? closedDocument,
            }
          : state.documents,
        workspaceViews: action.snapshot.selectedTaskId
          ? {
              ...state.workspaceViews,
              [action.snapshot.selectedTaskId]:
                action.snapshot.workspaceView ?? "conversation",
            }
          : state.workspaceViews,
        tasks: action.snapshot.tasks.map(taskFromCore),
        conversations: action.snapshot.conversations ?? action.snapshot.tasks,
        selectedTaskId: action.snapshot.selectedTaskId,
        mcpServers: action.snapshot.mcpServers.map((item) => ({ ...item })),
        plugins: action.snapshot.plugins.map((item) => ({
          ...item,
          components: item.components.map((component) => ({ ...component })),
        })),
        pluginDirectory: "ready",
        usage: { ...action.snapshot.usage },
      };
    case "taskReplaced": {
      const task = taskFromCore(action.task);
      const exists = state.tasks.some((item) => item.id === task.id);
      return {
        ...state,
        tasks: exists
          ? state.tasks.map((item) => (item.id === task.id ? task : item))
          : [task, ...state.tasks],
      };
    }
    case "selectionReceived":
      return {
        ...state,
        selectedTaskId: action.taskId,
        surface: "thread",
        browser: action.taskId
          ? (state.browsers[action.taskId] ?? closedBrowser)
          : closedBrowser,
      };
    case "usageReceived":
      return { ...state, usage: action.usage };
    case "mcpServersReceived":
      return {
        ...state,
        mcpServers: action.servers.map((item) => ({ ...item })),
      };
    case "pluginsReceived":
      return {
        ...state,
        plugins: action.plugins.map((item) => ({
          ...item,
          components: item.components.map((component) => ({ ...component })),
        })),
        pluginDirectory: "ready",
      };
    case "providerReceived":
      return { ...state, provider: action.provider };
    case "surfaceOpened":
      return { ...state, surface: action.surface };
    case "commandErrorShown":
      return { ...state, commandError: action.message };
    case "browserChanged":
      return {
        ...state,
        browsers: { ...state.browsers, [action.taskId]: action.browser },
        browser:
          action.taskId === state.selectedTaskId
            ? action.browser
            : state.browser,
      };
    case "documentChanged":
      return {
        ...state,
        documents: { ...state.documents, [action.taskId]: action.document },
      };
    case "workspaceViewChanged":
      return {
        ...state,
        workspaceViews: {
          ...state.workspaceViews,
          [action.taskId]: action.view,
        },
      };
    case "commandsChanged":
      return {
        ...state,
        runningCommands: {
          ...state.runningCommands,
          [action.taskId]: action.commands,
        },
      };
    case "newTaskStarted":
      return {
        ...state,
        surface: "thread",
        selectedTaskId: null,
        browser: closedBrowser,
      };
    case "taskRemoved": {
      const browsers = without(state.browsers, action.taskId);
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.taskId),
        conversations: state.conversations.filter(
          (item) => item.id !== action.taskId,
        ),
        ...(state.issues
          ? {
              issues: state.issues.filter(
                (issue) => issue.conversationId !== action.taskId,
              ),
            }
          : {}),
        selectedTaskId: action.selectedTaskId,
        surface: "thread",
        browser: action.selectedTaskId
          ? (browsers[action.selectedTaskId] ?? closedBrowser)
          : closedBrowser,
        browsers,
        documents: without(state.documents, action.taskId),
        workspaceViews: without(state.workspaceViews, action.taskId),
      };
    }
  }
}
