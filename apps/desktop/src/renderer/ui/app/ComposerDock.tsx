import type { ComponentProps } from "react";
import type { UserInputResponse } from "@zhiyin/contract";
import { ApprovalPrompt } from "../actions/index.js";
import { Composer } from "../conversation/index.js";
import { UserInputPrompt } from "../user-input/index.js";
import { WorkspacePicker } from "./WorkspacePicker.js";
import {
  approvalPromptDetails,
  composerLock,
  taskIsRunning,
} from "./dockState.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import type { WorkspaceState, WorkspaceTask } from "./workspaceState.js";
import styles from "./app.module.css";

type ComposerProps = ComponentProps<typeof Composer>;

/**
 * What sits under a conversation: the decision its turn is waiting on, if
 * there is one, and the composer with the folder it works in.
 */
export function ComposerDock({
  state,
  task,
  commands,
  act,
  compact,
  hidden,
  draft,
  context,
  onSubmit,
  onStop,
  onUserInput,
  onReturnToConversation,
}: {
  state: WorkspaceState;
  task: WorkspaceTask | null;
  commands: WorkspaceCommands;
  /** Runs a command, showing its failure in the window. */
  act: (operation: () => void | Promise<unknown>) => Promise<void>;
  /** Something is open beside the conversation, which narrows the dock. */
  compact: boolean;
  /** The conversation could not be opened, so there is nothing to write to. */
  hidden: boolean;
  draft: ComposerProps["draft"];
  context: NonNullable<ComposerProps["context"]>;
  onSubmit: NonNullable<ComposerProps["onSubmit"]>;
  onStop: () => void;
  onUserInput: (response: UserInputResponse) => Promise<void>;
  onReturnToConversation: () => void;
}) {
  const running = taskIsRunning(task);
  const folderLocked = running || state.runtime.tasks === "unavailable";
  return (
    <div
      className={`${styles["composer-dock"]}${compact ? ` ${styles["composer-dock--compact"]}` : ""}${task?.phase.kind === "approval" || task?.phase.kind === "input" ? ` ${styles["composer-dock--deciding"]}` : ""}`}
    >
      {compact && task?.phase.kind === "completed" && (
        <div className={styles["workspace-completion"]}>
          <button
            className="text-button"
            type="button"
            onClick={onReturnToConversation}
          >
            Return to conversation
          </button>
        </div>
      )}
      {task?.phase.kind === "approval" && (
        <div className={styles["composer-dock__decision"]}>
          <ApprovalPrompt
            key={task.phase.prompt.id}
            {...approvalPromptDetails(task.phase.prompt)}
            compact={compact}
            onDecision={async (decision, reason) => {
              const prompt =
                task.phase.kind === "approval" ? task.phase.prompt : undefined;
              if (!prompt) return;
              await commands.resolveApproval(
                task.id,
                prompt.id,
                decision === "allow-once"
                  ? "allow"
                  : decision === "allow-conversation"
                    ? "allow-conversation"
                    : "deny",
                ...(decision === "deny" && reason?.trim()
                  ? [reason.trim()]
                  : []),
              );
            }}
          />
        </div>
      )}
      {task?.phase.kind === "input" && task.phase.prompt.kind !== "quiz" && (
        <div className={styles["composer-dock__decision"]}>
          <UserInputPrompt
            prompt={task.phase.prompt}
            onSubmit={onUserInput}
            onCancel={onStop}
          />
        </div>
      )}
      <div className={styles["workspace-composer"]} hidden={hidden}>
        <Composer
          key={task?.id ?? "new"}
          {...(state.provider.reasoning
            ? { reasoningCapabilities: state.provider.reasoning }
            : {})}
          {...(task?.reasoning ? { initialReasoning: task.reasoning } : {})}
          onSubmit={onSubmit}
          context={context}
          keepPaste={commands.keepPaste}
          {...(commands.keepPicture
            ? { keepPicture: commands.keepPicture }
            : {})}
          seesPictures={state.provider.acceptsImages === true}
          {...(commands.readPicture
            ? { readPicture: commands.readPicture }
            : {})}
          // A paste not yet sent belongs to no conversation; one
          // a rewind put back is still the conversation's.
          openAttachment={(id) =>
            void act(() => commands.openAttachment(task?.id ?? null, id))
          }
          {...(draft ? { draft } : {})}
          running={running}
          onStop={onStop}
          scope={
            <WorkspacePicker
              disabled={folderLocked}
              {...(state.workspace ? { current: state.workspace } : {})}
              recent={state.recentWorkspaces}
              {...(commands.chooseWorkspace
                ? {
                    onChoose: () => act(() => commands.chooseWorkspace?.()),
                  }
                : {})}
              {...(commands.useRecentWorkspace
                ? {
                    onUseRecent: (path: string) =>
                      act(() => commands.useRecentWorkspace?.(path)),
                  }
                : {})}
            />
          }
          {...composerLock(task, state.runtime.tasks !== "unavailable")}
        />
      </div>
    </div>
  );
}
