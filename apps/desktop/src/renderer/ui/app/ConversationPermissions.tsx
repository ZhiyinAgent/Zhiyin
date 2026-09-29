import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceTask } from "./workspaceState.js";
import { permissionTitle } from "./permissionTitle.js";
import styles from "./app.module.css";

export function ConversationPermissions({
  task,
  onClose,
  onRevoke,
}: {
  task: WorkspaceTask;
  onClose: () => void;
  onRevoke: (permissionId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  const permissions = task.conversationPermissions ?? [];

  useEffect(() => {
    const returnTo = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, []);

  return (
    <div
      className={styles["conversation-permissions__overlay"]}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={styles["conversation-permissions"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const buttons = [
            ...dialog.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const first = buttons[0];
          const last = buttons.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header>
          <div>
            <h2 id={titleId}>Permissions</h2>
            <p className={styles["conversation-permissions__task"]}>
              {task.title}
            </p>
          </div>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {permissions.length === 0 ? (
          <p>No active permissions for this conversation.</p>
        ) : (
          <ul>
            {permissions.map((permission) => {
              return (
                <li key={permission.id}>
                  <div>
                    <strong>{permissionTitle(permission)}</strong>
                    <p>
                      {permission.kind === "connector-tool"
                        ? "May use this tool version again in this conversation."
                        : "May edit files in this folder again in this conversation."}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    disabled={pending !== undefined}
                    aria-label={`Revoke ${permissionTitle(permission)}`}
                    onClick={async () => {
                      setPending(permission.id);
                      setError(undefined);
                      try {
                        await onRevoke(permission.id);
                      } catch {
                        setError("Could not revoke the permission. Try again.");
                      } finally {
                        setPending(undefined);
                      }
                    }}
                  >
                    {pending === permission.id ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
