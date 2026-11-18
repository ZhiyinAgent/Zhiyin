import type { ReactElement } from "react";
import { RELEASES_URL } from "@zhiyin/contract";
import { ModelStep, type ModelSetupCommands } from "../model/index.js";
import { Onboarding } from "../onboarding/index.js";
import { HistoryRecoveryGate, NewerHistoryGate } from "../recovery/index.js";
import { WindowSkeleton } from "./WindowSkeleton.js";
import type { WindowCommands } from "./windowCommands.js";
import type { WindowState } from "./windowState.js";

/**
 * What the window shows in place of its conversations, where something comes
 * before them: the app still loading, history only a newer version reads, saved
 * conversations that will not open, or a person who has not been welcomed,
 * whose welcome includes connecting a model. Nothing when the conversations
 * show.
 */
export function windowGate(
  state: WindowState,
  commands: WindowCommands,
): ReactElement | undefined {
  if (state.connection === "loading") return <WindowSkeleton />;
  const { openDataFolder, showInFolder } = commands;
  // History a newer version saved is not damage, so it is neither recovered
  // nor started over: nothing here opens it, and the way on is that version.
  if (state.newerHistory)
    return (
      <NewerHistoryGate
        newer={state.newerHistory}
        onGetLatest={() => commands.openExternalUrl(RELEASES_URL)}
        onOpenDataFolder={openDataFolder && (() => openDataFolder())}
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
        onShowKept={showInFolder && ((path: string) => showInFolder(path))}
      />
    );
  if (
    state.preferences &&
    !state.preferences.onboarded &&
    commands.configureProfile &&
    state.runtime.tasks === "available"
  )
    return (
      <Onboarding
        onComplete={commands.configureProfile}
        {...(commands.setLook && state.look
          ? { onLook: commands.setLook, look: state.look }
          : {})}
        modelStep={(place) => (
          <ModelStep
            {...place}
            settings={state.provider}
            {...modelSetupCommands(commands)}
          />
        )}
      />
    );
  return undefined;
}

/** What setting up a model asks of the core, as the Model page asks it. */
export function modelSetupCommands(
  commands: WindowCommands,
): ModelSetupCommands {
  return {
    onListProviders: commands.listProviders,
    onListModels: commands.listModels,
    onSaveApiKey: commands.saveProviderApiKey,
    onSelectModel: commands.selectModel,
    onOpenExternalUrl: commands.openExternalUrl,
  };
}
