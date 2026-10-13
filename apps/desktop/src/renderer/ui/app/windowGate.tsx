import type { ReactElement } from "react";
import { RELEASES_URL } from "@zhiyin/contract";
import { Onboarding } from "../onboarding/index.js";
import { HistoryRecoveryGate, NewerHistoryGate } from "../recovery/index.js";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import type { WorkspaceState } from "./workspaceState.js";

/**
 * What the window shows in place of the workspace, where something comes
 * before it: the app still loading, history only a newer version reads, saved
 * conversations that will not open, or a person who has not been welcomed.
 * Nothing where the workspace is what shows.
 */
export function windowGate(
  state: WorkspaceState,
  commands: WorkspaceCommands,
): ReactElement | undefined {
  if (state.connection === "loading") return <WorkspaceSkeleton />;
  // History a newer version saved is not damage, so it is neither recovered
  // nor started over: nothing here opens it, and the way on is that version.
  if (state.newerHistory)
    return (
      <NewerHistoryGate
        newer={state.newerHistory}
        onGetLatest={() => void commands.openExternalUrl(RELEASES_URL)}
        {...(commands.openDataFolder
          ? { onOpenDataFolder: () => void commands.openDataFolder?.() }
          : {})}
      />
    );
  // Before anything else: saved conversations that will not open are a
  // question only the person can answer, and nothing is written over them
  // until they do.
  if (state.historyRecovery && commands.recoverHistory)
    return (
      <HistoryRecoveryGate
        recovery={state.historyRecovery}
        onChoose={commands.recoverHistory}
        onShowKept={(path) => void commands.showInFolder?.(path)}
      />
    );
  if (
    state.preferences &&
    !state.preferences.onboarded &&
    commands.configureProfile &&
    state.runtime.tasks === "available"
  )
    return <Onboarding onComplete={commands.configureProfile} />;
  return undefined;
}
