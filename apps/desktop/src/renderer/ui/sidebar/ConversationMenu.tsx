import { useState, type Ref } from "react";
import { ConfirmChoice, counted, Icon, Menu } from "../shared/index.js";
import type {
  DeleteConversation,
  SidebarProject,
  SidebarTask,
} from "./AppSidebar.js";
import styles from "./sidebar.module.css";

/**
 * One conversation's menu, open against its row: the menu itself, the
 * projects it can move to, or the question before a deletion.
 */
export type TaskMenu = {
  id: string;
  mode: "menu" | "move" | "delete";
};

/**
 * What can be done with one conversation, opened against its row: its menu,
 * the projects it can move to, and the question the menu becomes before a
 * deletion. One still waiting for an update offers only that. Where it is
 * placed is its opener's; `ref` is what is placed.
 */
export function TaskOptions({
  ref,
  task,
  menu,
  projects,
  onClose,
  onMode,
  onRename,
  onPermissions,
  onExport,
  onDelete,
  onUpdate,
  onMove,
  onKeepNothing,
}: {
  ref: Ref<HTMLDivElement>;
  task: SidebarTask;
  menu: TaskMenu;
  projects: readonly SidebarProject[];
  onClose: () => void;
  onMode: (mode: TaskMenu["mode"]) => void;
  onRename: () => void;
  onPermissions: ((id: string) => void) | undefined;
  onExport: ((id: string) => void) | undefined;
  onDelete: DeleteConversation | undefined;
  onUpdate: (() => void) | undefined;
  /** Puts the conversation in a project, or in none. */
  onMove: ((id: string, project: string | null) => void) | undefined;
  /** Keeps nothing from the conversation, or keeps again. */
  onKeepNothing: ((id: string, off: boolean) => void) | undefined;
}) {
  const own = task.kept?.own ?? 0;
  const general = task.kept?.general ?? 0;
  // What a conversation kept for itself serves no other, so forgetting it is
  // offered ticked; what it kept for others is the person's to keep.
  const [forgetOwn, setForgetOwn] = useState(true);
  const [forgetGeneral, setForgetGeneral] = useState(false);
  const moves = onMove && projects.length > 0;
  const act = (action: () => void) => () => {
    onClose();
    action();
  };
  if (menu.mode === "delete")
    return (
      <div
        ref={ref}
        className={styles["task-delete-confirm"]}
        role="group"
        aria-label={`Delete ${task.title}`}
      >
        <ConfirmChoice
          question={`Delete “${task.title}”?`}
          act="Delete conversation"
          small
          onKeep={onClose}
          onAct={act(() => {
            const forget = {
              ...(own > 0 && forgetOwn ? { own: true as const } : {}),
              ...(general > 0 && forgetGeneral
                ? { general: true as const }
                : {}),
            };
            void (forget.own || forget.general
              ? onDelete?.(task.id, forget)
              : onDelete?.(task.id));
          })}
        >
          {own > 0 && (
            <label className={styles["task-delete-confirm__forget"]}>
              <input
                type="checkbox"
                checked={forgetOwn}
                onChange={(event) => setForgetOwn(event.target.checked)}
              />
              Forget the {counted(own, "entry", "entries")} it kept for itself
            </label>
          )}
          {general > 0 && (
            <label className={styles["task-delete-confirm__forget"]}>
              <input
                type="checkbox"
                checked={forgetGeneral}
                onChange={(event) => setForgetGeneral(event.target.checked)}
              />
              {own > 0 ? "Also forget" : "Forget"} the{" "}
              {counted(general, "entry", "entries")} it kept for other
              conversations
            </label>
          )}
        </ConfirmChoice>
      </div>
    );
  if (task.needsUpdate)
    return (
      // Nothing else can be done with it until it is updated: it is
      // not open, and the store will not write to or remove it.
      <Menu ref={ref} className={styles["task-context-menu"]}>
        <button type="button" role="menuitem" onClick={act(() => onUpdate?.())}>
          Update or delete…
        </button>
      </Menu>
    );
  if (menu.mode === "move" && onMove)
    return (
      <Menu
        ref={ref}
        className={styles["task-context-menu"]}
        label="Move to project"
      >
        {[...projects, { id: null, name: "No project" }].map((project) => {
          const current = (task.projectId ?? null) === project.id;
          return (
            <button
              key={project.id ?? ""}
              type="button"
              role="menuitemradio"
              aria-checked={current}
              onClick={act(() => {
                if (!current) onMove(task.id, project.id);
              })}
            >
              <span>{project.name}</span>
              {current && <Icon name="check" />}
            </button>
          );
        })}
      </Menu>
    );
  return (
    <Menu ref={ref} className={styles["task-context-menu"]}>
      <button type="button" role="menuitem" onClick={onRename}>
        Rename
      </button>
      {moves && (
        <button type="button" role="menuitem" onClick={() => onMode("move")}>
          Move to project…
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={act(() => onPermissions?.(task.id))}
      >
        Permissions
      </button>
      {onExport && (
        <button
          type="button"
          role="menuitem"
          onClick={act(() => onExport(task.id))}
        >
          Export…
        </button>
      )}
      {onKeepNothing && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={task.memoryOff === true}
          onClick={act(() => onKeepNothing(task.id, !task.memoryOff))}
        >
          <span>Don't remember</span>
          {task.memoryOff && <Icon name="check" />}
        </button>
      )}
      {/* Apart from the rest, so it is never taken for its neighbour. */}
      <hr />
      <button
        type="button"
        role="menuitem"
        data-danger
        onClick={() => onMode("delete")}
      >
        Delete
      </button>
    </Menu>
  );
}
