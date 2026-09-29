import { useEffect, useId, useRef } from "react";
import type { ActionDetail, CoreApi, TaskAction } from "@zhiyin/contract";
import { ChangeReview } from "./ChangeReview.js";
import { ToolCallView } from "./ToolCallView.js";
import { JsonBlock } from "./JsonBlock.js";
import { ResultImage } from "./ResultImage.js";
import styles from "./actions.module.css";

/**
 * What an action did, opened from the record of it having happened.
 *
 * The same question the permission request asked, asked again afterwards, and
 * answered the same way: the difference a change made, the text a command
 * printed, the places a search found something. Before this, the answer was
 * the call and the raw result — `write_file({"path":…,"text":…})` and a
 * blob of JSON — which is the tool's own language, not an account of what
 * happened to somebody's files.
 *
 * The reason a status carries is not repeated here: the record it was opened
 * from already says it, and "the command exited with code 1" above an exit
 * code of 1 is the same sentence twice.
 *
 * Nothing here knows what any particular tool is. Each shape is drawn as the
 * shape it says it is, and a tool that offered none falls back to the record
 * that was always kept. Switching on tool names would put a table of every
 * built-in in the interface and would hand a remote tool the same rendering
 * for choosing the same name.
 */
export function ActionInspector({
  action,
  readPicture,
  onClose,
}: {
  action: TaskAction;
  readPicture?: NonNullable<CoreApi["readPicture"]>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const described = Boolean(action.changes?.length || action.details?.length);
  const repeated = alreadySays(action);

  useEffect(() => {
    const returnTo = document.activeElement;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles["diff-modal__scrim"]}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles["diff-modal"]}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialog}
      >
        <header className={styles["diff-modal__header"]}>
          <h2 id={titleId}>{action.action}</h2>
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className={styles["diff-modal__body"]}>
          {/*
            The same three things the permission request led with, in the same
            order: what it would do, what it can reach, and what Zhiyin said it
            was for. Coming back to an action later should show what was agreed
            to, not just that something happened.
          */}
          {action.description && (
            <p className={styles.inspector__lead}>{action.description}</p>
          )}
          {action.detail && (
            <p className={styles.inspector__consequence}>{action.detail}</p>
          )}
          {action.claim && (
            <p className={styles.inspector__claim}>
              <span>Zhiyin said this was for</span>
              {action.claim}
            </p>
          )}

          {/*
            Only when nothing below already says it. A shell command and a
            written file are named again by the tool's own account, and showing
            the target above that is the same string twice — at full length,
            for a command. A skill's instructions never name the skill, so
            there the row is the only thing identifying what was read.
          */}
          {!repeated && (
            <p className={styles["change-review__summary"]}>
              <span className={styles["change-review__path"]}>
                {action.target}
              </span>
            </p>
          )}

          {action.changes?.map((change) => (
            <ChangeReview
              key={change.path}
              change={change}
              omittedNote="What it did is recorded, but its contents are not kept here."
            />
          ))}

          {action.details?.map((detail, index) => (
            <DetailBlock
              key={index}
              detail={detail}
              {...(readPicture ? { readPicture } : {})}
            />
          ))}

          {/*
            What was asked for is always shown, whatever the tool. Before this
            an MCP call appeared as its own encoded string under a heading
            saying it was what the tool returned — so the one thing a reader
            most needs, the arguments, was both mislabelled and unreadable.
          */}
          {action.invocation && (
            <ToolCallView
              invocation={action.invocation}
              label="What was asked for"
            />
          )}

          {described && (action.evidence || action.command) && (
            <details className={styles.inspector__raw}>
              <summary>Technical details</summary>
              {action.command && <pre>{action.command}</pre>}
              {action.evidence && (
                <JsonBlock
                  text={action.evidence}
                  className={styles.inspector__json}
                />
              )}
            </details>
          )}

          {/*
            The answer, kept separate from the request. Only for a tool that
            described nothing in words — then this is the only record there is.

            An action recorded before calls were kept as structure has no
            invocation, and its rendered call is the only account of what was
            asked for. It stays here rather than being dropped: an old record
            losing the one thing it knew would be worse than an ugly one.
          */}
          {!described &&
            (action.evidence || (!action.invocation && action.command)) && (
              <details className={styles.inspector__raw}>
                <summary>What the tool returned</summary>
                {!action.invocation && action.command && (
                  <pre>{action.command}</pre>
                )}
                {action.policy && <p>{action.policy}</p>}
                {action.evidence && (
                  <JsonBlock
                    text={action.evidence}
                    className={styles.inspector__json}
                  />
                )}
              </details>
            )}
          {!described &&
            !action.evidence &&
            !action.command &&
            action.policy && (
              <p className={styles.inspector__note}>{action.policy}</p>
            )}
        </div>
      </div>
    </div>
  );
}

/**
 * Whether the tool's own account already names what was acted on.
 *
 * Compared as content, never by tool name: a value said twice is noise
 * whoever produced it, and a rule that knew which tools repeat themselves
 * would be wrong the moment one changed its mind.
 */
function alreadySays(action: TaskAction): boolean {
  // Whitespace-insensitive, because a target is a one-line rendering of
  // something that may have had newlines in it. A shell command written across
  // twelve lines is the same command as the single line naming the action, and
  // showing both is showing it twice.
  const same = (value: string) =>
    value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[“"'`]|[”"'`]$/g, "");
  const target = same(action.target);
  if (!target) return false;
  if (action.changes?.some((change) => same(change.path) === target))
    return true;
  return Boolean(
    action.details?.some((detail) =>
      detail.kind === "facts"
        ? detail.items.some((item) => same(item.value) === target)
        : detail.kind === "text"
          ? same(detail.text) === target
          : false,
    ),
  );
}

function DetailBlock({
  detail,
  readPicture,
}: {
  detail: ActionDetail;
  readPicture?: NonNullable<CoreApi["readPicture"]>;
}) {
  if (detail.kind === "image")
    return (
      <ResultImage detail={detail} {...(readPicture ? { readPicture } : {})} />
    );

  if (detail.kind === "facts")
    return (
      <dl className={styles.inspector__facts}>
        {detail.items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    );

  if (detail.kind === "text")
    return (
      <section className={styles.inspector__block}>
        <h3>{detail.label}</h3>
        <pre>{detail.text}</pre>
        {detail.truncated && (
          <p className={styles.inspector__note}>
            Only the beginning is shown here.
          </p>
        )}
      </section>
    );

  if (detail.kind === "list")
    return (
      <section className={styles.inspector__block}>
        <h3>{detail.label}</h3>
        <ul className={styles.inspector__list}>
          {detail.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {detail.truncated && (
          <p className={styles.inspector__note}>There were more than these.</p>
        )}
      </section>
    );

  return (
    <section className={styles.inspector__block}>
      <h3>
        {detail.items.length === 1
          ? "1 match"
          : `${detail.items.length} matches`}
      </h3>
      {detail.items.length > 0 && (
        <table className={styles.inspector__matches}>
          <tbody>
            {detail.items.map((item, index) => (
              <tr key={`${item.path}-${item.line}-${index}`}>
                <td className={styles.inspector__where}>
                  {item.path}
                  <span className={styles.inspector__line}>:{item.line}</span>
                </td>
                <td>
                  <code>{item.text}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail.truncated && (
        <p className={styles.inspector__note}>
          Stopped after these; there may be more.
        </p>
      )}
      {detail.note && <p className={styles.inspector__note}>{detail.note}</p>}
    </section>
  );
}
