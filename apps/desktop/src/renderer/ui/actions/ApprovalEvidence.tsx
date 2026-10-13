import type { FileChange, ToolInvocation } from "@zhiyin/contract";
import { diffLines } from "@zhiyin/contract";
import { ToolCallView } from "./ToolCallView.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

/** The tools that run what they are given as a command. */
const shellTools = /^(bash|sh|shell|powershell|pwsh|run_command)$/i;

/**
 * What exactly will run, be sent or change: the part of a request that is
 * evidence and not a claim. A file change is its files, each opening its
 * difference; a shell command is the command, whole; what a connector is sent
 * leads its own names; anything else is the call's inputs.
 */
export function ApprovalEvidence({
  title,
  target,
  invocation,
  changes,
  disabled,
  onReview,
}: {
  /** The action's name, which a call that says no more is not shown under. */
  title: string;
  target: string;
  invocation: ToolInvocation | undefined;
  changes: readonly FileChange[] | undefined;
  /** A decision is being sent, so no review is opened. */
  disabled: boolean;
  onReview: (path: string) => void;
}) {
  const actionAlreadyNamed = invocation?.name === title && !invocation.via;
  // A command to run is shown as the command itself: the tool that runs it
  // and the field it arrives in are the machine's names, not the person's.
  const shellCommand =
    invocation && shellTools.test(invocation.name)
      ? invocation.arguments.find((argument) => argument.name === "command")
          ?.value
      : undefined;
  return (
    <>
      {/*
        A file whose change cannot be shown as a difference, such as a
        binary scene, says only that it changes. What the call will do is
        then the only account of the change, so it is shown with the files.
      */}
      {changes?.length &&
        changes.every((change) => change.omitted !== undefined) &&
        invocation &&
        !invocation.via &&
        invocation.arguments.length > 0 && (
          <ToolCallView invocation={invocation} hideName />
        )}
      {changes?.length ? (
        <ul
          className={styles["approval__file-list"]}
          aria-label="What will change"
        >
          {/*
            A file change is reviewed as a difference, never as the call
            that would make it. Each row names the file the way a person
            would, and opens that file's review.
          */}
          {changes.map((change) => (
            <li key={change.path}>
              <FileRow
                change={change}
                disabled={disabled}
                onReview={() => onReview(change.path)}
              />
            </li>
          ))}
        </ul>
      ) : shellCommand !== undefined ? (
        <code className={styles.approval__command} aria-label="What will run">
          {shellCommand}
        </code>
      ) : invocation?.via ? (
        <>
          {/* What is sent leads; the connector's own names follow on request. */}
          {invocation.arguments.length === 1 ? (
            <code
              className={styles.approval__command}
              aria-label="What will be sent"
            >
              {invocation.arguments[0]!.value}
            </code>
          ) : (
            invocation.arguments.length > 1 && (
              <ToolCallView invocation={invocation} hideName />
            )
          )}
          <details className={styles.approval__technical}>
            <summary>Technical details</summary>
            <ToolCallView invocation={invocation} />
          </details>
        </>
      ) : invocation ? (
        (!actionAlreadyNamed || invocation.arguments.length > 0) && (
          <ToolCallView invocation={invocation} hideName={actionAlreadyNamed} />
        )
      ) : (
        <code className={styles.approval__command} aria-label="What will run">
          {target}
        </code>
      )}
    </>
  );
}

function FileRow({
  change,
  disabled,
  onReview,
}: {
  change: FileChange;
  disabled: boolean;
  onReview: () => void;
}) {
  const slash = change.path.lastIndexOf("/");
  const name = change.path.slice(slash + 1);
  const folder = slash > 0 ? change.path.slice(0, slash) : undefined;
  const counts =
    change.after === undefined
      ? undefined
      : diffLines(change.before ?? "", change.after);
  return (
    <button
      type="button"
      className={styles.approval__file}
      aria-label={`Review this change to ${name}`}
      disabled={disabled}
      onClick={onReview}
    >
      <span className={styles["approval__file-icon"]} aria-hidden="true">
        <Icon name="file" />
      </span>
      <span className={styles["approval__file-text"]}>
        <span className={styles["approval__file-name"]}>{name}</span>
        <span className={styles["approval__file-meta"]}>
          <span>{changeLabels[change.change]}</span>
          {folder && <span>in {folder}</span>}
          {change.createdFolder && (
            <span>Also creates folder {change.createdFolder}</span>
          )}
          {change.omitted && <span>{change.omitted}</span>}
        </span>
      </span>
      {counts && (
        <span className={styles["approval__file-counts"]}>
          {counts.added > 0 && (
            <span className={styles["approval__file-added"]}>
              +{counts.added}
            </span>
          )}
          {counts.removed > 0 && (
            <span className={styles["approval__file-removed"]}>
              −{counts.removed}
            </span>
          )}
        </span>
      )}
      <span className={styles["approval__file-open"]} aria-hidden="true">
        <Icon name="chevron" />
      </span>
    </button>
  );
}

const changeLabels: Record<FileChange["change"], string> = {
  created: "New file",
  updated: "Edited",
  recycled: "To the Recycle Bin",
  deleted: "Deleted permanently",
};
