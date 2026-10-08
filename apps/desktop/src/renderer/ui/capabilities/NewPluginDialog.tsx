import { useState } from "react";
import { Dialog } from "../shared/index.js";
import styles from "./capabilities.module.css";

/** Names and describes a plugin made in the app, before anything is in it. */
export function NewPluginDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function create() {
    setAttempted(true);
    if (!name.trim() || !description.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      await onCreate(name.trim(), description.trim());
    } catch {
      setError("Could not create this plugin. Try a different name.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title="New plugin"
      onClose={onClose}
      footer={
        <button
          className="button button--accent"
          type="submit"
          form="new-plugin-form"
          disabled={pending}
        >
          {pending ? "Creating…" : "Create plugin"}
        </button>
      }
    >
      <form
        id="new-plugin-form"
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          <span>Name</span>
          <input
            aria-label="Name"
            aria-invalid={(attempted && !name.trim()) || undefined}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {attempted && !name.trim() && (
            <small role="alert">Enter a name.</small>
          )}
        </label>
        <label>
          <span>Description</span>
          <textarea
            aria-label="Description"
            aria-invalid={(attempted && !description.trim()) || undefined}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {attempted && !description.trim() && (
            <small role="alert">Add a description.</small>
          )}
        </label>
        {error && (
          <p className={styles["component-editor__error"]} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
