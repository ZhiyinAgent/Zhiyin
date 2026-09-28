import { useState } from "react";
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
  const permissions = task.conversationPermissions ?? [];
  return (
    <div className={styles["conversation-permissions__overlay"]}>
      <section
        className={styles["conversation-permissions"]}
        role="dialog"
        aria-modal="true"
        aria-label={`Permissions for ${task.title}`}
      >
        <header>
          <div>
            <p className="eyebrow">Conversation permissions</p>
            <h2>{task.title}</h2>
          </div>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {permissions.length === 0 ? (
          <p>No ongoing permissions for this conversation.</p>
        ) : (
          <ul>
            {permissions.map((permission) => {
              const actions = (task.actions ?? []).filter(
                (action) => action.approval?.permissionId === permission.id,
              );
              return (
                <li key={permission.id}>
                  <strong>{permission.label}</strong>
                  <p>
                    Given {new Date(permission.at).toLocaleString()} ·{" "}
                    {actions.length}{" "}
                    {actions.length === 1 ? "action" : "actions"}
                  </p>
                  {actions.length > 0 && (
                    <ul>
                      {actions.map((action) => (
                        <li key={action.id}>
                          {action.action} · {action.target}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="button button--quiet"
                    type="button"
                    disabled={pending !== undefined}
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
