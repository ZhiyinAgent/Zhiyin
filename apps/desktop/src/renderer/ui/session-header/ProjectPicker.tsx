import { useId, useState } from "react";
import type {
  ConversationMemoryChoice,
  MemoryState,
  WorkspaceTask,
} from "@zhiyin/contract";
import {
  isBroadFolder,
  projectHolding,
  projectOfConversation,
} from "@zhiyin/memory-projects";
import { focusMenu, Icon, Menu, usePopover } from "../shared/index.js";
import styles from "./session-header.module.css";

/** A project chosen for a folder no project holds, waiting on one question. */
type Asking = { readonly id: string; readonly name: string };

/**
 * The conversation's project in its header, as a menu (ADR 0026): each
 * project, none, and a new one made from the conversation's folder. Choosing
 * a project for a folder no project holds asks whether that folder joins it
 * too, unless work of every kind passes there.
 */
export function ProjectPicker({
  task,
  memory,
  onChoose,
  onNewProject,
}: {
  task: {
    readonly project?: string | null | undefined;
    /** Its own folder, or the one it works in until it names one. */
    readonly workspace?: WorkspaceTask["workspace"] | undefined;
  };
  memory: MemoryState;
  onChoose: (choice: ConversationMemoryChoice) => void;
  /** Absent where the conversation has no folder to name a project after. */
  onNewProject?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<Asking>();
  const questionId = useId();
  const current = projectOfConversation(task, memory.projects);
  const projects = memory.projects.filter((project) => !project.archived);
  const folder = task.workspace;
  const { close, root, onKeyDown, trigger, toggle, panel } = usePopover({
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) setAsking(undefined);
    },
    onOpened: focusMenu,
    content: asking ? "ask" : "menu",
  });

  /** A folder no project holds, and where work is not of every kind. */
  const asksToLink =
    folder !== undefined &&
    !projectHolding(folder.path, memory.projects) &&
    !isBroadFolder(folder.path, memory.broadFolders);

  const choose = (project: Asking | null) => {
    if (project && asksToLink) setAsking(project);
    else {
      close();
      onChoose({ project: project?.id ?? null });
    }
  };

  return (
    <div className={styles["project-picker"]} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={styles["project-picker__button"]}
        aria-label={`Project: ${current?.name ?? "No project"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => toggle()}
      >
        <span>{current?.name ?? "No project"}</span>
        <Icon name="chevron" />
      </button>
      {open && asking && folder ? (
        <div
          ref={panel}
          className={styles["project-picker__ask"]}
          role="group"
          aria-labelledby={questionId}
        >
          <strong id={questionId}>Link the folder?</strong>
          <p>
            Link {folder.name} to {asking.name} too, so later conversations
            there join it by themselves?
          </p>
          <div>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => {
                close();
                onChoose({ project: asking.id });
              }}
            >
              Only this conversation
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                close();
                onChoose({ project: asking.id, linkFolder: true });
              }}
            >
              Link the folder too
            </button>
          </div>
        </div>
      ) : (
        open && (
          <Menu
            ref={panel}
            className={styles["project-picker__menu"]}
            label="Project"
            opens="down"
          >
            {[...projects, null].map((project) => {
              const checked = (current?.id ?? null) === (project?.id ?? null);
              return (
                <button
                  key={project?.id ?? ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  onClick={() => {
                    if (checked) close();
                    else choose(project);
                  }}
                >
                  <span>{project?.name ?? "No project"}</span>
                  {checked && <Icon name="check" />}
                </button>
              );
            })}
            {onNewProject && (
              <>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onNewProject();
                  }}
                >
                  <span>New project from this conversation</span>
                </button>
              </>
            )}
          </Menu>
        )
      )}
    </div>
  );
}
