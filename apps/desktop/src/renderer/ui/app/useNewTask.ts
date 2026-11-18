import { useState } from "react";
import type { MessageAttachment, ReasoningSelection } from "@zhiyin/contract";
import { guidanceDraft, sendComposerMessage } from "./dockState.js";
import type { WindowCommands } from "./windowCommands.js";
import type {
  WindowAction,
  WindowState,
  WorkspaceTask,
} from "./windowState.js";

/** Words put back in the composer, for the conversation they belong to. */
export type ComposerDraft = {
  readonly id: string;
  /** Empty for the new-task page, where no conversation is open yet. */
  readonly taskId: string;
  readonly text: string;
  readonly attachments?: readonly MessageAttachment[];
  /** The message box takes focus, so the person goes on writing. */
  readonly focus?: true;
};

/**
 * A new conversation as a draft in the window (it is created with its
 * first message), and which composer is showing.
 *
 * Each new task gets an empty composer of its own. The empty composer's first
 * message opens its conversation, which the core shows before the message is
 * sent; the composer stays the same one there, so a send that fails leaves the
 * words where they were typed. Started from a project, the conversation joins
 * that project before its first turn, so that turn has its memory.
 */
export function useNewTask({
  state,
  selectedTask,
  running,
  commands,
  dispatch,
  act,
  adoptBudget,
}: {
  state: Pick<WindowState, "memory">;
  selectedTask: WorkspaceTask | null;
  /** A turn is under way, so a message is guidance for it. */
  running: boolean;
  commands: Pick<
    WindowCommands,
    | "createTask"
    | "sendMessage"
    | "setConversationMemory"
    | "selectNothing"
    | "useRecentWorkspace"
  >;
  dispatch: (action: WindowAction) => void;
  act: (operation: () => void | Promise<unknown>) => Promise<void>;
  /** Fixes the budget a conversation just started begins on. */
  adoptBudget: (taskId: string) => Promise<void>;
}) {
  const [restored, restore] = useState<ComposerDraft>();
  // How many ways to begin were taken, so each fills the message anew.
  const [fills, setFills] = useState(0);
  // Which empty composer is showing, counted up each time a new conversation
  // is started, so each starts empty.
  const [blank, setBlank] = useState(0);
  // The conversation the empty composer's own first message is opening.
  const [opening, setOpening] = useState<{
    readonly blank: number;
    readonly taskId?: string;
  }>();
  // The project an empty composer's conversation goes in, started from the
  // project's +: only that composer's.
  const [inProject, setInProject] = useState<{
    readonly blank: number;
    readonly project: string;
  }>();

  function start() {
    dispatch({ type: "newTaskStarted" });
    setOpening(undefined);
    setBlank((count) => count + 1);
    // The core is told too. Every snapshot it sends says which conversation is
    // open, so leaving it believing the last one still is means the next
    // snapshot — choosing a folder, for instance — puts that conversation back
    // on screen.
    if (commands.selectNothing) void act(() => commands.selectNothing?.());
  }

  /** An empty composer for a conversation in a project, in its first folder. */
  function startIn(projectId: string) {
    start();
    setInProject({ blank: blank + 1, project: projectId });
    const folder = state.memory?.projects.find(
      (project) => project.id === projectId,
    )?.folders[0];
    const openFolder = commands.useRecentWorkspace;
    if (folder && openFolder) void act(() => openFolder(folder));
  }

  async function submit(
    message: string,
    reasoning?: ReasoningSelection,
    attachments?: readonly MessageAttachment[],
  ) {
    let taskId = selectedTask?.id;
    const opened = !taskId;
    if (!taskId) {
      setOpening({ blank });
      try {
        taskId = await commands.createTask();
      } catch (error) {
        setOpening(undefined);
        throw error;
      }
      setOpening({ blank, taskId });
      // In its project before its first turn, so that turn has its memory.
      if (inProject?.blank === blank)
        await commands.setConversationMemory(taskId, {
          project: inProject.project,
        });
      await adoptBudget(taskId);
    }
    restore(undefined);
    await sendComposerMessage(commands.sendMessage, {
      taskId,
      message,
      reasoning,
      attachments,
      running,
    });
    // The empty composer is the new conversation's now; the next empty one,
    // shown once nothing is open, starts empty.
    if (opened) setBlank((count) => (count === blank ? count + 1 : count));
  }

  return {
    /** Which composer this is: a new key starts an empty one. */
    composerKey: !selectedTask
      ? `new:${blank}`
      : opening && (opening.taskId ?? selectedTask.id) === selectedTask.id
        ? `new:${opening.blank}`
        : selectedTask.id,
    /**
     * What the composer starts with: words put back for this conversation,
     * else guidance not delivered before Stop or a restart.
     */
    draft:
      restored && restored.taskId === (selectedTask?.id ?? "")
        ? restored
        : guidanceDraft(selectedTask),
    /** Puts words back in the composer. */
    restore,
    /** Writes a way to begin into the message, unsent, with focus there. */
    fill(text: string) {
      setFills(fills + 1);
      restore({
        id: `begin:${fills + 1}`,
        taskId: selectedTask?.id ?? "",
        text,
        focus: true,
      });
    },
    /** Starts a new task with an empty composer. */
    start,
    /**
     * Starts a new task with these words in its message, unsent, with focus
     * there, so the person can add a file or a folder first.
     */
    startWith(text: string) {
      start();
      setFills(fills + 1);
      restore({ id: `begin:${fills + 1}`, taskId: "", text, focus: true });
    },
    /** Starts a new task in a project. */
    startIn,
    /** Sends the composer's message, opening its conversation if needed. */
    submit,
  };
}
