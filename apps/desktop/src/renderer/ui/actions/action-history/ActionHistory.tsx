import { useState } from "react";
import type { CoreApi, TaskAction } from "@zhiyin/contract";
import { ActionKind } from "../ActionCard.js";
import { ActionInspector } from "./ActionInspector.js";
import { actionKind } from "../actionFacts.js";
import { actionTitle } from "../actionTitle.js";
import { accountOf, statusWords } from "../actionWords.js";
import { Icon, ModelSays, visibleText } from "../../shared/index.js";
import styles from "./action-history.module.css";

/**
 * The actions of a turn as they stand: running, done, or failed, denied or
 * blocked, each the same card the action showed while it asked, as a row.
 * What was done, and on what, leads in Zhiyin's words, beside the kind of
 * action; under it, the marks of what it does and what the AI said of it,
 * attributed to it.
 */
export function ActionHistory({
  actions,
  readPicture,
  onOpenPermission,
}: {
  actions: readonly TaskAction[];
  readPicture?: NonNullable<CoreApi["readPicture"]> | undefined;
  onOpenPermission?: ((permissionId: string) => void) | undefined;
}) {
  const [inspecting, setInspecting] = useState<string>();
  const open = actions.find((action) => action.id === inspecting);

  if (actions.length === 0) return null;

  return (
    <section
      className={styles["action-history"]}
      role="region"
      aria-label="Action history"
    >
      <ul>
        {actions.map((action) => {
          const status = statusWords[action.status];
          const title = actionTitle(action);
          const shownTarget = action.target && visibleText(action.target);
          const target =
            shownTarget &&
            !title.toLocaleLowerCase().includes(shownTarget.toLocaleLowerCase())
              ? shownTarget
              : undefined;
          const account = accountOf({
            description: action.description,
            descriptionByModel: action.descriptionBy === "model",
            claim: action.claim,
          });
          const permissionId = action.approval?.permissionId;
          const inspectable = Boolean(
            action.command ||
            action.evidence ||
            action.changes?.length ||
            action.details?.length,
          );
          return (
            <li
              className={`${styles["action-history__item"]} ${styles[`action-history__item--${action.status}`]}`}
              key={action.id}
            >
              <span
                className={styles["action-history__marker"]}
                role={action.status === "completed" ? "img" : undefined}
                aria-label={
                  action.status === "completed" ? status.label : undefined
                }
              >
                <ActionKind
                  record={action.status}
                  name={actionKind({
                    effects: action.effects,
                    changes: action.changes,
                    connector: Boolean(action.toolName?.startsWith("mcp_")),
                  })}
                />
              </span>
              <span className={styles["action-history__content"]}>
                <span className={styles["action-history__summary"]}>
                  <strong>{title}</strong>
                  {target && (
                    <span className={styles["action-history__target"]}>
                      {target}
                    </span>
                  )}
                  {action.approval?.by === "conversation-permission" &&
                    (onOpenPermission && permissionId ? (
                      <button
                        className={styles["action-history__permission"]}
                        type="button"
                        aria-label="Allowed for this conversation. Open permissions"
                        data-tip="Allowed for this conversation"
                        onClick={() => onOpenPermission(permissionId)}
                      >
                        <Icon name="info" />
                      </button>
                    ) : (
                      <span
                        className={styles["action-history__permission"]}
                        role="img"
                        aria-label="Allowed for this conversation"
                        data-tip="Allowed for this conversation"
                        tabIndex={0}
                      >
                        <Icon name="info" />
                      </span>
                    ))}
                  {action.status !== "completed" && (
                    <span className={styles["action-history__status"]}>
                      <Icon name={status.icon} />
                      {status.label}
                    </span>
                  )}
                  {inspectable && (
                    <button
                      className={`text-button ${styles["action-history__inspect"]}`}
                      type="button"
                      aria-label="Inspect action"
                      onClick={() => setInspecting(action.id)}
                    >
                      Details
                    </button>
                  )}
                </span>
                {(account.ours || account.model) && (
                  <span className={styles["action-history__about"]}>
                    {account.ours && (
                      <span className={styles["action-history__account"]}>
                        {visibleText(account.ours)}
                      </span>
                    )}
                    {account.model && (
                      <ModelSays className={styles["action-history__account"]}>
                        {visibleText(account.model)}
                      </ModelSays>
                    )}
                  </span>
                )}
                {action.reason && (
                  <span className={styles["action-history__reason"]}>
                    {visibleText(action.reason)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {open && (
        <ActionInspector
          readPicture={readPicture}
          action={open}
          onClose={() => setInspecting(undefined)}
        />
      )}
    </section>
  );
}
