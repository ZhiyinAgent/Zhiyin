import { useEffect, useState } from "react";
import type { EvidenceState } from "@zhiyin/contract";
import { Icon, LoadingSkeleton, SurfacePanel } from "../shared/index.js";
import styles from "./evidence.module.css";

type Kind = "corrections" | "recovery";

type Correction = EvidenceState["corrections"]["entries"][number];

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function count(value: number): string {
  return value.toLocaleString("en");
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * The record is written with the tokens the agent loop uses. A person reading
 * this page did not choose those words and should not have to learn them, so
 * each one is said plainly here and the token is kept only as a fallback for a
 * kind this build has not been taught.
 */
const kindLabels: Record<Correction["kind"], string> = {
  "quiet-retry": "Quiet retry",
  "repair-applied": "Repair applied",
  "repair-rejected": "Repair rejected",
};

const causeLabels: Record<string, string> = {
  handover: "Handed back to the model",
  "content-changed": "It would have changed approved content",
  "no-progress": "It repeated itself without getting further",
  "still-refused": "The repaired call was refused too",
  "unusable-answer": "The repair came back unusable",
  "too-large": "The call was too large to repair",
};

function when(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export function EvidencePanel({
  onClose,
  read,
  clear,
}: {
  onClose: () => void;
  read: () => Promise<EvidenceState>;
  clear: (kind: Kind) => Promise<EvidenceState>;
}) {
  const [state, setState] = useState<EvidenceState>();
  const [failure, setFailure] = useState("");
  const [confirming, setConfirming] = useState<Kind | undefined>();

  useEffect(() => {
    let active = true;
    void read()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setFailure("Private evidence could not be read.");
      });
    return () => {
      active = false;
    };
  }, [read]);

  const deleteKind = async (kind: Kind) => {
    setFailure("");
    try {
      setState(await clear(kind));
      setConfirming(undefined);
    } catch (error) {
      setFailure(
        error instanceof Error && error.message
          ? error.message
          : "That evidence could not be deleted.",
      );
    }
  };

  const used = state ? state.recovery.usedBytes : 0;
  const total = state ? state.recovery.limits.totalBytes : 0;
  const filled = total ? Math.min(100, (used / total) * 100) : 0;

  return (
    <SurfacePanel
      label="Private evidence"
      eyebrow={<p className="instrument-label">Account / Local data</p>}
      title="Evidence & recovery"
      description="What Zhiyin keeps on this computer so past actions stay reviewable and changed files can be put back. None of it leaves the machine."
      closeLabel="Close evidence"
      onClose={onClose}
    >
      {!state && !failure && <LoadingSkeleton label="Loading evidence" />}
      {failure && (
        <p className={styles.failure} role="alert">
          <Icon name="alert" />
          {failure}
        </p>
      )}
      {state && (
        <>
          <div className={styles.summary}>
            <article>
              <span className="instrument-label">Recovery store</span>
              <strong>{bytes(used)}</strong>
              <small>of {bytes(total)} total</small>
            </article>
            <article>
              <span className="instrument-label">Files kept</span>
              <strong>{count(state.recovery.retainedFiles)}</strong>
              <small>
                {state.recovery.excludedFiles === 0
                  ? "Every change so far can be put back"
                  : `${plural(state.recovery.excludedFiles, "change has", "changes have")} no saved copy`}
              </small>
            </article>
            <article>
              <span className="instrument-label">Corrections</span>
              <strong>{count(state.corrections.retainedEntries)}</strong>
              <small>
                of {count(state.corrections.maximumEntries)} kept at most
              </small>
            </article>
          </div>

          <div className={styles.instruments}>
            <section aria-labelledby="correction-log">
              <header>
                <div>
                  <span className="instrument-label">Out of sight</span>
                  <h2 id="correction-log">Correction log</h2>
                </div>
                <span className={styles.tally}>
                  {state.corrections.entries.length === 0
                    ? "Nothing recorded"
                    : `Newest ${count(state.corrections.shownEntries)} shown`}
                </span>
              </header>
              <p className={styles.explainer}>
                When a tool call comes back malformed, Zhiyin may retry or
                rewrite it without interrupting you. Every one of those is
                written down here, with the arguments as they were refused and
                as they were repaired.
              </p>
              {state.corrections.entries.length === 0 ? (
                <p className={styles.empty}>
                  <Icon name="check" />
                  No correction has been made behind your back.
                </p>
              ) : (
                <ol className={styles.corrections}>
                  {[...state.corrections.entries]
                    .reverse()
                    .map((entry, index) => (
                      <CorrectionEntry
                        entry={entry}
                        key={`${entry.at}-${entry.taskId}-${index}`}
                      />
                    ))}
                </ol>
              )}
              <DeleteControl
                kind="corrections"
                label="Delete correction log"
                consequence="Every record of a quiet retry or a repair is removed. Conversations keep their own history."
                disabled={state.corrections.retainedEntries === 0}
                confirming={confirming}
                onAsk={setConfirming}
                onDelete={deleteKind}
              />
            </section>

            <div className={styles.column}>
              <section aria-labelledby="recovery-storage">
                <header>
                  <div>
                    <span className="instrument-label">Rewind</span>
                    <h2 id="recovery-storage">File recovery</h2>
                  </div>
                </header>
                <p className={styles.explainer}>
                  A copy of each file is kept before Zhiyin changes it, so a
                  rewind can put the old one back.
                </p>
                <div
                  className={styles.meter}
                  role="meter"
                  aria-label="Recovery storage used"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={used}
                  aria-valuetext={`${bytes(used)} of ${bytes(total)}`}
                >
                  <span
                    style={{ width: `${Math.max(filled, used ? 2 : 0)}%` }}
                  />
                </div>
                <p className={styles["meter-caption"]}>
                  {bytes(used)} used · oldest copies removed first
                </p>
                <dl className={styles.limits}>
                  <div>
                    <dt>Per file</dt>
                    <dd>{bytes(state.recovery.limits.fileBytes)}</dd>
                  </div>
                  <div>
                    <dt>Versions per file</dt>
                    <dd>{count(state.recovery.limits.versionsPerPath)}</dd>
                  </div>
                  <div>
                    <dt>Kept for</dt>
                    <dd>{state.recovery.limits.maximumAgeDays} days</dd>
                  </div>
                </dl>
                {state.recovery.excludedFiles > 0 && (
                  <p className={styles.caution}>
                    <Icon name="alert" />
                    <span>
                      {plural(
                        state.recovery.excludedFiles,
                        "changed file has",
                        "changed files have",
                      )}{" "}
                      no saved copy — too large for the limits above, or not an
                      ordinary file inside the workspace. A rewind cannot put
                      those back.
                    </span>
                  </p>
                )}
                <DeleteControl
                  kind="recovery"
                  label="Delete all recovery copies"
                  consequence="Rewinding an earlier action will no longer be able to restore any file. Conversations are not touched."
                  disabled={used === 0 && state.recovery.retainedFiles === 0}
                  confirming={confirming}
                  onAsk={setConfirming}
                  onDelete={deleteKind}
                />
              </section>

              <section aria-labelledby="evidence-limits">
                <header>
                  <div>
                    <span className="instrument-label">Plainly</span>
                    <h2 id="evidence-limits">
                      What deletion and redaction mean
                    </h2>
                  </div>
                </header>
                <ul className={styles.policy}>
                  <li>
                    <Icon name="file" />
                    <span>
                      <strong>Deleting a conversation</strong>
                      {state.policy.taskDeletion}
                    </span>
                  </li>
                  <li>
                    <Icon name="alert" />
                    <span>
                      <strong>What redaction catches</strong>
                      {state.policy.correctionRedaction}
                    </span>
                  </li>
                  <li>
                    <Icon name="lock" />
                    <span>
                      <strong>Where this is kept</strong>
                      {state.policy.privateStorage}
                    </span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </SurfacePanel>
  );
}

function CorrectionEntry({ entry }: { entry: Correction }) {
  const cause = entry.cause
    ? (causeLabels[entry.cause] ?? entry.cause)
    : undefined;
  return (
    <li className={styles.correction} data-kind={entry.kind}>
      <div className={styles["correction-head"]}>
        <span className={styles.badge}>
          {kindLabels[entry.kind] ?? entry.kind}
        </span>
        <strong>{entry.taskTitle ?? "Deleted conversation"}</strong>
        <time dateTime={entry.at}>{when(entry.at)}</time>
      </div>
      <p className={styles.reason}>{entry.reason}</p>
      <div className={styles["correction-meta"]}>
        <code>{entry.toolName}</code>
        {cause && <span>{cause}</span>}
      </div>
      {(entry.before ?? entry.after) !== undefined && (
        <details className={styles.arguments}>
          <summary>Arguments</summary>
          <div>
            {entry.before !== undefined && (
              <div>
                <span>As refused</span>
                <pre>{entry.before}</pre>
              </div>
            )}
            {entry.after !== undefined && (
              <div>
                <span>As repaired</span>
                <pre>{entry.after}</pre>
              </div>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

function DeleteControl({
  kind,
  label,
  consequence,
  disabled,
  confirming,
  onAsk,
  onDelete,
}: {
  kind: Kind;
  label: string;
  consequence: string;
  disabled: boolean;
  confirming: Kind | undefined;
  onAsk: (kind: Kind | undefined) => void;
  onDelete: (kind: Kind) => Promise<void>;
}) {
  if (confirming !== kind)
    return (
      <div className={styles.footer}>
        <button
          className={`${styles.danger} button button--small`}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(kind)}
        >
          {label}
        </button>
      </div>
    );
  return (
    <div
      className={styles.confirm}
      role="group"
      aria-label={`Confirm ${label}`}
    >
      <p>
        <strong>This cannot be undone.</strong> {consequence}
      </p>
      <div>
        <button
          className="button button--small button--quiet"
          type="button"
          onClick={() => onAsk(undefined)}
        >
          Keep it
        </button>
        <button
          className={`${styles.danger} ${styles["danger-solid"]} button button--small`}
          type="button"
          onClick={() => void onDelete(kind)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
