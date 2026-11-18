import { useId, useState } from "react";
import type {
  MemoryOutcome,
  MemoryProject,
  MemoryRequest,
} from "@zhiyin/contract";
import { ConfirmChoice, Icon } from "../shared/index.js";
import styles from "./memory.module.css";

/** A change made, or undefined where it was refused and the page said why. */
type Change = (
  request: MemoryRequest,
) => Promise<Extract<MemoryOutcome, { ok: true }> | undefined>;

/** What the section shows in place of its actions, one at a time. */
type Asking = "rename" | "merge" | "delete" | undefined;

/**
 * A project's own settings, under its memory: the folders whose
 * conversations join it, its name, and merging, archiving or deleting it.
 * Deleting asks first; an archived project can only be brought back.
 */
export function ProjectSettings({
  project,
  others,
  onChange,
  onGone,
}: {
  project: MemoryProject;
  /** The projects it can be merged into. */
  others: readonly MemoryProject[];
  onChange: Change;
  /** The project is no longer kept; `into` is where its memory went. */
  onGone: (into?: string) => void;
}) {
  const [asking, setAsking] = useState<Asking>();
  const headingId = useId();
  const id = project.id;
  return (
    <section
      className={`${styles["memory-section"]} ${styles["memory-project"]}`}
      aria-labelledby={headingId}
    >
      <header>
        <h2 id={headingId}>Project</h2>
      </header>
      <div className={styles["memory-card"]}>
        {project.archived ? (
          <p className={styles["memory-quiet"]}>
            Archived: its memory is kept and found when asked for, but nothing
            of it is sent by itself.
          </p>
        ) : (
          <Folders project={project} onChange={onChange} />
        )}
        {asking === "rename" ? (
          <Rename
            name={project.name}
            onCancel={() => setAsking(undefined)}
            onSave={async (name) => {
              if (await onChange({ kind: "renameProject", id, name }))
                setAsking(undefined);
            }}
          />
        ) : asking === "merge" ? (
          <Merge
            others={others}
            onCancel={() => setAsking(undefined)}
            onMerge={async (into) => {
              if (await onChange({ kind: "mergeProject", from: id, into }))
                onGone(into);
            }}
          />
        ) : asking === "delete" ? (
          <div className={styles["memory-project__ask"]}>
            <ConfirmChoice
              question={`Delete ${project.name}? Its memory moves to the Recycle Bin; its conversations stay.`}
              act="Delete project"
              small
              onKeep={() => setAsking(undefined)}
              onAct={async () => {
                if (await onChange({ kind: "deleteProject", id })) onGone();
              }}
            />
          </div>
        ) : (
          <span className={styles["memory-project__actions"]}>
            {project.archived ? (
              <button
                type="button"
                className="button button--small"
                onClick={() =>
                  void onChange({ kind: "archiveProject", id, archived: false })
                }
              >
                Bring back
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => setAsking("rename")}
                >
                  Rename
                </button>
                {others.length > 0 && (
                  <button
                    type="button"
                    className="button button--small button--quiet"
                    onClick={() => setAsking("merge")}
                  >
                    Merge into…
                  </button>
                )}
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() =>
                    void onChange({
                      kind: "archiveProject",
                      id,
                      archived: true,
                    })
                  }
                >
                  Archive
                </button>
              </>
            )}
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => setAsking("delete")}
            >
              Delete…
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

/** The folders whose conversations join the project, each with Unlink. */
function Folders({
  project,
  onChange,
}: {
  project: MemoryProject;
  onChange: Change;
}) {
  return (
    <div className={styles["memory-project__folders"]}>
      {project.folders.length > 0 ? (
        <ul aria-label="Folders">
          {project.folders.map((folder) => (
            <li key={folder}>
              <Icon name="folder" />
              <span title={folder}>{folder}</span>
              <button
                type="button"
                className="text-button"
                aria-label={`Unlink ${folder}`}
                onClick={() =>
                  void onChange({
                    kind: "unlinkFolder",
                    id: project.id,
                    folder,
                  })
                }
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles["memory-quiet"]}>
          No folder linked. A conversation joins it when moved to it from its
          menu.
        </p>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => void onChange({ kind: "linkFolder", id: project.id })}
      >
        <Icon name="plus" />
        Link a folder…
      </button>
    </div>
  );
}

function Rename({
  name: current,
  onCancel,
  onSave,
}: {
  name: string;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(current);
  return (
    <form
      className={styles["memory-project__ask"]}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(name.trim());
      }}
    >
      <input
        aria-label="Project name"
        autoFocus
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <span className={styles["memory-project__actions"]}>
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button button--small"
          disabled={!name.trim() || name.trim() === current}
        >
          Save
        </button>
      </span>
    </form>
  );
}

function Merge({
  others,
  onCancel,
  onMerge,
}: {
  others: readonly MemoryProject[];
  onCancel: () => void;
  onMerge: (into: string) => Promise<void>;
}) {
  const [into, setInto] = useState(others[0]?.id ?? "");
  const target = others.find((one) => one.id === into);
  return (
    <div className={styles["memory-project__ask"]}>
      <label className={styles["memory-project__merge"]}>
        <span>Merge into</span>
        <select
          aria-label="Merge into"
          value={into}
          onChange={(event) => setInto(event.target.value)}
        >
          {others.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <p className={styles["memory-quiet"]}>
          Its entries and folders join {target.name}, keeping their numbers.
        </p>
      )}
      <span className={styles["memory-project__actions"]}>
        <button
          type="button"
          className="button button--small button--quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!target}
          onClick={() => void onMerge(into)}
        >
          Merge
        </button>
      </span>
    </div>
  );
}
