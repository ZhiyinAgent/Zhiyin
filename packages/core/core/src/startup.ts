/**
 * What a launch finds, and the store-level steps behind recovery. The
 * workspace keeps ownership of every field and of its one save path; this
 * module returns restored state or invokes that path at the required
 * boundaries.
 */

import type {
  ConversationSummary,
  HistoryRecovery,
  NewerHistory,
  PersonalSettings,
  UsageState,
  WorkspaceContext,
  WorkspaceIssue,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { HistoryRepair, Sessions } from "@zhiyin/session";
import type { UsageTelemetry } from "@zhiyin/usage";
import type { CapabilityState, LaunchPlugins } from "./capability-state.js";
import { restoreFolders } from "./folder-rules.js";
import { personalSettingsIn } from "./personal-choices.js";

export const initialUsage: UsageState = {
  status: "unavailable",
  reason: "Usage will appear after the first model request.",
};

type StartupDependencies = {
  readonly onboarding?: boolean;
  /** The folder a conversation starts in when the history names none. */
  readonly startingFolder?: string | undefined;
  readonly sessions: Sessions;
  readonly historyRepair: HistoryRepair;
  readonly capabilityState: Pick<CapabilityState, "launch" | "applyAtLaunch">;
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
  /** The person's choices, onboarding's finished if it was left half applied. */
  readonly settings: PersonalSettings;
  readonly workspace: WorkspaceSnapshot["workspace"];
  readonly launchFolders: readonly string[];
  readonly recentWorkspaces: WorkspaceSnapshot["recentWorkspaces"];
  readonly plugins: LaunchPlugins;
  readonly usage: UsageState;
  readonly issues: WorkspaceIssue[];
  readonly historyAvailable: boolean;
  readonly historyRecovery: HistoryRecovery | undefined;
  /** Saved by a newer version: nothing is opened, and no fresh start offered. */
  readonly newerHistory: NewerHistory | undefined;
  readonly needsSave: boolean;
};

async function offerHistoryRecovery(
  repair: HistoryRepair,
): Promise<HistoryRecovery | undefined> {
  try {
    const keptAt = await repair.preserveDamaged();
    const damage = await repair.inspectDamage();
    return damage.kind === "partial"
      ? {
          readable: damage.readable,
          waiting: damage.waiting,
          damaged: damage.damaged,
          keptAt,
        }
      : { readable: 0, waiting: 0, damaged: 0, keptAt };
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
        // Not damage either: the files could not be read just now, as when
        // another program holds one. Nothing is copied aside or offered.
        if (code === "unavailable") {
          say(
            "Saved history could not be read just now, so it was left as it is. It is read again the next time Zhiyin starts.",
          );
          return undefined;
        }
        historyRecovery ??= await offerHistoryRecovery(deps.historyRepair);
        if (!historyRecovery)
          say(
            "Saved history could not be opened. Your files have been preserved. Retry after fixing access to the history file.",
          );
        return undefined;
      })
      .catch(() => undefined),
    deps.capabilityState.launch().then((found) => {
      if (found.issue) say(found.issue);
      return found;
    }),
    deps.usage.state(deps.now()).catch(() => ({
      status: "failed" as const,
      reason: "Usage history could not be opened.",
    })),
  ]);

  // A history that opens needs no recovery, whatever was offered before.
  if (historyAvailable) historyRecovery = undefined;
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
  const { workspace, launchFolders, recentWorkspaces } = await restoreFolders(
    {
      workspace: restored?.workspace,
      launchFolders: restored?.launchFolders ?? [],
      recentWorkspaces: restored?.recentWorkspaces ?? [],
    },
    {
      startingFolder: deps.startingFolder,
      context: deps.workspace,
      say,
    },
  );

  let plugins = loadedPlugins;
  if (preferences?.capabilitiesApplied === false) {
    try {
      plugins = {
        ...plugins,
        plugins: await deps.capabilityState.applyAtLaunch(
          preferences.interests,
        ),
      };
      preferences = {
        onboarded: preferences.onboarded,
        interests: preferences.interests,
      };
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
    settings: {
      ...personalSettingsIn(restored ?? {}),
      ...(preferences ? { preferences } : {}),
    },
    workspace,
    launchFolders,
    recentWorkspaces,
    plugins,
    usage,
    issues,
    historyAvailable,
    historyRecovery,
    newerHistory,
    needsSave,
  };
}

export async function recoverHistory(
  repair: HistoryRepair,
  recovery: HistoryRecovery | undefined,
  choice: "recover" | "startFresh",
): Promise<void> {
  if (!recovery)
    throw new VisibleError("There is no damaged history to recover.");
  // A save never writes over damage, so starting empty clears it away first;
  // the store keeps every part of it beside the copy made when it was found.
  if (choice === "startFresh") return repair.startAfresh(recovery.keptAt);
  if (!recovery.readable && !recovery.waiting)
    throw new VisibleError(
      "None of the saved conversations could be read, so there is nothing to recover.",
    );
  await repair.recoverReadable();
}
