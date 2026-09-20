import type { SessionContext, WorkStep } from "../conversation/index.js";
import type {
  BrowserPanelState,
  ProviderSettings as CoreProviderSettings,
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

export type WorkspaceSurface =
  "thread" | "library" | "usage" | "evidence" | "settings";

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
};

export type TaskOutcome = {
  title: string;
  summary: string;
  file?: string;
};

export type TaskAction = CoreTaskAction;
export type TaskArtifact = CoreTaskArtifact;
export type TaskPlanItem = CoreTaskPlanItem;
export type TaskView = CoreTaskView;
export type TaskInteraction = CoreTaskInteraction;
export type SpecialistRun = CoreSpecialistRun;

export type TaskPhase =
  | { kind: "draft" }
  | { kind: "loading" }
  | { kind: "working"; steps: WorkStep[]; note?: string }
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
  | { kind: "failed"; reason: string }
  | { kind: "interrupted"; reason?: string };

export type TaskMessage = {
  reasoning?: import("@zhiyin/contract").ReasoningTrace;
  id: string;
  role: "user" | "assistant";
  text: string;
  interactionId?: string;
  sequence?: number;
};

export type WorkspaceTask = {
  reasoning?: import("@zhiyin/contract").ReasoningSelection;
  id: string;
  title: string;
  /** The folder this conversation was last worked in. */
  workspace?: CoreWorkspaceSnapshot["workspace"];
  updatedAt?: string;
  updatedLabel: string;
  messages: TaskMessage[];
  actions?: TaskAction[];
  plan?: TaskPlanItem[];
  artifacts?: TaskArtifact[];
  specialistRuns?: SpecialistRun[];
  views?: TaskView[];
  interactions?: TaskInteraction[];
  phase: TaskPhase;
  context?: SessionContext;
};

export type UsageState = CoreUsageState;

export type WorkspaceState = {
  /** Present only while saved conversations could not be opened. */
  historyRecovery?: CoreWorkspaceSnapshot["historyRecovery"];
  preferences?: CoreWorkspaceSnapshot["preferences"];
  workspace?: CoreWorkspaceSnapshot["workspace"];
  recentWorkspaces: NonNullable<CoreWorkspaceSnapshot["recentWorkspaces"]>;
  issues?: readonly string[];
  /**
   * The last command failure on screen, whether the command came from the
   * window or from the application menu. Empty once it is dismissed.
   */
  commandError?: string;
  connection: "loading" | "ready" | "offline";
  runtime: {
    tasks: "available" | "unavailable";
    capabilities: "available" | "unavailable";
  };
  surface: WorkspaceSurface;
  browser: BrowserPanelState;
  browsers: Record<string, BrowserPanelState>;
  tasks: WorkspaceTask[];
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
  | { type: "newTaskStarted" }
  | {
      type: "taskRemoved";
      taskId: string;
      selectedTaskId: string | null;
    };

export function createWorkspaceState(
  input: WorkspaceStateInput = {},
): WorkspaceState {
  return {
    ...(input.preferences ? { preferences: input.preferences } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
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
    tasks: input.tasks ?? [],
    selectedTaskId: input.selectedTaskId ?? null,
    mcpServers: input.mcpServers ?? [],
    plugins: input.plugins ?? [],
    pluginDirectory: input.pluginDirectory ?? "loading",
    usage: input.usage ?? {
      status: "unavailable",
      reason: "Usage will appear after the first model request.",
    },
    provider: input.provider ?? {
      model: "z-ai/glm-5.3-flash",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      credential: { status: "missing", source: "none" },
    },
  };
}

function taskFromCore(task: CoreWorkspaceTask): WorkspaceTask {
  const context: SessionContext | undefined = task.context
    ? task.context.kind === "workspace"
      ? {
          kind: "workspace",
          project: task.context.project,
          files: task.context.files.map((file) => ({ ...file })),
          changes: task.context.changes,
        }
      : {
          kind: "browser",
          title: task.context.title,
          url: task.context.url,
        }
    : undefined;
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
    ...(task.workspace ? { workspace: { ...task.workspace } } : {}),
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    updatedLabel: task.updatedLabel,
    messages: task.messages.map((message) => ({ ...message })),
    actions: (task.actions ?? []).map((action) => ({ ...action })),
    plan: (task.plan ?? []).map((item) => ({ ...item })),
    artifacts: (task.artifacts ?? []).map((item) => ({ ...item })),
    specialistRuns: (task.specialistRuns ?? []).map((run) => ({ ...run })),
    views: (task.views ?? []).map((item) => ({ ...item })),
    interactions: (task.interactions ?? []).map((item) => ({
      ...item,
      request: { ...item.request },
      response: { ...item.response },
    })),
    phase,
    ...(context ? { context } : {}),
  };
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
        preferences: action.snapshot.preferences,
        workspace: action.snapshot.workspace,
        recentWorkspaces: action.snapshot.recentWorkspaces ?? [],
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
        tasks: action.snapshot.tasks.map(taskFromCore),
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
    case "newTaskStarted":
      return {
        ...state,
        surface: "thread",
        selectedTaskId: null,
        browser: closedBrowser,
      };
    case "taskRemoved": {
      const browsers = Object.fromEntries(
        Object.entries(state.browsers).filter(
          ([taskId]) => taskId !== action.taskId,
        ),
      );
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.taskId),
        selectedTaskId: action.selectedTaskId,
        surface: "thread",
        browser: action.selectedTaskId
          ? (browsers[action.selectedTaskId] ?? closedBrowser)
          : closedBrowser,
        browsers,
      };
    }
  }
}
