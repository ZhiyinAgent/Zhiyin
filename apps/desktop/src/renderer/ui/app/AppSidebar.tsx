import { useEffect, useRef, useState } from "react";
import { Icon, Logo } from "../shared/index.js";
import styles from "./app.module.css";

export type SidebarTask = {
  id: string;
  title: string;
  updatedAt?: string;
  meta?: string;
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
  const height = menu.mode === "menu" ? 76 : 112;
  const width = Math.max(
    160,
    Math.min(menu.anchor.width - 14, window.innerWidth - viewportGap * 2),
  );
  const below = menu.anchor.bottom + gap;
  const top =
    below + height <= window.innerHeight - viewportGap
      ? below
      : Math.max(viewportGap, menu.anchor.top - height - gap);
  const left = Math.min(
    Math.max(viewportGap, menu.anchor.left + 7),
    window.innerWidth - width - viewportGap,
  );
  return { position: "fixed" as const, top, left, width };
}

type AppSidebarProps = {
  onOpenLibrary?: () => void;
  tasks: SidebarTask[];
  selectedId: string;
  onSelect: (id: string) => void;
  onNewTask?: () => void;
  onSearch?: () => void;
  onTaskListOptions?: () => void;
  onOpenSkills?: () => void;
  onOpenAgents?: () => void;
  onOpenMcp?: () => void;
  onOpenUsage?: () => void;
  onOpenEvidence?: () => void;
  onOpenSettings?: () => void;
  onRenameTask?: (id: string, title: string) => void | Promise<void>;
  onDeleteTask?: (id: string) => void | Promise<void>;
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
  onSearch,
  onTaskListOptions,
  onOpenSkills,
  onOpenAgents,
  onOpenMcp,
  onOpenUsage,
  onOpenEvidence,
  onOpenSettings,
  onRenameTask,
  onDeleteTask,
  now = currentTime,
}: AppSidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskMenu, setTaskMenu] = useState<TaskMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [clock, setClock] = useState(now);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const renameFinished = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(now()), 60_000);
    return () => window.clearInterval(interval);
  }, [now]);

  useEffect(() => {
    if (!taskMenu) return;
    function close(event: PointerEvent) {
      if (!taskMenuRef.current?.contains(event.target as Node)) {
        setTaskMenu(null);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setTaskMenu(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [taskMenu]);

  function startRename(task: SidebarTask) {
    setTaskMenu(null);
    setRenamingId(task.id);
    setRenameValue(task.title);
    renameFinished.current = false;
  }

  function commitRename(task: SidebarTask) {
    if (renameFinished.current) return;
    renameFinished.current = true;
    const title = renameValue.trim();
    setRenamingId(null);
    if (title && title !== task.title) void onRenameTask?.(task.id, title);
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
        {onOpenLibrary ? (
          <button type="button" onClick={onOpenLibrary}>
            <Icon name="plug" />
            <span>Plugins</span>
          </button>
        ) : (
          <>
            {onSearch && (
              <button type="button" onClick={onSearch}>
                <Icon name="search" />
                <span>Search</span>
              </button>
            )}
            <button type="button" onClick={onOpenSkills}>
              <Icon name="spark" />
              <span>Skills</span>
            </button>
            <button type="button" aria-label="Agents" onClick={onOpenAgents}>
              <Icon name="users" />
              <span>Agents</span>
            </button>
            <button type="button" aria-label="MCP servers" onClick={onOpenMcp}>
              <Icon name="globe" />
              <span>MCP</span>
            </button>
          </>
        )}
      </nav>

      <div className={styles["task-list"]}>
        <div className={styles["task-list__label"]}>
          <span>Recent</span>
          {onTaskListOptions && (
            <button
              type="button"
              aria-label="Task list options"
              onClick={onTaskListOptions}
            >
              •••
            </button>
          )}
        </div>
        {tasks.map((task) => (
          <div
            className={styles["task-entry"]}
            key={task.id}
            ref={taskMenu?.id === task.id ? taskMenuRef : undefined}
          >
            {renamingId === task.id ? (
              <input
                className={`${styles["task-row"]} ${styles["task-row--editing"]}`}
                aria-label="Rename conversation"
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => commitRename(task)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename(task);
                  else if (event.key === "Escape") {
                    renameFinished.current = true;
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <button
                className={styles["task-row"]}
                type="button"
                aria-current={task.id === selectedId ? "page" : undefined}
                onClick={() => onSelect(task.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const row = event.currentTarget.getBoundingClientRect();
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
                }}
              >
                <span>{task.title}</span>
                <small>{relativeAge(task, clock)}</small>
              </button>
            )}

            {taskMenu?.id === task.id && taskMenu.mode === "menu" && (
              <div
                className={styles["task-context-menu"]}
                role="menu"
                style={taskMenuPosition(taskMenu)}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => startRename(task)}
                >
                  Rename
                </button>
                <button
                  className={styles["task-context-menu__danger"]}
                  type="button"
                  role="menuitem"
                  onClick={() => setTaskMenu({ ...taskMenu, mode: "delete" })}
                >
                  Delete
                </button>
              </div>
            )}

            {taskMenu?.id === task.id && taskMenu.mode === "delete" && (
              <div
                className={styles["task-delete-confirm"]}
                role="group"
                aria-label={`Delete ${task.title}`}
                style={taskMenuPosition(taskMenu)}
              >
                <strong>Delete this conversation?</strong>
                <div>
                  <button type="button" onClick={() => setTaskMenu(null)}>
                    Keep
                  </button>
                  <button
                    className={styles["task-delete-confirm__delete"]}
                    type="button"
                    onClick={() => {
                      setTaskMenu(null);
                      void onDeleteTask?.(task.id);
                    }}
                  >
                    Delete conversation
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles["app-sidebar__profile"]}>
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
                onOpenEvidence?.();
              }}
            >
              <Icon name="lock" />
              <span>Evidence & recovery</span>
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
              <span>Settings</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
