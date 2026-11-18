import { useId, useState, type ReactNode } from "react";
import {
  everythingScope,
  type MemoryEntry,
  type MemoryOutcome,
  type MemoryRequest,
  type MemorySection,
  type MemoryState,
  type MemoryWaiting,
} from "@zhiyin/contract";
import {
  Icon,
  LoadingSkeleton,
  SurfacePanel,
  Toggle,
} from "../shared/index.js";
import { MemoryEntryView, type EntryChange } from "./MemoryEntryView.js";
import { MemoryRows } from "./MemoryRows.js";
import { MemoryScopes } from "./MemoryScopes.js";
import { ProjectSettings } from "./ProjectSettings.js";
import { MemoryText } from "./MemoryText.js";
import {
  archivedScopesOf,
  byUse,
  conversationScopesOf,
  isConversationScope,
  roomOf,
  scopesOf,
  searched,
  waitingIn,
  waitingWords,
} from "./memory.js";
import { sectionNames } from "./memoryWords.js";
import styles from "./memory.module.css";

/**
 * Where the page is: a scope's sections, an entry opened from them, or an
 * instruction the person writes for the first time.
 */
type Opened =
  | { readonly number: number; readonly editing: boolean }
  | { readonly scope: string; readonly section: MemorySection };

/** An entry the person removed, and the write that takes it back. */
type Removed = { readonly entry: MemoryEntry; readonly writeId: string };

/**
 * What Zhiyin keeps from one conversation to the next (ADR 0026): the scopes
 * on the left, everything the person does, each project and each conversation
 * that kept memory for itself (ADR 0026); on the right, the
 * chosen scope's sections, one search across all of memory, and an entry
 * opened as a page whose links can be followed and gone back from.
 */
export function MemoryPage({
  memory,
  failure: loadFailure,
  opening,
  onChange,
  onOpenFolder,
  onClose,
}: {
  /** Absent while memory is read. */
  memory: MemoryState | undefined;
  /** Why memory could not be read. */
  failure?: string | undefined;
  /** The entry to open first, in its scope. */
  opening?: number | undefined;
  /** Asks the core for a change; a refusal says why. */
  onChange: (request: MemoryRequest) => Promise<MemoryOutcome>;
  /** Shows the memory folder; absent where it cannot be shown. */
  onOpenFolder?: (() => Promise<void>) | undefined;
  onClose: () => void;
}) {
  const [scopeId, setScopeId] = useState(
    () =>
      memory?.entries.find((entry) => entry.number === opening)?.scope ??
      everythingScope,
  );
  const [trail, setTrail] = useState<readonly Opened[]>(
    opening === undefined ? [] : [{ number: opening, editing: false }],
  );
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<Removed>();
  const [failure, setFailure] = useState("");
  const rememberId = useId();

  /** Makes a change, saying why where it was not made. */
  async function change(
    request: MemoryRequest,
  ): Promise<Extract<MemoryOutcome, { ok: true }> | undefined> {
    setFailure("");
    try {
      const outcome = await onChange(request);
      if (!outcome.ok) setFailure(outcome.reason);
      return outcome.ok ? outcome : undefined;
    } catch (cause) {
      setFailure(
        cause instanceof Error
          ? cause.message
          : "The change was not saved. Try again.",
      );
      return undefined;
    }
  }

  const open = (opened: Opened) => {
    setTrail((before) => [...before, opened]);
    setRemoved(undefined);
  };
  const back = () => setTrail((before) => before.slice(0, -1));
  const chooseScope = (id: string) => {
    setScopeId(id);
    setTrail([]);
    setQuery("");
  };
  const project = memory?.projects.find((one) => one.id === scopeId);

  return (
    <SurfacePanel
      label="Memory"
      eyebrow={<p className="instrument-label">Zhiyin / Memory</p>}
      title="Memory"
      description="What Zhiyin keeps from one conversation to the next, as files on this computer."
      controls={
        memory && (
          <span className={styles["memory-remember"]}>
            <span id={rememberId}>Remember</span>
            <Toggle
              on={memory.on}
              aria-labelledby={rememberId}
              onChange={(on) => void change({ kind: "switch", on })}
            />
          </span>
        )
      }
      closeLabel="Close memory"
      onClose={onClose}
    >
      {!memory ? (
        loadFailure ? (
          <p className={styles["memory-failure"]} role="alert">
            {loadFailure}
          </p>
        ) : (
          <LoadingSkeleton label="Loading memory" />
        )
      ) : (
        <div className={styles["memory-frame"]}>
          <div className={styles["memory-page"]}>
            <MemoryScopes
              scopes={scopesOf(memory)}
              conversations={conversationScopesOf(memory)}
              archived={archivedScopesOf(memory)}
              current={scopeId}
              onChoose={chooseScope}
              onCreate={async (name) => {
                const made = await change({ kind: "createProject", name });
                if (made?.project) chooseScope(made.project.id);
                return made !== undefined;
              }}
              onOpenFolder={
                onOpenFolder &&
                (() =>
                  void onOpenFolder().catch((cause: unknown) =>
                    setFailure(
                      cause instanceof Error
                        ? cause.message
                        : "The memory folder could not be shown.",
                    ),
                  ))
              }
            />
            <div className={styles["memory-main"]}>
              {failure && (
                <p className={styles["memory-failure"]} role="alert">
                  {failure}
                </p>
              )}
              {!memory.on && (
                <p className={styles["memory-off"]}>
                  Memory is off: nothing new is kept, and nothing kept is sent
                  to the model.
                </p>
              )}
              {removed && (
                <p className={styles["memory-deleted"]} role="status">
                  <span>
                    Deleted #{removed.entry.number} {removed.entry.title}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setRemoved(undefined);
                      void change({ kind: "undo", writeId: removed.writeId });
                    }}
                  >
                    Undo
                  </button>
                </p>
              )}
              <Body
                memory={memory}
                scopeId={scopeId}
                trail={trail}
                query={query}
                onQuery={setQuery}
                onOpen={open}
                onBack={back}
                onSave={async (opened, entryChange) => {
                  if ("number" in opened)
                    return (
                      (await change({
                        kind: "edit",
                        number: opened.number,
                        edit: entryChange,
                      })) !== undefined
                    );
                  // Written the first time: once kept, the page shows it.
                  const added = await change({
                    kind: "add",
                    draft: { ...opened, text: entryChange.text },
                  });
                  if (added) back();
                  return added !== undefined;
                }}
                onDelete={(entry) => {
                  setTrail([]);
                  void change({ kind: "remove", number: entry.number }).then(
                    (outcome) =>
                      outcome?.writeId &&
                      setRemoved({ entry, writeId: outcome.writeId }),
                  );
                }}
                onKeep={(waitingId) => void change({ kind: "keep", waitingId })}
                onDiscard={(waitingId) =>
                  void change({ kind: "discard", waitingId })
                }
                onMove={(entry, scope) =>
                  void change({ kind: "move", number: entry.number, scope })
                }
                settings={
                  project && (
                    <ProjectSettings
                      key={project.id}
                      project={project}
                      others={memory.projects.filter(
                        (one) => one.id !== project.id && !one.archived,
                      )}
                      onChange={change}
                      onGone={(into) => chooseScope(into ?? everythingScope)}
                    />
                  )
                }
              />
            </div>
          </div>
        </div>
      )}
    </SurfacePanel>
  );
}

function Body({
  memory,
  scopeId,
  trail,
  query,
  onQuery,
  onOpen,
  onBack,
  onSave,
  onDelete,
  onKeep,
  onDiscard,
  onMove,
  settings,
}: {
  memory: MemoryState;
  scopeId: string;
  trail: readonly Opened[];
  query: string;
  onQuery: (query: string) => void;
  onOpen: (opened: Opened) => void;
  onBack: () => void;
  onSave: (opened: Opened, change: EntryChange) => Promise<boolean>;
  onDelete: (entry: MemoryEntry) => void;
  onKeep: (waitingId: string) => void;
  onDiscard: (waitingId: string) => void;
  onMove: (entry: MemoryEntry, scope: string) => void;
  /** A project's own settings, under its memory. */
  settings: ReactNode;
}) {
  const { entries, limits } = memory;
  const scopes = [
    ...scopesOf(memory),
    ...archivedScopesOf(memory),
    ...conversationScopesOf(memory),
  ];
  const openNumber = (number: number, editing = false) =>
    onOpen({ number, editing });
  const opened = trail.at(-1);
  const page = opened && pageOf(opened, entries);
  if (opened && page) {
    return (
      <MemoryEntryView
        key={`${trail.length}-${page.number}`}
        entry={page}
        draft={!("number" in opened)}
        entries={entries}
        scopes={scopes}
        // An entry moves to everything or a project; another conversation's
        // memory is that conversation's alone.
        movesTo={scopes.filter(
          (one) => !isConversationScope(one.id) || one.id === page.scope,
        )}
        room={roomOf(page, entries, limits)}
        startEditing={"number" in opened ? opened.editing : true}
        onOpen={openNumber}
        onBack={onBack}
        onSave={(change) => onSave(opened, change)}
        onDelete={() => onDelete(page)}
        onMove={(scope) => onMove(page, scope)}
      />
    );
  }

  const found = searched(query, entries);
  const inScope = entries.filter((one) => one.scope === scopeId);
  // How to work comes from the person for everything or a project, never
  // for one conversation.
  const sections: readonly MemorySection[] =
    scopeId === everythingScope
      ? ["about", "how"]
      : isConversationScope(scopeId)
        ? ["brief"]
        : ["brief", "how"];
  const knowledge = byUse(inScope.filter((one) => one.section === "knowledge"));

  return (
    <>
      <label className={styles["memory-search"]}>
        <Icon name="search" />
        <input
          type="search"
          aria-label="Search memory"
          placeholder="Search memory"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              onQuery("");
            }
          }}
        />
      </label>
      {query.trim() ? (
        found.length > 0 ? (
          <MemoryRows
            label="Search results"
            entries={found}
            scopes={scopes}
            showScope
            onOpen={openNumber}
          />
        ) : (
          <p className={styles["memory-quiet"]}>
            Nothing kept matches “{query.trim()}”.
          </p>
        )
      ) : (
        <>
          {entries.length === 0 && (
            <p className={styles["memory-quiet"]}>
              Nothing kept yet. Zhiyin keeps what will matter later as you work,
              and shows each one in the conversation.
            </p>
          )}
          <div className={styles["memory-instructions"]}>
            {sections.map((section) => (
              <InstructionCard
                key={section}
                section={section}
                entry={inScope.find((one) => one.section === section)}
                waiting={waitingIn(memory, scopeId, section)}
                entries={entries}
                onOpen={openNumber}
                onWrite={() => onOpen({ scope: scopeId, section })}
                onKeep={onKeep}
                onDiscard={onDiscard}
              />
            ))}
          </div>
          <section className={styles["memory-section"]}>
            <header>
              <h2>Knowledge</h2>
              <span>
                {knowledge.length} of {limits.knowledge}
              </span>
            </header>
            {knowledge.length > 0 ? (
              <MemoryRows
                label="Knowledge"
                entries={knowledge}
                scopes={scopes}
                onOpen={openNumber}
              />
            ) : (
              <p className={styles["memory-quiet"]}>Nothing kept yet.</p>
            )}
          </section>
          {settings}
        </>
      )}
    </>
  );
}

/**
 * The entry an opened page shows: a kept one, or for an instruction written
 * the first time, one with nothing in it yet.
 */
function pageOf(
  opened: Opened,
  entries: readonly MemoryEntry[],
): MemoryEntry | undefined {
  if ("number" in opened)
    return entries.find((one) => one.number === opened.number);
  return {
    number: 0,
    scope: opened.scope,
    section: opened.section,
    title: sectionNames[opened.section],
    summary: "",
    text: "",
    written: "",
  };
}

/**
 * About the person, how to work or a brief: read in full on the page, with
 * the changes to it that wait for the person; one not written yet says so.
 */
function InstructionCard({
  section,
  entry,
  waiting,
  entries,
  onOpen,
  onWrite,
  onKeep,
  onDiscard,
}: {
  section: MemorySection;
  entry: MemoryEntry | undefined;
  waiting: readonly MemoryWaiting[];
  entries: readonly MemoryEntry[];
  onOpen: (number: number, editing?: boolean) => void;
  onWrite: () => void;
  onKeep: (waitingId: string) => void;
  onDiscard: (waitingId: string) => void;
}) {
  return (
    <section className={styles["memory-section"]}>
      <header>
        <h2>{sectionNames[section]}</h2>
        <button
          type="button"
          className="text-button"
          aria-label={`${entry ? "Edit" : "Write"} ${sectionNames[section]}`}
          onClick={() => (entry ? onOpen(entry.number, true) : onWrite())}
        >
          <Icon name="pencil" />
          {entry ? "Edit" : "Write"}
        </button>
      </header>
      <div className={styles["memory-card"]}>
        {entry ? (
          <MemoryText text={entry.text} entries={entries} onOpen={onOpen} />
        ) : (
          <p className={styles["memory-quiet"]}>Nothing written yet.</p>
        )}
        {waiting.map((change) => (
          <WaitingChange
            key={change.id}
            change={change}
            onKeep={onKeep}
            onDiscard={onDiscard}
          />
        ))}
      </div>
    </section>
  );
}

/** A change the model asked for after reading outside content. */
function WaitingChange({
  change,
  onKeep,
  onDiscard,
}: {
  change: MemoryWaiting;
  onKeep: (waitingId: string) => void;
  onDiscard: (waitingId: string) => void;
}) {
  const labelId = useId();
  return (
    <div
      className={styles["memory-waiting"]}
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId} className={styles["memory-waiting__label"]}>
        Waiting for you
      </span>
      <p>{waitingWords(change)}</p>
      <span className={styles["memory-waiting__foot"]}>
        <span>From “{change.conversation.title}”</span>
        <span className={styles["memory-waiting__actions"]}>
          <button
            type="button"
            className="button button--small button--quiet"
            onClick={() => onDiscard(change.id)}
          >
            Discard
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => onKeep(change.id)}
          >
            Keep
          </button>
        </span>
      </span>
    </div>
  );
}
