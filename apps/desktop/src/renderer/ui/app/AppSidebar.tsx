import { useEffect, useRef, useState } from "react";
import { Icon, Logo, useDismiss } from "../shared/index.js";
import styles from "./app.module.css";

export type SidebarTask = {
  id: string;
  title: string;
  updatedAt?: string;
  meta?: string;
  /** Saved by an earlier version, and not opened until it is updated. */
  needsUpdate?: boolean;
};

type TaskMenu = {
  id: string;
  mode: "menu" | "delete";
  anchor: {
    top: number;
    bottom: number;
    left: number;
    width: number;
  };
};

function taskMenuPosition(menu: TaskMenu) {
  const gap = 4;
  const viewportGap = 8;
  const height = 112;
  // The delete question holds the conversation's name and two buttons on
  // one line, so it may be wider than the row it belongs to.
  const width = Math.min(
    Math.max(menu.mode === "delete" ? 248 : 160, menu.anchor.width - 14),
    window.innerWidth - viewportGap * 2,
  );
  const below = menu.anchor.bottom + gap;
  const left = Math.min(
    Math.max(viewportGap, menu.anchor.left + 7),
    window.innerWidth - width - viewportGap,
  );
  // Above the row, its bottom edge is pinned to the row however tall it is.
  return below + height <= window.innerHeight - viewportGap
    ? { position: "fixed" as const, top: below, left, width }
    : {
        position: "fixed" as const,
        bottom: window.innerHeight - menu.anchor.top + gap,
        left,
        width,
      };
}

type AppSidebarProps = {
  onOpenLibrary?: () => void;
  tasks: SidebarTask[];
  selectedId: string;
  onSelect: (id: string) => void;
  onNewTask?: () => void;
  onOpenUsage?: () => void;
  onOpenSettings?: () => void;
  onOpenInstructions?: () => void;
  onOpenPreferences?: () => void;
  onRenameTask?: (id: string, title: string) => void | Promise<void>;
  onDeleteTask?: (id: string) => void | Promise<void>;
  onTaskPermissions?: (id: string) => void;
  /** Absent where the app cannot export, and then not offered. */
  onExportConversation?: (id: string) => void;
  /** Asks again about the conversations waiting for an update. */
  onUpdateConversations?: () => void;
  now?: () => Date;
};

function currentTime() {
  return new Date();
}

function relativeAge(task: SidebarTask, now: Date): string {
  if (!task.updatedAt) {
    return task.meta && task.meta !== "Now" ? task.meta : "Earlier";
  }
  const updatedAt = new Date(task.updatedAt);
  const elapsed = now.getTime() - updatedAt.getTime();
  if (!Number.isFinite(elapsed)) return "Earlier";
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(updatedAt);
}

export function AppSidebar({
  onOpenLibrary,
  tasks,
  selectedId,
  onSelect,
  onNewTask,
  onOpenUsage,
  onOpenSettings,
  onOpenInstructions,
  onOpenPreferences,
  onRenameTask,
  onDeleteTask,
  onTaskPermissions,
  onExportConversation,
  onUpdateConversations,
  now = currentTime,
}: AppSidebarProps) {
  const [taskMenu, setTaskMenu] = useState<TaskMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [clock, setClock] = useState(now);
  const taskMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(now()), 60_000);
    return () => window.clearInterval(interval);
  }, [now]);

  useDismiss(Boolean(taskMenu), [taskMenuRef], () => setTaskMenu(null));

  useEffect(() => {
    if (!taskMenu) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setTaskMenu(null);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [taskMenu]);

  /** The menu is placed against the whole row, whichever way it was opened. */
  function openTaskMenu(task: SidebarTask, from: Element) {
    const row = (
      from
        .closest(`.${styles["task-entry"]}`)
        ?.querySelector(`.${styles["task-row"]}`) ?? from
    ).getBoundingClientRect();
    setTaskMenu({
      id: task.id,
      mode: "menu",
      anchor: {
        top: row.top,
        bottom: row.bottom,
        left: row.left,
        width: row.width,
      },
    });
  }

  return (
    <aside className={styles["app-sidebar"]} aria-label="Primary navigation">
      {/* The app's own name, on the same bar as the conversation header. Sized
          to leave air above and below it in a bar that is also as tall as the
          window controls at the far end of it. */}
      <header className={styles["app-sidebar__brand"]}>
        <Logo size={24} />
      </header>

      <button className={styles["new-task"]} type="button" onClick={onNewTask}>
        <Icon name="plus" />
        <span>New task</span>
      </button>

      <nav className={styles["app-nav"]} aria-label="App">
        <button type="button" onClick={onOpenLibrary}>
          <Icon name="plug" />
          <span>Plugins</span>
        </button>
      </nav>

      <div className={styles["task-list"]}>
        <div className={styles["task-list__label"]}>
          <span>Recent</span>
        </div>
        {tasks.map((task) => (
          <div
            className={`${styles["task-entry"]}${taskMenu?.id === task.id ? ` ${styles["task-entry--menu-open"]}` : ""}`}
            key={task.id}
            ref={taskMenu?.id === task.id ? taskMenuRef : undefined}
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
                onClick={() => onSelect(task.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openTaskMenu(task, event.currentTarget);
                }}
              >
                <span>{task.title}</span>
                <small>
                  {task.needsUpdate ? "To update" : relativeAge(task, clock)}
                </small>
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
                task={task}
                menu={taskMenu}
                onClose={() => setTaskMenu(null)}
                onAskDelete={() => setTaskMenu({ ...taskMenu, mode: "delete" })}
                onRename={() => {
                  setTaskMenu(null);
                  setRenamingId(task.id);
                }}
                onPermissions={onTaskPermissions}
                onExport={onExportConversation}
                onDelete={onDeleteTask}
                onUpdate={onUpdateConversations}
              />
            )}
          </div>
        ))}
      </div>

      <AppMenu
        onOpenUsage={onOpenUsage}
        onOpenSettings={onOpenSettings}
        onOpenInstructions={onOpenInstructions}
        onOpenPreferences={onOpenPreferences}
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
 * What can be done with one conversation, opened against its row: its menu,
 * and the question the menu becomes before a deletion. One still waiting for
 * an update offers only that.
 */
function TaskOptions({
  task,
  menu,
  onClose,
  onAskDelete,
  onRename,
  onPermissions,
  onExport,
  onDelete,
  onUpdate,
}: {
  task: SidebarTask;
  menu: TaskMenu;
  onClose: () => void;
  onAskDelete: () => void;
  onRename: () => void;
  onPermissions: AppSidebarProps["onTaskPermissions"];
  onExport: AppSidebarProps["onExportConversation"];
  onDelete: AppSidebarProps["onDeleteTask"];
  onUpdate: AppSidebarProps["onUpdateConversations"];
}) {
  if (menu.mode === "delete")
    return (
      <div
        className={styles["task-delete-confirm"]}
        role="group"
        aria-label={`Delete ${task.title}`}
        style={taskMenuPosition(menu)}
      >
        <strong>Delete “{task.title}”?</strong>
        <div>
          <button type="button" onClick={onClose}>
            Keep
          </button>
          <button
            className={styles["task-delete-confirm__delete"]}
            type="button"
            onClick={() => {
              onClose();
              void onDelete?.(task.id);
            }}
          >
            Delete conversation
          </button>
        </div>
      </div>
    );
  if (task.needsUpdate)
    return (
      // Nothing else can be done with it until it is updated: it is
      // not open, and the store will not write to or remove it.
      <div
        className={styles["task-context-menu"]}
        role="menu"
        style={taskMenuPosition(menu)}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onUpdate?.();
          }}
        >
          Update or delete…
        </button>
      </div>
    );
  return (
    <div
      className={styles["task-context-menu"]}
      role="menu"
      style={taskMenuPosition(menu)}
    >
      <button type="button" role="menuitem" onClick={onRename}>
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onPermissions?.(task.id);
        }}
      >
        Permissions
      </button>
      {onExport && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onExport(task.id);
          }}
        >
          Export…
        </button>
      )}
      <button
        className={styles["task-context-menu__danger"]}
        type="button"
        role="menuitem"
        onClick={onAskDelete}
      >
        Delete
      </button>
    </div>
  );
}

/**
 * The foot of the sidebar, with the menu that opens the app's own pages:
 * usage, the model, custom instructions and settings.
 */
function AppMenu({
  onOpenUsage,
  onOpenSettings,
  onOpenInstructions,
  onOpenPreferences,
}: {
  onOpenUsage: (() => void) | undefined;
  onOpenSettings: (() => void) | undefined;
  onOpenInstructions: (() => void) | undefined;
  onOpenPreferences: (() => void) | undefined;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const appMenuRef = useRef<HTMLDivElement>(null);

  useDismiss(menuOpen, [appMenuRef], () => setMenuOpen(false));

  useEffect(() => {
    if (!menuOpen) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen]);

  return (
    <div className={styles["app-sidebar__profile"]} ref={appMenuRef}>
      <span className={styles["profile-avatar"]}>
        <Icon name="user" />
      </span>
      <span>
        <strong>Your preferences</strong>
      </span>
      <button
        type="button"
        aria-label="Open app menu"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        •••
      </button>
      {menuOpen && (
        <div className={styles["brand-menu"]} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onOpenUsage?.();
            }}
          >
            <Icon name="usage" />
            <span>Usage</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onOpenSettings?.();
            }}
          >
            <Icon name="settings" />
            <span>Model</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onOpenInstructions?.();
            }}
          >
            <Icon name="spark" />
            <span>Custom instructions</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onOpenPreferences?.();
            }}
          >
            <Icon name="sliders" />
            <span>Settings</span>
          </button>
        </div>
      )}
    </div>
  );
}
