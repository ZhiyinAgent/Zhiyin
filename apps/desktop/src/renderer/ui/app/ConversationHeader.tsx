import { RunningCommands } from "../commands/index.js";
import { SessionHeader } from "./SessionHeader.js";
import { WorkspaceViewTabs } from "./WorkspaceViewTabs.js";
import type { useWorkspaceView } from "./useWorkspaceView.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";
import type {
  WorkspaceAction,
  WorkspaceState,
  WorkspaceTask,
} from "./workspaceState.js";
import styles from "./app.module.css";

/**
 * The bar over a conversation: its folder and title, the commands it has
 * running, the choice between the conversation and what is beside it, and
 * the files it made.
 */
export function ConversationHeader({
  state,
  task,
  commands,
  dispatch,
  viewing,
  viewId,
  files,
}: {
  state: WorkspaceState;
  task: WorkspaceTask | null;
  commands: WorkspaceCommands;
  dispatch: (action: WorkspaceAction) => void;
  viewing: ReturnType<typeof useWorkspaceView>;
  /** Names the tabs and the panel they choose for each other. */
  viewId: string;
  files: { readonly open: boolean; readonly onToggle: () => void };
}) {
  const hasWorkspace = viewing.beside !== undefined;
  // With nothing to name yet, the bar is still there to drag the window by
  // and to keep the conversation below its controls.
  if (!(task || hasWorkspace)) return <div className={styles["top-bar"]} />;
  return (
    <SessionHeader
      workspace={state.workspace?.name ?? ""}
      title={task?.title ?? "New task"}
      running={
        task && (
          <RunningCommands
            taskId={task.id}
            running={state.runningCommands[task.id] ?? []}
            commands={commands}
            onListed={(listed) =>
              dispatch({
                type: "commandsChanged",
                taskId: task.id,
                commands: listed,
              })
            }
          />
        )
      }
      viewSelector={
        hasWorkspace ? (
          <WorkspaceViewTabs
            id={viewId}
            selected={viewing.open ? "workspace" : "conversation"}
            live={state.browser.loading || task?.phase.kind === "browser"}
            onSelect={(view) =>
              view === "workspace"
                ? viewing.toWorkspace()
                : viewing.toConversation()
            }
          />
        ) : undefined
      }
      {...(task?.artifacts.length
        ? {
            files: {
              count: task.artifacts.length,
              open: files.open,
              onToggle: files.onToggle,
            },
          }
        : {})}
    />
  );
}
