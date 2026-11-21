import { useState } from "react";
import { Dialog } from "../shared/index.js";
import type { WorkspaceTask } from "@zhiyin/contract";
import styles from "./conversation-dialogs.module.css";

/** The conversation whose grants the dialog lists. */
export type PermissionsConversation = Pick<
  WorkspaceTask,
  "id" | "title" | "conversationPermissions"
>;

type Permission = PermissionsConversation["conversationPermissions"][number];

/**
 * What a grant lets happen again without asking, in the person's words, true
 * of every grant of its kind: what changes files says so, and what only runs
 * a tool or acts on a place says no more than that.
 */
function whatItAllows(permission: Permission): string {
  switch (permission.kind) {
    case "outside-file":
      return "May change this file again in this conversation, until it is changed outside Zhiyin.";
    case "outside-folder":
      return "May create and change files in this folder and the folders in it again in this conversation.";
    case "uncopied-file":
      return "May change this file again in this conversation without a copy kept first, until it is changed outside Zhiyin.";
    case "destination":
      return "May act as you on this place again in this conversation. What can’t be taken back still asks each time.";
    case "reach-host":
      return "Commands in this conversation may connect to this website, and could send it what the conversation can read.";
    case "reach-folder":
      return "Commands in this conversation may read the files in this folder and the folders in it.";
    case "reach-registries":
      return permission.declined
        ? "Commands in this conversation may not reach the package registries and Git hosts Zhiyin lists."
        : "Commands in this conversation may reach the package registries and Git hosts Zhiyin lists, as you confirmed.";
    case "connector-tool":
      return permission.toolName.endsWith("__*")
        ? "What it names may run again in this conversation without asking."
        : "May run again in this conversation while the tool stays the same.";
  }
}

export function ConversationPermissions<
  Conversation extends PermissionsConversation,
>({
  task,
  onClose,
  onRevoke,
}: {
  /** Any conversation: the dialog reads only its grants and name. */
  task: Conversation;
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
                  <p>{whatItAllows(permission)}</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  disabled={pending !== undefined}
                  aria-label={`Take back ${permission.label}`}
                  onClick={async () => {
                    setPending(permission.id);
                    setError(undefined);
                    try {
                      await onRevoke(permission.id);
                    } catch {
                      setError(
                        "Could not take the permission back. Try again.",
                      );
                    } finally {
                      setPending(undefined);
                    }
                  }}
                >
                  {pending === permission.id ? "Taking back…" : "Take back"}
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
