import { useState } from "react";
import { Dialog } from "../shared/index.js";
import type { WorkspaceTask } from "./workspaceState.js";
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
  const permissions = task.conversationPermissions;

  return (
    <Dialog
      title="Permissions"
      onClose={onClose}
      className={styles["conversation-permissions"] ?? ""}
    >
      <p className={styles["conversation-permissions__task"]}>{task.title}</p>
      {permissions.length === 0 ? (
        <p>No active permissions for this conversation.</p>
      ) : (
        <ul className={styles["conversation-permissions__list"]}>
          {permissions.map((permission) => {
            return (
              <li key={permission.id}>
                <div>
                  <strong>{permission.label}</strong>
                  <p>
                    {permission.kind !== "connector-tool"
                      ? "May edit files in this folder again in this conversation."
                      : permission.toolName.endsWith("__*")
                        ? "May make these changes again in this conversation."
                        : "May run again in this conversation while the tool stays the same."}
                  </p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  disabled={pending !== undefined}
                  aria-label={`Revoke ${permission.label}`}
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
    </Dialog>
  );
}
