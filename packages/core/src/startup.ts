/**
 * What a launch finds, and the store-level steps behind recovery and profile
 * setup. The workspace keeps ownership of every field and of its one save path;
 * this module returns restored state or invokes that path at the required
 * boundaries.
 */

import type { Capabilities } from "@zhiyin/capabilities";
import type {
  HistoryRecovery,
  McpServerState,
  PluginState,
  UsageState,
  WorkspaceContext,
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

export const initialUsage: UsageState = {
  status: "unavailable",
  reason: "Usage will appear after the first model request.",
};

export function withRecentWorkspace(
  existing: NonNullable<WorkspaceSnapshot["recentWorkspaces"]>,
  chosen: NonNullable<WorkspaceSnapshot["workspace"]>,
): NonNullable<WorkspaceSnapshot["recentWorkspaces"]> {
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
  readonly selectedTaskId: string | null;
  readonly historyRecovery: HistoryRecovery | undefined;
};

export type StartupState = {
  readonly tasks: WorkspaceTask[];
  readonly selectedTaskId: string | null;
  readonly preferences: WorkspaceSnapshot["preferences"];
  readonly workspace: WorkspaceSnapshot["workspace"];
  readonly recentWorkspaces: NonNullable<WorkspaceSnapshot["recentWorkspaces"]>;
  readonly plugins: PluginState[];
  readonly usage: UsageState;
  readonly issues: string[];
  readonly historyAvailable: boolean;
  readonly historyRecovery: HistoryRecovery | undefined;
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
  settleAfterRestart: (task: WorkspaceTask) => WorkspaceTask,
): Promise<StartupState> {
  const issues: string[] = [];
  let historyAvailable = true;
  let capabilitiesAvailable = true;
  let historyRecovery = current.historyRecovery;
  const [restored, loadedPlugins, usage] = await Promise.all([
    deps.sessions
      .loadWorkspace()
      .catch(async () => {
        historyAvailable = false;
        historyRecovery ??= await offerHistoryRecovery(deps.sessions);
        if (!historyRecovery)
          issues.push(
            "Saved history could not be opened. Your files have been preserved. Retry after fixing access to the history file.",
          );
        return undefined;
      })
      .catch(() => undefined),
    deps.capabilities.pluginStates([]).catch(() => {
      capabilitiesAvailable = false;
      issues.push(
        "Plugins could not be loaded. Workspace tools still work; plugins return once they can be read.",
      );
      return [];
    }),
    deps.usage.state(deps.now()).catch(() => ({
      status: "unavailable" as const,
      reason: "Usage history could not be opened.",
    })),
  ]);

  let needsSave = false;
  const tasks = restored
    ? restored.tasks.map((task) => {
        const titleSource =
          task.titleSource ??
          (task.title === "New task" && task.messages.length === 0
            ? "generated"
            : "manual");
        if (!task.titleSource) needsSave = true;
        const settled = settleAfterRestart(task);
        if (settled !== task) needsSave = true;
        return { ...settled, titleSource };
      })
    : [...current.tasks];
  const selectedTaskId = restored
    ? restored.selectedTaskId
    : current.selectedTaskId;
  let preferences =
    restored?.preferences ??
    (deps.onboarding ? { onboarded: false, interests: [] } : undefined);
  const workspace = restored?.workspace;
  let recentWorkspaces: NonNullable<WorkspaceSnapshot["recentWorkspaces"]> = [
    ...(restored?.recentWorkspaces ?? []),
  ];
  if (workspace)
    recentWorkspaces = withRecentWorkspace(recentWorkspaces, workspace);
  if (workspace && deps.workspace.selectWorkspace) {
    try {
      await deps.workspace.selectWorkspace(workspace.path);
    } catch {
      issues.push(movedWorkspaceNotice);
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
      issues.push(
        "Your saved preferences could not be applied to the available capabilities. They will be tried again next time.",
      );
    }
  }

  return {
    tasks,
    selectedTaskId,
    preferences,
    workspace,
    recentWorkspaces,
    plugins,
    usage,
    issues,
    historyAvailable,
    historyRecovery,
    capabilitiesAvailable,
    needsSave,
  };
}

export async function loadConnections(
  capabilities: Capabilities,
  install: (result: {
    readonly mcpServers: McpServerState[];
    readonly plugins?: PluginState[];
    readonly issues?: readonly string[];
  }) => void,
): Promise<void> {
  const issues: string[] = [];
  let mcpServers: McpServerState[] = [];
  try {
    mcpServers = [...(await capabilities.connections())];
  } catch {
    issues.push(
      "Connections could not be loaded. You can still work without them.",
    );
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
        "Plugins could not be loaded. Workspace tools still work; plugins return once they can be read.",
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
  if (choice !== "recover") return;
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
