import type {
  FileChange,
  ToolArgument,
  ToolInvocation,
} from "@zhiyin/contract";
import { ToolCallView } from "../ToolCallView.js";
import { codeLines, readOnItsOwn } from "../change-review/CodeReview.js";
import { lineCounts } from "../change-review/lineCounts.js";
import { changeWords, moveWords, shownKind } from "../actionWords.js";
import { Icon, visibleText } from "../../shared/index.js";
import common from "../actions.module.css";
import styles from "./approvals.module.css";

/**
 * What exactly will run, be sent or change: the part of a request that is
 * evidence and not a claim. A file change is its files, each opening its
 * difference; a command a built-in tool runs is the command, whole, with its
 * other inputs under it; what a connector is sent leads its own names;
 * anything else is the call's inputs. Nothing here goes by a tool's name: a
 * connector may call its tool anything.
 */
export function ApprovalEvidence({
  title,
  target,
  invocation,
  changes,
  disabled,
  onReview,
  onReviewCode,
}: {
  /** The action's name, which a call that says no more is not shown under. */
  title: string;
  target: string;
  invocation: ToolInvocation | undefined;
  changes: readonly FileChange[] | undefined;
  /** A decision is being sent, so no review is opened. */
  disabled: boolean;
  onReview: (path: string) => void;
  /** Opens the review of code too long to read on the card. */
  onReviewCode: () => void;
}) {
  const actionAlreadyNamed = invocation?.name === title && !invocation.via;
  const command = commandOf(invocation);
  const besideCommand =
    invocation && command
      ? {
          ...invocation,
          arguments: invocation.arguments.filter((item) => item !== command),
        }
      : undefined;
  // Beside files whose change can be shown, the files are the account of
  // the call; beside any other, its inputs are too.
  const showsInputs =
    !changes?.length || changes.some((change) => change.omitted !== undefined);
  return (
    <>
      {/*
        A file whose change cannot be shown as a difference, such as a
        binary scene or a change too large to carry, says only that it
        changes. What the call will do is then the only account of that
        change, so it is shown with the files.
      */}
      {command !== undefined ? (
        <>
          {/* What runs is shown as itself, whatever else the call does: on
              the card when it reads at a glance, else one step away, whole. */}
          {readOnItsOwn(command.value) ? (
            <div className={styles["approval__file-list"]}>
              <CodeRow
                lines={codeLines(command.value).length}
                disabled={disabled}
                onReview={onReviewCode}
              />
            </div>
          ) : (
            <code
              className={styles.approval__command}
              aria-label="What will run"
            >
              {visibleText(command.value)}
            </code>
          )}
          {showsInputs && !!besideCommand?.arguments.length && (
            <ToolCallView invocation={besideCommand} hideName whole />
          )}
        </>
      ) : (
        !!changes?.length &&
        showsInputs &&
        invocation &&
        !invocation.via &&
        invocation.arguments.length > 0 && (
          <ToolCallView invocation={invocation} hideName whole />
        )
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
      ) : command !== undefined ? null : invocation?.via ? (
        <>
          {/* What is sent leads; the connector's own names follow on request. */}
          {invocation.arguments.length === 1 ? (
            <code
              className={styles.approval__command}
              aria-label="What will be sent"
            >
              <WithGap argument={invocation.arguments[0]!} />
            </code>
          ) : (
            invocation.arguments.length > 1 && (
              <ToolCallView invocation={invocation} hideName whole />
            )
          )}
          <details className={styles.approval__technical}>
            <summary>Technical details</summary>
            <ToolCallView invocation={invocation} whole raw />
          </details>
        </>
      ) : invocation ? (
        <>
          {/* The inputs in words; the tool's own name, when it is not the
              action's, under Technical details. */}
          {invocation.arguments.length > 0 && (
            <ToolCallView invocation={invocation} hideName whole />
          )}
          {!actionAlreadyNamed && (
            <details className={styles.approval__technical}>
              <summary>Technical details</summary>
              <ToolCallView invocation={invocation} whole raw />
            </details>
          )}
        </>
      ) : (
        <code className={styles.approval__command} aria-label="What will run">
          {visibleText(target)}
        </code>
      )}
    </>
  );
}

/** A value as it survived being cut from the middle, with the gap named where it falls. */
function WithGap({ argument }: { argument: ToolArgument }) {
  if (argument.omitted === undefined) return visibleText(argument.value);
  const middle = Math.floor(argument.value.length / 2);
  return (
    <>
      {visibleText(argument.value.slice(0, middle))}
      <span className={common["tool-call__omitted"]}>
        {` … ${argument.omitted.toLocaleString()} characters hidden … `}
      </span>
      {visibleText(argument.value.slice(middle))}
    </>
  );
}

/**
 * A command a built-in tool runs, which is shown as the command itself: the
 * tool that runs it and the field it arrives in are the machine's names, not
 * the person's. Only the tool that runs it says which input it is.
 */
export function commandOf(
  invocation: ToolInvocation | undefined,
): ToolArgument | undefined {
  return invocation?.via
    ? undefined
    : invocation?.arguments.find((argument) => argument.runs);
}

/** Code too long for the card, as a row that opens it whole. */
function CodeRow({
  lines,
  disabled,
  onReview,
}: {
  lines: number;
  disabled: boolean;
  onReview: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.approval__file}
      aria-label={`Review the code that runs, ${lines} lines`}
      disabled={disabled}
      onClick={onReview}
    >
      <span className={styles["approval__file-icon"]} aria-hidden="true">
        <Icon name="code" />
      </span>
      <span className={styles["approval__file-text"]}>
        <span className={styles["approval__file-name"]}>Code that runs</span>
        <span className={styles["approval__file-meta"]}>
          <span>{lines} lines</span>
          <span>read it whole before you allow it</span>
        </span>
      </span>
      <span className={styles["approval__file-open"]} aria-hidden="true">
        <Icon name="chevron" />
      </span>
    </button>
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
  const path = visibleText(change.path);
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const folder = slash > 0 ? path.slice(0, slash) : undefined;
  const counts = lineCounts(change);
  const kind = changeWords[shownKind(change)];
  return (
    <button
      type="button"
      className={styles.approval__file}
      aria-label={`Review this change to ${name}`}
      disabled={disabled}
      onClick={onReview}
    >
      <span className={styles["approval__file-icon"]} aria-hidden="true">
        <Icon name={kind.icon} />
      </span>
      <span className={styles["approval__file-text"]}>
        <span className={styles["approval__file-name"]}>{name}</span>
        <span className={styles["approval__file-meta"]}>
          <span>{moveWords(change) ?? kind.label}</span>
          {folder && <span>in {folder}</span>}
          {change.createdFolder && (
            <span>Also creates folder {visibleText(change.createdFolder)}</span>
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
