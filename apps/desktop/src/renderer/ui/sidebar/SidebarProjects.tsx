import { useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import type { SidebarProject, SidebarTask } from "./AppSidebar.js";
import styles from "./sidebar.module.css";

/** A project's conversations shown before the rest are asked for. */
const shownAtFirst = 5;

/**
 * The projects above the recent conversations, each a row that opens to its
 * own conversations (ADR 0026). The project holding the open conversation is
 * open; the others open on their row. Projects come in the order of their
 * latest conversation, so the work under way stays at the top.
 */
export function ProjectGroups({
  projects,
  tasks,
  selectedId,
  entry,
  onNewTaskInProject,
}: {
  projects: readonly SidebarProject[];
  tasks: readonly SidebarTask[];
  selectedId: string;
  entry: (task: SidebarTask) => ReactNode;
  onNewTaskInProject?: ((projectId: string) => void) | undefined;
}) {
  // What the person opened or closed; the rest follow the open conversation.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const [showingAll, setShowingAll] = useState<ReadonlySet<string>>(new Set());

  const groups = projects
    .map((project, index) => {
      const own = tasks.filter((task) => task.projectId === project.id);
      return { project, own, latest: latestOf(own), index };
    })
    .sort(
      (one, other) =>
        other.latest.localeCompare(one.latest) || one.index - other.index,
    );

  return (
    <>
      <div className={styles["task-list__label"]}>
        <span>Projects</span>
      </div>
      <div className={styles["project-list"]} role="list" aria-label="Projects">
        {groups.map(({ project, own }) => {
          const open =
            toggled.get(project.id) ??
            own.some((task) => task.id === selectedId);
          const shown = showingAll.has(project.id)
            ? own
            : own.slice(0, shownAtFirst);
          const more = own.length - shown.length;
          return (
            <div key={project.id} role="listitem">
              <div className={styles["project__row"]}>
                <button
                  type="button"
                  className={styles["project__toggle"]}
                  aria-expanded={open}
                  onClick={() =>
                    setToggled((before) =>
                      new Map(before).set(project.id, !open),
                    )
                  }
                >
                  <Icon name="chevron" />
                  <span>{project.name}</span>
                  {!open && own.length > 0 && <small>{own.length}</small>}
                </button>
                {onNewTaskInProject && (
                  <button
                    type="button"
                    className={styles["project__new"]}
                    aria-label={`New conversation in ${project.name}`}
                    onClick={() => onNewTaskInProject(project.id)}
                  >
                    <Icon name="plus" />
                  </button>
                )}
              </div>
              {open &&
                (own.length === 0 ? (
                  <p className={styles["project__empty"]}>
                    No conversations yet
                  </p>
                ) : (
                  <>
                    <div
                      className={styles["project__tasks"]}
                      role="list"
                      aria-label={project.name}
                    >
                      {shown.map(entry)}
                    </div>
                    {more > 0 && (
                      <button
                        type="button"
                        className={`text-button ${styles["project__more"]}`}
                        onClick={() =>
                          setShowingAll((before) =>
                            new Set(before).add(project.id),
                          )
                        }
                      >
                        Show {more} more
                      </button>
                    )}
                  </>
                ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** When a project's latest conversation moved; empty when it has none. */
function latestOf(tasks: readonly SidebarTask[]): string {
  return tasks.reduce(
    (latest, task) =>
      task.updatedAt && task.updatedAt > latest ? task.updatedAt : latest,
    "",
  );
}
