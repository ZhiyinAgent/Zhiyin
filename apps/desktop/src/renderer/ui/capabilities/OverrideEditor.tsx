import { useState } from "react";
import type { ComponentContent, ComponentContentDraft } from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import styles from "./capabilities.module.css";

const kindLabel = { skill: "skill", specialist: "specialist" } as const;

/**
 * Edits a skill or specialist a person did not write. The edit is kept beside
 * the plugin, never written into it, so the shipped content stays available:
 * it can be read here and restored at any time.
 */
export function OverrideEditor({
  content,
  onSave,
  onReset,
  onClose,
}: {
  content: ComponentContent;
  onSave: (draft: ComponentContentDraft) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(content.name);
  const [description, setDescription] = useState(content.description);
  const [instructions, setInstructions] = useState(content.instructions);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<"save" | "reset" | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [showingShipped, setShowingShipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSpecialist = content.kind === "specialist";
  const label = kindLabel[content.kind];
  const shipped = content.shipped;

  const nameInvalid = attempted && isSpecialist && !name.trim();
  const descriptionInvalid = attempted && !description.trim();
  const instructionsInvalid = attempted && !instructions.trim();

  async function save() {
    setAttempted(true);
    if (
      (isSpecialist && !name.trim()) ||
      !description.trim() ||
      !instructions.trim()
    )
      return;
    setPending("save");
    setError(null);
    try {
      await onSave({
        ...(isSpecialist ? { name: name.trim() } : {}),
        description: description.trim(),
        instructions: instructions.trim(),
      });
      onClose();
    } catch {
      setError(`Could not save this ${label}.`);
    } finally {
      setPending(null);
    }
  }

  async function reset() {
    setPending("reset");
    setError(null);
    try {
      await onReset();
      onClose();
    } catch {
      setError(`Could not restore the shipped ${label}.`);
      setPending(null);
    }
  }

  return (
    <Dialog
      title={`Edit ${label}`}
      onClose={onClose}
      className={styles["component-editor"] ?? ""}
      footer={
        confirmingReset ? (
          <>
            <span role="alert">
              Discard your edit and use the shipped version?
            </span>
            <button
              className="button"
              type="button"
              disabled={pending !== null}
              onClick={() => setConfirmingReset(false)}
            >
              Keep my edit
            </button>
            <button
              className="button button--accent"
              type="button"
              disabled={pending !== null}
              onClick={() => void reset()}
            >
              {pending === "reset" ? "Restoring…" : "Use shipped version"}
            </button>
          </>
        ) : (
          <>
            {shipped && (
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={() => setConfirmingReset(true)}
              >
                Reset to shipped version
              </button>
            )}
            <button
              className="button button--accent"
              type="submit"
              form="override-editor-form"
              disabled={pending !== null}
            >
              {pending === "save" ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <form
        id="override-editor-form"
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className={styles["component-editor__note"]}>
          {shipped
            ? "You are using your own version. The plugin's version is kept and can be restored."
            : "Your changes are kept separately; the plugin's version stays available to restore."}
        </p>
        {shipped && content.shippedChanged && (
          <p className={styles["component-editor__changed"]} role="status">
            The plugin now ships a different version than the one you edited.
            Review it before deciding which to keep.
          </p>
        )}
        {isSpecialist ? (
          <label>
            <span>Name</span>
            <input
              aria-label="Name"
              aria-invalid={nameInvalid || undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {nameInvalid && <small role="alert">Enter a name.</small>}
          </label>
        ) : (
          <p className={styles["component-editor__identity"]}>
            <span>Name</span>
            <strong>{content.name}</strong>
          </p>
        )}
        <label>
          <span>
            {isSpecialist
              ? "What should it handle?"
              : "When should Zhiyin use it?"}
          </span>
          <textarea
            aria-label={
              isSpecialist
                ? "What should it handle?"
                : "When should Zhiyin use it?"
            }
            aria-invalid={descriptionInvalid || undefined}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {descriptionInvalid && (
            <small role="alert">
              {isSpecialist
                ? "Describe what it handles."
                : "Describe when to use it."}
            </small>
          )}
        </label>
        <label>
          <span>Instructions</span>
          <textarea
            aria-label="Instructions"
            aria-invalid={instructionsInvalid || undefined}
            rows={12}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          {instructionsInvalid && <small role="alert">Add instructions.</small>}
        </label>
        {shipped && (
          <div className={styles["component-editor__shipped"]}>
            <button
              type="button"
              className="button button--small button--quiet"
              aria-expanded={showingShipped}
              onClick={() => setShowingShipped((value) => !value)}
            >
              {showingShipped ? "Hide shipped version" : "Show shipped version"}
            </button>
            {showingShipped && (
              <dl>
                {isSpecialist && (
                  <div>
                    <dt>Name</dt>
                    <dd>{shipped.name}</dd>
                  </div>
                )}
                <div>
                  <dt>Description</dt>
                  <dd>{shipped.description}</dd>
                </div>
                <div>
                  <dt>Instructions</dt>
                  <dd>
                    <pre>{shipped.instructions}</pre>
                  </dd>
                </div>
              </dl>
            )}
          </div>
        )}
        {error && (
          <p className={styles["component-editor__error"]} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
