/**
 * What a launch finds, and the store-level steps behind recovery and profile
 * setup. The workspace keeps ownership of every field and of its one save path;
 * this module returns restored state or invokes that path at the required
 * boundaries.
 */

import type { Capabilities } from "@zhiyin/capabilities";
import type {
  ConversationSummary,
  HistoryRecovery,
  McpServerState,
  NewerHistory,
  PluginState,
  UsageState,
  WorkspaceContext,
  WorkspaceIssue,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";
import type { UsageTelemetry } from "@zhiyin/usage";

const maximumRecentWorkspaces = 5;

export const movedWorkspaceNotice =
  "The selected folder is unavailable. Choose its new location before using files.";

export async function returnToWorkspace(
  workspace: WorkspaceContext,
  selection: WorkspaceSnapshot["workspace"],
): Promise<string | undefined> {
  if (!selection || !workspace.selectWorkspace) return undefined;
  try {
    await workspace.selectWorkspace(selection.path);
    return undefined;
  } catch {
    return `The folder “${selection.name}” is no longer available. Choose a folder before using files.`;
  }
}

type FolderState = {
  readonly selection: WorkspaceSnapshot["workspace"];
  readonly recents: WorkspaceSnapshot["recentWorkspaces"];
  readonly issues: WorkspaceIssue[];
};

/**
 * Moves the app into the folder a conversation belongs to. A folder that will
 * not open is reported and nothing else: relabelling the current folder with
 * the name of one that failed to open would be a lie about where the next
 * action would run.
 */
export async function enterFolder(
  workspace: WorkspaceContext,
  task: WorkspaceTask,
  current: FolderState,
): Promise<FolderState> {
  const wanted = task.workspace;
  if (!wanted || !workspace.selectWorkspace) return current;
  const notice = `The folder for “${task.title}” could not be opened. Choose its new location before using files.`;
  try {
    await workspace.selectWorkspace(wanted.path);
  } catch {
    return {
      ...current,
      issues: current.issues.some((issue) => issue.message === notice)
        ? current.issues
        : [...current.issues, { message: notice, conversationId: task.id }],
    };
  }
  const description = await workspace.describeWorkspace();
  const selection = { path: wanted.path, name: description.rootName };
  return {
    selection,
    recents: withRecentWorkspace(current.recents, selection),
    issues: current.issues.filter(
      (issue) =>
        issue.message !== notice && issue.message !== movedWorkspaceNotice,
    ),
  };
}

export const initialUsage: UsageState = {
  status: "unavailable",
  reason: "Usage will appear after the first model request.",
};

export function withRecentWorkspace(
  existing: WorkspaceSnapshot["recentWorkspaces"],
  chosen: NonNullable<WorkspaceSnapshot["workspace"]>,
): WorkspaceSnapshot["recentWorkspaces"] {
  return [
    chosen,
    ...existing.filter((folder) => folder.path !== chosen.path),
  ].slice(0, maximumRecentWorkspaces);
}

type StartupDependencies = {
  readonly onboarding?: boolean;
  readonly sessions: Sessions;
  readonly capabilities: Capabilities;
  readonly workspace: WorkspaceContext;
  readonly usage: UsageTelemetry;
  readonly now: () => Date;
};

type CurrentStartupState = {
  readonly tasks: readonly WorkspaceTask[];
  readonly conversations: readonly ConversationSummary[];
  readonly selectedTaskId: string | null;
  readonly historyRecovery: HistoryRecovery | undefined;
};

export type StartupState = {
  /** Only what was already open: a launch reads the list, not the conversations. */
  readonly tasks: WorkspaceTask[];
  readonly conversations: readonly ConversationSummary[];
  readonly selectedTaskId: string | null;
  readonly preferences: WorkspaceSnapshot["preferences"];
  readonly contextBudget: WorkspaceSnapshot["contextBudget"];
  readonly personalInstructions: WorkspaceSnapshot["personalInstructions"];
  readonly notifications: WorkspaceSnapshot["notifications"];
  readonly appearance: WorkspaceSnapshot["appearance"];
  readonly spellingChoice: WorkspaceSnapshot["spellingChoice"];
  readonly folderInstructionChoices: WorkspaceSnapshot["folderInstructionChoices"];
  readonly workspace: WorkspaceSnapshot["workspace"];
  readonly recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"];
  readonly plugins: PluginState[];
  readonly usage: UsageState;
  readonly issues: WorkspaceIssue[];
  readonly historyAvailable: boolean;
  readonly historyRecovery: HistoryRecovery | undefined;
  /** Saved by a newer version: nothing is opened, and no fresh start offered. */
  readonly newerHistory: NewerHistory | undefined;
  readonly capabilitiesAvailable: boolean;
  readonly needsSave: boolean;
};

async function offerHistoryRecovery(
  sessions: Sessions,
): Promise<HistoryRecovery | undefined> {
  try {
    const keptAt = await sessions.preserveDamaged();
    const damage = await sessions.inspectDamage();
    return damage.kind === "partial"
      ? { readable: damage.readable, damaged: damage.damaged, keptAt }
      : { readable: 0, damaged: 0, keptAt };
  } catch {
    return undefined;
  }
}

export async function loadStartup(
  deps: StartupDependencies,
  current: CurrentStartupState,
): Promise<StartupState> {
  const issues: WorkspaceIssue[] = [];
  const say = (message: string) => issues.push({ message });
  let historyAvailable = true;
  let capabilitiesAvailable = true;
  let historyRecovery = current.historyRecovery;
  let newerHistory: NewerHistory | undefined;
  const [restored, loadedPlugins, usage] = await Promise.all([
    deps.sessions
      .loadIndex()
      .catch(async (error: unknown) => {
        historyAvailable = false;
        const { code, writtenBy } = error as {
          code?: unknown;
          writtenBy?: unknown;
        };
        // Not damage: a newer version can read it, and nothing here may
        // copy it aside or offer to start again in its place.
        if (code === "newer") {
          newerHistory = { writtenBy: String(writtenBy) };
          return undefined;
        }
        historyRecovery ??= await offerHistoryRecovery(deps.sessions);
        if (!historyRecovery)
          say(
            "Saved history could not be opened. Your files have been preserved. Retry after fixing access to the history file.",
          );
        return undefined;
      })
      .catch(() => undefined),
    deps.capabilities.pluginStates([]).catch(() => {
      capabilitiesAvailable = false;
      say(
        "Plugins could not be loaded. Workspace tools still work; plugins return once they can be read.",
      );
      return [];
    }),
    deps.usage.state(deps.now()).catch(() => ({
      status: "unavailable" as const,
      reason: "Usage history could not be opened.",
    })),
  ]);

  if (restored?.setAside)
    issues.push({
      message: `${restored.setAside.count === 1 ? "One saved conversation was" : `${restored.setAside.count} saved conversations were`} damaged beyond reading and left out of the list.`,
      keptAt: restored.setAside.keptAt,
    });
  if (restored?.newer) {
    const { count, writtenBy } = restored.newer;
    issues.push({
      message: `${count === 1 ? "One conversation was" : `${count} conversations were`} saved by a newer version of Zhiyin (${writtenBy.join(", ")}) and ${count === 1 ? "is not shown. It was left as it is." : "are not shown. They were left as they are."}`,
    });
  }
  let needsSave = false;
  const tasks = restored ? [] : [...current.tasks];
  const conversations = restored
    ? restored.conversations
    : current.conversations;
  const selectedTaskId = restored
    ? restored.selectedTaskId
    : current.selectedTaskId;
  let preferences =
    restored?.preferences ??
    (deps.onboarding ? { onboarded: false, interests: [] } : undefined);
  const workspace = restored?.workspace;
  let recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"] = [
    ...(restored?.recentWorkspaces ?? []),
  ];
  if (workspace)
    recentWorkspaces = withRecentWorkspace(recentWorkspaces, workspace);
  if (workspace && deps.workspace.selectWorkspace) {
    try {
      await deps.workspace.selectWorkspace(workspace.path);
    } catch {
      say(movedWorkspaceNotice);
    }
  }

  let plugins = [...loadedPlugins];
  if (preferences?.capabilitiesApplied === false) {
    try {
      await deps.capabilities.applyInterests(preferences.interests);
      preferences = {
        onboarded: preferences.onboarded,
        interests: preferences.interests,
      };
      plugins = [...(await deps.capabilities.pluginStates([]))];
      needsSave = true;
    } catch {
      say(
        "Your saved preferences could not be applied to the available capabilities. They will be tried again next time.",
      );
    }
  }

  return {
    tasks,
    conversations,
    selectedTaskId,
    preferences,
    contextBudget: restored?.contextBudget,
    personalInstructions: restored?.personalInstructions,
    notifications: restored?.notifications,
    appearance: restored?.appearance,
    spellingChoice: restored?.spellingChoice,
    folderInstructionChoices: restored?.folderInstructionChoices,
    workspace,
    recentWorkspaces,
    plugins,
    usage,
    issues,
    historyAvailable,
    historyRecovery,
    newerHistory,
    capabilitiesAvailable,
    needsSave,
  };
}

export async function loadConnections(
  capabilities: Capabilities,
  install: (result: {
    readonly mcpServers: McpServerState[];
    readonly plugins?: PluginState[];
    readonly issues?: readonly WorkspaceIssue[];
  }) => void,
): Promise<void> {
  const issues: WorkspaceIssue[] = [];
  const say = (message: string) => issues.push({ message });
  let mcpServers: McpServerState[] = [];
  try {
    mcpServers = [...(await capabilities.connections())];
  } catch {
    say("Connections could not be loaded. You can still work without them.");
  }
  install({
    mcpServers,
    ...(issues.length ? { issues } : {}),
  });
  try {
    const plugins = [...(await capabilities.pluginStates(mcpServers))];
    install({ mcpServers, plugins });
  } catch {
    install({
      mcpServers,
      plugins: [],
      issues: [
        {
          message:
            "Plugins could not be loaded. Workspace tools still work; plugins return once they can be read.",
        },
      ],
    });
  }
}

export async function recoverHistory(
  sessions: Sessions,
  recovery: HistoryRecovery | undefined,
  choice: "recover" | "startFresh",
): Promise<void> {
  if (!recovery)
    throw new VisibleError("There is no damaged history to recover.");
  // A save never writes over damage, so starting empty clears it away first;
  // the store keeps every part of it beside the copy made when it was found.
  if (choice === "startFresh") return sessions.startAfresh(recovery.keptAt);
  if (!recovery.readable)
    throw new VisibleError(
      "None of the saved conversations could be read, so there is nothing to recover.",
    );
  await sessions.recoverReadable();
}

type ProfileConfiguration = {
  readonly capabilities: Capabilities;
  readonly interests: readonly string[];
  readonly preferences: () => WorkspaceSnapshot["preferences"];
  readonly setPreferences: (
    preferences: WorkspaceSnapshot["preferences"],
  ) => void;
  readonly persist: () => Promise<void>;
  readonly refreshPlugins: () => Promise<void>;
};

export async function configureProfile({
  capabilities,
  interests,
  preferences,
  setPreferences,
  persist,
  refreshPlugins,
}: ProfileConfiguration): Promise<void> {
  const allowed = await capabilities.interests();
  if (
    !Array.isArray(interests) ||
    interests.some((item) => !allowed.includes(item))
  )
    throw new VisibleError("Choose one of the available interests.");
  const chosen = { onboarded: true, interests: [...new Set(interests)] };
  const previous = preferences();
  setPreferences({ ...chosen, capabilitiesApplied: false });
  try {
    await persist();
  } catch (error) {
    setPreferences(previous);
    throw error;
  }
  await capabilities.applyInterests(chosen.interests);
  setPreferences(chosen);
  await refreshPlugins();
  await persist();
}
