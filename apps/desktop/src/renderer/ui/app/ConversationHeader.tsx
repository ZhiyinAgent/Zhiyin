import { surfaceNames } from "../beside/index.js";
import { RunningCommands } from "../commands/index.js";
import {
  ProjectPicker,
  SessionHeader,
  BesideTabs,
} from "../session-header/index.js";
import type { useBesideView } from "./useBesideView.js";
import type { WindowCommands } from "./windowCommands.js";
import { reasonOf } from "./useCommandRunner.js";
import {
  besideOf,
  selectedBeside,
  type WindowAction,
  type WindowState,
  type WorkspaceTask,
} from "./windowState.js";
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
  state: WindowState;
  task: WorkspaceTask | null;
  commands: WindowCommands;
  dispatch: (action: WindowAction) => void;
  viewing: ReturnType<typeof useBesideView>;
  /** Names the tabs and the panel they choose for each other. */
  viewId: string;
  files: { readonly open: boolean; readonly onToggle: () => void };
}) {
  const hasBeside = viewing.beside !== undefined;
  // With nothing to name yet, the bar is still there to drag the window by
  // and to keep the conversation below its controls.
  if (!(task || hasBeside)) return <div className={styles["top-bar"]} />;
  const say = (cause: unknown) =>
    dispatch({
      type: "commandErrorShown",
      message: reasonOf(cause, "That change was not made. Try again."),
    });
  return (
    <SessionHeader
      windowEdge
      project={
        task &&
        state.memory && (
          <ProjectPicker
            // Its own folder, or the one it works in until it names one.
            task={{
              project: task.project,
              workspace: task.workspace ?? state.workspace,
            }}
            memory={state.memory}
            onChoose={(choice) =>
              void commands.setConversationMemory(task.id, choice).catch(say)
            }
            onNewProject={
              (task.workspace ?? state.workspace) &&
              (() =>
                void commands
                  .changeMemory({
                    kind: "projectFromConversation",
                    taskId: task.id,
                  })
                  .then(
                    (outcome) => !outcome.ok && say(new Error(outcome.reason)),
                    say,
                  ))
            }
          />
        )
      }
      workspace={state.workspace?.name ?? ""}
      title={task?.title ?? "New conversation"}
      running={
        task && (
          <RunningCommands
            taskId={task.id}
            running={besideOf(state.beside, task.id).commands}
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
        viewing.beside ? (
          <BesideTabs
            id={viewId}
            selected={viewing.open ? "beside" : "conversation"}
            besideName={surfaceNames[viewing.beside.kind]}
            live={selectedBeside(state).browser.loading}
            onSelect={(view) =>
              view === "beside" ? viewing.toBeside() : viewing.toConversation()
            }
          />
        ) : undefined
      }
      files={
        task?.artifacts.length
          ? {
              count: task.artifacts.length,
              open: files.open,
              onToggle: files.onToggle,
            }
          : undefined
      }
    />
  );
}
