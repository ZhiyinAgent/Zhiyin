import { useRef, useState, type Ref } from "react";
import type { AppUpdateState } from "@zhiyin/contract";
import { UpdateReady } from "./UpdateReady.js";
import {
  focusMenu,
  Icon,
  Logo,
  usePopover,
  type PopoverPlacement,
} from "../shared/index.js";
import { TaskOptions, type TaskMenu } from "./ConversationMenu.js";
import { ProjectGroups } from "./SidebarProjects.js";
import styles from "./sidebar.module.css";

export type SidebarTask = {
  id: string;
  title: string;
  updatedAt?: string;
  /** Saved by an earlier version, and not opened until it is updated. */
  needsUpdate?: boolean;
  /** The project it belongs to, when it belongs to one. */
  projectId?: string;
  /** The person asked that nothing be kept from it. */
  memoryOff?: boolean;
  /**
   * What it kept in memory, which its deletion offers to forget: the entries
   * kept for it alone, and the Knowledge entries it kept for other
   * conversations.
   */
  kept?: { readonly own: number; readonly general: number };
};

/** What a deleted conversation's memory loses, as the person chose. */
type ForgetOnDelete = { readonly own?: true; readonly general?: true };

/** Deletes a conversation, forgetting what it kept in memory when asked. */
export type DeleteConversation = (
  id: string,
  forget?: ForgetOnDelete,
) => void | Promise<void>;

/** Ongoing work, holding its conversations in the list (ADR 0026). */
export type SidebarProject = {
  readonly id: string;
  readonly name: string;
};

type AppSidebarProps = {
  onOpenLibrary?: () => void;
  tasks: SidebarTask[];
  /** Absent or empty: one list of recent conversations, as before projects. */
  projects?: readonly SidebarProject[];
  /** Starts a conversation in a project. */
  onNewTaskInProject?: (projectId: string) => void;
  /** Puts a conversation in a project, or in none. */
  onMoveToProject?: (id: string, projectId: string | null) => void;
  /** Keeps nothing from a conversation, or keeps again. */
  onKeepNothingFrom?: (id: string, off: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onNewTask?: () => void;
  onOpenUsage?: () => void;
  onOpenModel?: () => void;
  onOpenMemory?: () => void;
  onOpenSettings?: () => void;
  /** The model that answers, named at the foot; absent until one is chosen. */
  modelName?: string | undefined;
  /** Where updating Zhiyin stands; absent where this copy does not update. */
  appUpdate?: AppUpdateState | undefined;
  /** Restarts into the update that is ready; rejects, saying why, if it cannot. */
  onRestartToUpdate?: () => Promise<void>;
  onRenameTask?: (id: string, title: string) => void | Promise<void>;
  onDeleteTask?: DeleteConversation;
  onTaskPermissions?: (id: string) => void;
  /** Absent where the app cannot export, and then not offered. */
  onExportConversation?: ((id: string) => void) | undefined;
  /** Asks again about the conversations waiting for an update. */
  onUpdateConversations?: (() => void) | undefined;
  /**
   * Present where the sidebar is the app's navigation: at 720 pixels wide or
   * less it folds away into a drawer, shown while `open`, which holds the
   * sidebar by `ref`.
   */
  drawer?: { readonly ref: Ref<HTMLElement>; readonly open: boolean };
};

/** Made once: the list is drawn again on every event the window hears. */
const lastChanged = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** When a conversation last changed, for the tip over its row; nothing if unknown. */
function changedAt(task: SidebarTask): string | undefined {
  if (!task.updatedAt) return undefined;
  const at = new Date(task.updatedAt);
  return Number.isFinite(at.getTime()) ? lastChanged.format(at) : undefined;
}

/**
 * A conversation's menu opens under its row, or over it where there is no
 * room below, at least as wide as the row's text.
 */
function taskMenuPlacement(mode: TaskMenu["mode"]): PopoverPlacement {
  return {
    side: "below",
    gap: 4,
    edge: 8,
    inset: 7,
    anchorWidthLess: 14,
    // Its longest line, unwrapped: the delete question holds the
    // conversation's name and two buttons on one line.
    leastWidth: { menu: 280, move: 160, delete: 248 }[mode],
  };
}

export function AppSidebar({
  onOpenLibrary,
  tasks,
  projects = [],
  selectedId,
  onSelect,
  onNewTask,
  onNewTaskInProject,
  onMoveToProject,
  onKeepNothingFrom,
  onOpenUsage,
  onOpenModel,
  onOpenMemory,
  onOpenSettings,
  appUpdate,
  onRestartToUpdate,
  onRenameTask,
  onDeleteTask,
  onTaskPermissions,
  onExportConversation,
  onUpdateConversations,
  drawer,
  modelName,
}: AppSidebarProps) {
  const [taskMenu, setTaskMenu] = useState<TaskMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** The whole row of the conversation whose menu is open. */
  const taskMenuRow = useRef<Element | null>(null);
  const taskOptions = usePopover({
    open: taskMenu !== null,
    onOpenChange: (open) => {
      if (!open) setTaskMenu(null);
    },
    placement: taskMenuPlacement(taskMenu?.mode ?? "menu"),
    anchor: () => taskMenuRow.current,
    onOpened: focusMenu,
    // The question before a deletion takes the menu's place, and is placed
    // afresh.
    content: taskMenu && `${taskMenu.id}:${taskMenu.mode}`,
  });

  /**
   * The menu is placed against the whole row, whichever way it was opened:
   * from the row itself or from its options button, where focus goes back.
   */
  function openTaskMenu(task: SidebarTask, from: HTMLElement) {
    taskOptions.openedFrom(from);
    taskMenuRow.current =
      from
        .closest(`.${styles["task-entry"]}`)
        ?.querySelector(`.${styles["task-row"]}`) ?? from;
    setTaskMenu({ id: task.id, mode: "menu" });
  }

  /** One conversation's row, wherever the list shows it. */
  const entry = (task: SidebarTask) => (
    <div
      role="listitem"
      className={`${styles["task-entry"]}${taskMenu?.id === task.id ? ` ${styles["task-entry--menu-open"]}` : ""}`}
      key={task.id}
      ref={taskMenu?.id === task.id ? taskOptions.root : undefined}
      // Escape closes the menu alone, so the drawer around the list stays open.
      onKeyDown={taskMenu?.id === task.id ? taskOptions.onKeyDown : undefined}
    >
      {renamingId === task.id ? (
        <TaskRename
          title={task.title}
          onCommit={(title) => {
            setRenamingId(null);
            if (title && title !== task.title)
              void onRenameTask?.(task.id, title);
          }}
          onCancel={() => setRenamingId(null)}
        />
      ) : (
        <button
          className={styles["task-row"]}
          type="button"
          aria-current={task.id === selectedId ? "page" : undefined}
          title={changedAt(task)}
          onClick={() => onSelect(task.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            openTaskMenu(task, event.currentTarget);
          }}
        >
          <span>{task.title}</span>
          {task.needsUpdate && <small>To update</small>}
        </button>
      )}
      {renamingId !== task.id && (
        <button
          type="button"
          className={styles["task-entry__options"]}
          aria-label={`Options for ${task.title}`}
          aria-haspopup="menu"
          aria-expanded={taskMenu?.id === task.id}
          data-tip={
            task.needsUpdate
              ? "Update or delete"
              : onExportConversation
                ? "Rename, permissions, export or delete"
                : "Rename, permissions or delete"
          }
          onClick={(event) =>
            taskMenu?.id === task.id
              ? setTaskMenu(null)
              : openTaskMenu(task, event.currentTarget)
          }
        >
          •••
        </button>
      )}

      {taskMenu?.id === task.id && (
        // The question before a deletion is drawn anew, in place of
        // the menu, and never as the menu's own element changed.
        <TaskOptions
          key={taskMenu.mode}
          ref={taskOptions.panel}
          task={task}
          menu={taskMenu}
          projects={projects}
          onClose={() => setTaskMenu(null)}
          onMode={(mode) => setTaskMenu({ ...taskMenu, mode })}
          onRename={() => {
            setTaskMenu(null);
            setRenamingId(task.id);
          }}
          onPermissions={onTaskPermissions}
          onExport={onExportConversation}
          onDelete={onDeleteTask}
          onUpdate={onUpdateConversations}
          onMove={onMoveToProject}
          onKeepNothing={onKeepNothingFrom}
        />
      )}
    </div>
  );

  const inProject = new Set(projects.map((project) => project.id));
  const recent = tasks.filter(
    (task) => !task.projectId || !inProject.has(task.projectId),
  );

  return (
    <aside
      ref={drawer?.ref}
      className={`${styles["app-sidebar"]}${drawer ? ` ${styles["app-sidebar--drawer"]}` : ""}${drawer?.open ? ` ${styles["app-sidebar--drawer-open"]}` : ""}`}
      aria-label="Primary navigation"
    >
      {/* The app's own name, on the same bar as the conversation header. Sized
          to leave air above and below it in a bar that is also as tall as the
          window controls at the far end of it. */}
      <header className={styles["app-sidebar__brand"]}>
        <Logo size={24} />
      </header>

      <button className={styles["new-task"]} type="button" onClick={onNewTask}>
        <Icon name="plus" />
        <span>New conversation</span>
      </button>

      <nav className={styles["app-nav"]} aria-label="App">
        <button type="button" onClick={onOpenLibrary}>
          <Icon name="plug" />
          <span>Plugins</span>
        </button>
        <button type="button" onClick={onOpenMemory}>
          <Icon name="spark" />
          <span>Memory</span>
        </button>
      </nav>

      {projects.length === 0 ? (
        <div className={styles["task-list-frame"]}>
          <div className={styles["task-list__label"]}>
            <span>Recent</span>
          </div>
          <div className={styles["task-list"]} role="list" aria-label="Recent">
            {tasks.map(entry)}
          </div>
        </div>
      ) : (
        <div className={styles["task-list-frame"]}>
          <div className={styles["task-list"]}>
            <ProjectGroups
              projects={projects}
              tasks={tasks}
              selectedId={selectedId}
              entry={entry}
              onNewTaskInProject={onNewTaskInProject}
            />
            {recent.length > 0 && (
              <>
                <div
                  className={`${styles["task-list__label"]} ${styles["task-list__label--inline"]}`}
                >
                  <span>Recent</span>
                </div>
                <div
                  className={styles["task-list__group"]}
                  role="list"
                  aria-label="Recent"
                >
                  {recent.map(entry)}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {appUpdate && onRestartToUpdate && (
        <UpdateReady update={appUpdate} onRestart={onRestartToUpdate} />
      )}
      <AppFoot
        modelName={modelName}
        onOpenUsage={onOpenUsage}
        onOpenModel={onOpenModel}
        onOpenSettings={onOpenSettings}
      />
    </aside>
  );
}

/**
 * A conversation's name, open for typing where it stands in the list. Enter
 * or leaving the field keeps what was typed; Escape leaves the name as it was.
 */
function TaskRename({
  title,
  onCommit,
  onCancel,
}: {
  title: string;
  /** Given the name as typed, without the space around it. */
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(title);
  const finished = useRef(false);

  function commit() {
    if (finished.current) return;
    finished.current = true;
    onCommit(value.trim());
  }

  return (
    <input
      className={`${styles["task-row"]} ${styles["task-row--editing"]}`}
      aria-label="Rename conversation"
      autoFocus
      maxLength={160}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        else if (event.key === "Escape") {
          finished.current = true;
          onCancel();
        }
      }}
    />
  );
}

/**
 * The foot of the sidebar, one row: the model that answers, by name, which
 * opens the Model page, then Usage and Settings by their icons. A long name
 * is cut short on the row and said whole when pointed at.
 */
function AppFoot({
  modelName,
  onOpenUsage,
  onOpenModel,
  onOpenSettings,
}: {
  modelName: string | undefined;
  onOpenUsage: (() => void) | undefined;
  onOpenModel: (() => void) | undefined;
  onOpenSettings: (() => void) | undefined;
}) {
  const model = `Model: ${modelName ?? "none chosen"}`;
  return (
    <nav className={styles["app-foot"]} aria-label="Zhiyin">
      <button
        type="button"
        className={styles["app-foot__model"]}
        aria-label={model}
        data-tip={model}
        onClick={onOpenModel}
      >
        <Icon name="cube" />
        {/* The row has little room: a name written "Lab: Model" shows the
            model; the tip says it whole. */}
        <span>
          {modelName?.replace(/^[^:]{1,24}:\s+(?=\S)/, "") ?? "Choose a model"}
        </span>
      </button>
      <button
        type="button"
        aria-label="Usage"
        data-tip="Usage"
        onClick={onOpenUsage}
      >
        <Icon name="usage" />
      </button>
      <button
        type="button"
        aria-label="Settings"
        data-tip="Settings"
        onClick={onOpenSettings}
      >
        <Icon name="settings" />
      </button>
    </nav>
  );
}
