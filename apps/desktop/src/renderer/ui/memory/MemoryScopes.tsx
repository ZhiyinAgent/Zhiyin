import { useState } from "react";
import { Icon } from "../shared/index.js";
import type { MemoryScope } from "./memory.js";
import styles from "./memory.module.css";

/**
 * The scopes on the left of the Memory page: everything the person does,
 * each project, a new one named in place, the conversations that kept memory
 * for themselves, and the archived projects apart.
 */
export function MemoryScopes({
  scopes,
  conversations,
  archived,
  current,
  onChoose,
  onCreate,
  onOpenFolder,
}: {
  /** Everything the person does first, then each project in use. */
  scopes: readonly MemoryScope[];
  conversations: readonly MemoryScope[];
  archived: readonly MemoryScope[];
  current: string;
  onChoose: (id: string) => void;
  /** Makes a project by its name; says whether it was made. */
  onCreate: (name: string) => Promise<boolean>;
  onOpenFolder: (() => void) | undefined;
}) {
  const [naming, setNaming] = useState(false);
  const [everything, ...projects] = scopes;
  const scope = (one: MemoryScope) => (
    <li key={one.id}>
      <button
        type="button"
        className={styles["memory-scope"]}
        aria-current={one.id === current ? "page" : undefined}
        onClick={() => onChoose(one.id)}
      >
        <strong>{one.name}</strong>
        {one.summary && <span>{one.summary}</span>}
      </button>
    </li>
  );
  return (
    <nav className={styles["memory-scopes"]} aria-label="Scopes">
      <ul>{everything && scope(everything)}</ul>
      <div className={styles["memory-scopes__head"]}>
        <h2 className={styles["memory-scopes__label"]}>Projects</h2>
        <button
          type="button"
          className={styles["memory-scopes__new"]}
          aria-label="New project"
          data-tip="New project"
          onClick={() => setNaming(true)}
        >
          <Icon name="plus" />
        </button>
      </div>
      {(projects.length > 0 || naming) && (
        <ul>
          {projects.map(scope)}
          {naming && (
            <li>
              <NewProject
                onDone={async (name) => {
                  if (!name || (await onCreate(name))) setNaming(false);
                }}
              />
            </li>
          )}
        </ul>
      )}
      {conversations.length > 0 && (
        <>
          <h2 className={styles["memory-scopes__label"]}>Conversations</h2>
          <ul aria-label="Conversations">{conversations.map(scope)}</ul>
        </>
      )}
      {archived.length > 0 && (
        <>
          <h2 className={styles["memory-scopes__label"]}>Archived</h2>
          <ul
            aria-label="Archived"
            className={styles["memory-scopes--archived"]}
          >
            {archived.map(scope)}
          </ul>
        </>
      )}
      {onOpenFolder && (
        <button
          type="button"
          className={`text-button ${styles["memory-folder"]}`}
          onClick={onOpenFolder}
        >
          <Icon name="folder" />
          Open memory folder
        </button>
      )}
    </nav>
  );
}

/**
 * A new project's name, typed where it will stand. Enter makes it; Escape,
 * or leaving it with nothing typed, leaves things as they were.
 */
function NewProject({ onDone }: { onDone: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  return (
    <input
      className={styles["memory-scopes__name"]}
      aria-label="Project name"
      placeholder="Project name"
      autoFocus
      maxLength={80}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        if (!name.trim()) void onDone("");
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") void onDone(name.trim());
        else if (event.key === "Escape") {
          event.stopPropagation();
          void onDone("");
        }
      }}
    />
  );
}
