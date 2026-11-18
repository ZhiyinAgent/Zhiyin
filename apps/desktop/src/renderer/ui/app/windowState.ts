import type {
  AppUpdateState,
  ApprovalRequest as CoreApprovalRequest,
  ConversationSummary,
  LookChoice,
  ProviderSettings as CoreProviderSettings,
  McpServerState as CoreMcpServerState,
  MemoryState,
  PluginState as CorePluginState,
  TaskAction as CoreTaskAction,
  TaskView as CoreTaskView,
  TaskInteraction as CoreTaskInteraction,
  SpecialistRun as CoreSpecialistRun,
  UsageState as CoreUsageState,
  WorkspaceSnapshot as CoreWorkspaceSnapshot,
  WorkspaceTask as CoreWorkspaceTask,
} from "@zhiyin/contract";
import { defaultLook } from "@zhiyin/contract";
import {
  besideAfter,
  besideHydrated,
  nothingBeside,
  besideWithout,
  type Beside,
  type BesideAction,
  type BesideConversations,
} from "./besideState.js";
import { taskFromCore, type WorkspaceTask } from "./conversationState.js";

export { besideOf, selectedBeside } from "./besideState.js";
export {
  listedConversations,
  type WorkspaceTask,
} from "./conversationState.js";

type WindowPage =
  | "thread"
  | "library"
  | "usage"
  | "model"
  | "memory"
  | "settings"
  | "reviewerModel";

/**
 * A page and where it opens, when what opened it pointed into it: the Memory
 * page at one entry, or settings at the provider's key.
 */
type SurfaceOpening =
  | { surface: "memory"; at?: number }
  | { surface: "model"; at?: "apiKey" }
  | { surface: Exclude<WindowPage, "memory" | "model"> };

export type ApprovalRequest = CoreApprovalRequest;
export type TaskAction = CoreTaskAction;
export type TaskView = CoreTaskView;
export type TaskInteraction = CoreTaskInteraction;
export type SpecialistRun = CoreSpecialistRun;

export type UsageState = CoreUsageState;

export type WindowState = {
  /** Present only while saved conversations could not be opened. */
  historyRecovery?: CoreWorkspaceSnapshot["historyRecovery"];
  /** Present only while the history was saved by a newer version. */
  newerHistory?: CoreWorkspaceSnapshot["newerHistory"];
  /** Conversations whose earlier part is being summarised now, and since when. */
  compacting: NonNullable<CoreWorkspaceSnapshot["compacting"]>;
  preferences?: CoreWorkspaceSnapshot["preferences"];
  /** The budget a conversation without its own choice follows. */
  contextBudget?: CoreWorkspaceSnapshot["contextBudget"];
  /** Set when the person turned notifications off. */
  notifications?: CoreWorkspaceSnapshot["notifications"];
  /** Set when the person turned off reviewing studio work. */
  studioReviews?: CoreWorkspaceSnapshot["studioReviews"];
  /** Set when the person chose a model other than the conversation's for reviews. */
  reviewerModel?: CoreWorkspaceSnapshot["reviewerModel"];
  /** Set once the person changed when long tasks stop to ask. */
  workPauses?: CoreWorkspaceSnapshot["workPauses"];
  /** Set when the person chose light or dark over Windows' setting. */
  appearance?: CoreWorkspaceSnapshot["appearance"];
  /** The look the core saved; unknown until its first snapshot. */
  look?: LookChoice;
  /** Whether spelling is checked, in which languages, and how each loaded. */
  spelling?: CoreWorkspaceSnapshot["spelling"];
  workspace?: CoreWorkspaceSnapshot["workspace"];
  recentWorkspaces: CoreWorkspaceSnapshot["recentWorkspaces"];
  issues?: CoreWorkspaceSnapshot["issues"];
  /** The last command failure on screen. Empty once it is dismissed. */
  commandError?: string;
  connection: "loading" | "ready";
  runtime: {
    tasks: "available" | "unavailable";
    capabilities: "available" | "unavailable";
  };
  surface: WindowPage;
  /**
   * Where the open page opens, when what opened it pointed into it: an entry
   * of the Memory page, or the provider's key in settings.
   */
  surfaceAt?: number | "apiKey" | undefined;
  /** What is beside each conversation, as the core last said. */
  beside: BesideConversations;
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
  /**
   * What Zhiyin remembers, as the core last said: absent until it answers,
   * and where memory is not kept.
   */
  memory?: MemoryState | undefined;
  /** Why memory could not be read. */
  memoryFailure?: string | undefined;
  provider: CoreProviderSettings;
  /**
   * Where Zhiyin stands on updating itself, as the core last said: absent
   * until it answers, and where this copy does not update itself.
   */
  appUpdate?: AppUpdateState | undefined;
};

type WindowStateInput = Partial<Omit<WindowState, "beside">> & {
  /** What is beside each conversation; what is left out is closed. */
  beside?: Readonly<Record<string, Partial<Beside>>>;
};

export type WindowAction =
  | { type: "connected" }
  | { type: "windowHydrated"; snapshot: CoreWorkspaceSnapshot }
  | { type: "taskReplaced"; task: CoreWorkspaceTask }
  | { type: "selectionReceived"; taskId: string | null }
  | { type: "usageReceived"; usage: CoreUsageState }
  | { type: "memoryReceived"; memory: MemoryState | undefined }
  | { type: "appUpdateReceived"; update: AppUpdateState }
  | { type: "memoryFailed"; reason: string }
  | { type: "mcpServersReceived"; servers: readonly CoreMcpServerState[] }
  | { type: "pluginsReceived"; plugins: readonly CorePluginState[] }
  | { type: "providerReceived"; provider: CoreProviderSettings }
  | ({ type: "surfaceOpened" } & SurfaceOpening)
  | { type: "commandErrorShown"; message: string }
  | BesideAction
  | { type: "newTaskStarted" }
  | {
      type: "taskRemoved";
      taskId: string;
      selectedTaskId: string | null;
    };

export function createWindowState(input: WindowStateInput = {}): WindowState {
  return {
    ...(input.newerHistory ? { newerHistory: input.newerHistory } : {}),
    compacting: input.compacting ?? [],
    ...(input.preferences ? { preferences: input.preferences } : {}),
    ...(input.contextBudget ? { contextBudget: input.contextBudget } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.spelling ? { spelling: input.spelling } : {}),
    ...(input.memory ? { memory: input.memory } : {}),
    ...(input.appUpdate ? { appUpdate: input.appUpdate } : {}),
    recentWorkspaces: input.recentWorkspaces ?? [],
    ...(input.issues ? { issues: input.issues } : {}),
    connection: input.connection ?? "loading",
    runtime: input.runtime ?? {
      tasks: "unavailable",
      capabilities: "unavailable",
    },
    surface: input.surface ?? "thread",
    beside: Object.fromEntries(
      Object.entries(input.beside ?? {}).map(([taskId, beside]) => [
        taskId,
        { ...nothingBeside, ...beside },
      ]),
    ),
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
    // Until the core answers, the provider it falls back to with no choice.
    // What the model accepts is not known yet, so the core is asked about a
    // picture rather than the window refusing it.
    provider: input.provider ?? {
      lookupFailed: true,
      provider: {
        id: "openrouter",
        name: "OpenRouter",
        pages: {
          keys: "https://openrouter.ai/settings/keys",
          billing: "https://openrouter.ai/settings/credits",
        },
        upstreams: true,
      },
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential: { status: "missing", source: "none" },
    },
  };
}

/** What one slice of the state becomes after an action; nothing if unchanged. */
type Change<Key extends keyof WindowState> =
  Partial<Pick<WindowState, Key>> | undefined;

/** The app as a whole: its settings, health and what the core reports of it. */
function appChange(
  state: WindowState,
  action: WindowAction,
): Change<
  | "historyRecovery"
  | "newerHistory"
  | "compacting"
  | "preferences"
  | "contextBudget"
  | "notifications"
  | "studioReviews"
  | "reviewerModel"
  | "workPauses"
  | "appearance"
  | "look"
  | "spelling"
  | "workspace"
  | "recentWorkspaces"
  | "issues"
  | "commandError"
  | "connection"
  | "runtime"
  | "usage"
  | "provider"
  | "appUpdate"
> {
  switch (action.type) {
    case "connected":
      return { connection: "ready" };
    case "windowHydrated": {
      const { snapshot } = action;
      return {
        historyRecovery: snapshot.historyRecovery,
        newerHistory: snapshot.newerHistory,
        compacting: snapshot.compacting ?? [],
        preferences: snapshot.preferences,
        contextBudget: snapshot.contextBudget,
        notifications: snapshot.notifications,
        studioReviews: snapshot.studioReviews,
        reviewerModel: snapshot.reviewerModel,
        workPauses: snapshot.workPauses,
        appearance: snapshot.appearance,
        look: snapshot.look ?? defaultLook,
        spelling: snapshot.spelling,
        workspace: snapshot.workspace,
        recentWorkspaces: snapshot.recentWorkspaces,
        issues: snapshot.issues ?? [],
        connection: "ready",
        runtime: { ...snapshot.runtime },
        usage: { ...snapshot.usage },
      };
    }
    case "usageReceived":
      return { usage: action.usage };
    case "appUpdateReceived":
      return { appUpdate: action.update };
    case "providerReceived":
      return { provider: action.provider };
    case "commandErrorShown":
      // Every command clears the error first; most often none is shown.
      return (state.commandError ?? "") === action.message
        ? undefined
        : { commandError: action.message };
    case "taskRemoved":
      return state.issues
        ? {
            issues: state.issues.filter(
              (issue) => issue.conversationId !== action.taskId,
            ),
          }
        : undefined;
    default:
      return undefined;
  }
}

/** The conversations: those opened, those listed, and which is selected. */
function conversationsChange(
  state: WindowState,
  action: WindowAction,
): Change<"tasks" | "conversations" | "selectedTaskId"> {
  switch (action.type) {
    case "windowHydrated":
      return {
        tasks: action.snapshot.tasks.map(taskFromCore),
        conversations: action.snapshot.conversations ?? action.snapshot.tasks,
        selectedTaskId: action.snapshot.selectedTaskId,
      };
    case "taskReplaced": {
      const task = taskFromCore(action.task);
      const exists = state.tasks.some((item) => item.id === task.id);
      return {
        tasks: exists
          ? state.tasks.map((item) => (item.id === task.id ? task : item))
          : [task, ...state.tasks],
      };
    }
    case "selectionReceived":
      return { selectedTaskId: action.taskId };
    case "newTaskStarted":
      return { selectedTaskId: null };
    case "taskRemoved":
      return {
        tasks: state.tasks.filter((task) => task.id !== action.taskId),
        conversations: state.conversations.filter(
          (item) => item.id !== action.taskId,
        ),
        selectedTaskId: action.selectedTaskId,
      };
    default:
      return undefined;
  }
}

/** Which page is open, and where in it. */
function pageChange(
  _state: WindowState,
  action: WindowAction,
): Change<"surface" | "surfaceAt"> {
  switch (action.type) {
    case "surfaceOpened":
      return {
        surface: action.surface,
        surfaceAt: "at" in action ? action.at : undefined,
      };
    case "selectionReceived":
    case "newTaskStarted":
    case "taskRemoved":
      return { surface: "thread" };
    default:
      return undefined;
  }
}

/** What is beside each conversation. */
function besideChange(
  state: WindowState,
  action: WindowAction,
): Change<"beside"> {
  switch (action.type) {
    case "windowHydrated":
      return { beside: besideHydrated(state.beside, action.snapshot) };
    case "taskRemoved":
      return { beside: besideWithout(state.beside, action.taskId) };
    case "browserChanged":
    case "documentChanged":
    case "sceneChanged":
    case "partsChanged":
    case "workspaceViewChanged":
    case "commandsChanged":
      return { beside: besideAfter(state.beside, action) };
    default:
      return undefined;
  }
}

/** The plugins and connections, and Zhiyin's memory. */
function capabilitiesChange(
  _state: WindowState,
  action: WindowAction,
): Change<
  "mcpServers" | "plugins" | "pluginDirectory" | "memory" | "memoryFailure"
> {
  switch (action.type) {
    case "windowHydrated":
      return {
        mcpServers: action.snapshot.mcpServers.map((item) => ({ ...item })),
        plugins: pluginsFromCore(action.snapshot.plugins),
        pluginDirectory: "ready",
      };
    case "mcpServersReceived":
      return { mcpServers: action.servers.map((item) => ({ ...item })) };
    case "pluginsReceived":
      return {
        plugins: pluginsFromCore(action.plugins),
        pluginDirectory: "ready",
      };
    case "memoryReceived":
      return { memory: action.memory, memoryFailure: undefined };
    case "memoryFailed":
      return { memoryFailure: action.reason };
    default:
      return undefined;
  }
}

function pluginsFromCore(
  plugins: readonly CorePluginState[],
): CorePluginState[] {
  return plugins.map((item) => ({
    ...item,
    components: item.components.map((component) => ({ ...component })),
  }));
}

const slices = [
  appChange,
  conversationsChange,
  pageChange,
  besideChange,
  capabilitiesChange,
];

/**
 * The state after one action. Each slice says what it changes; one that
 * nothing changes leaves the state as it was.
 */
export function windowReducer(
  state: WindowState,
  action: WindowAction,
): WindowState {
  let next = state;
  for (const slice of slices) {
    const change = slice(state, action);
    if (change) next = { ...next, ...change };
  }
  return next;
}
