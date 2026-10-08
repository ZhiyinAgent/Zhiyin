import { useEffect, useRef, useState } from "react";
import type { CoreApi, RunningCommand } from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./commands.module.css";

type Commands = Pick<
  CoreApi,
  "runningCommands" | "commandOutput" | "stopCommand"
>;

/** How often an open list looks again at what each command printed. */
const outputRefreshMs = 1_000;
/** The last lines of a command's output shown; the model reads the rest. */
const shownLines = 12;

/**
 * The commands of the conversation shown that carried on as jobs (ADR 0007):
 * a button saying how many run, opening on each one, how long it has run, what
 * it printed last, and a way to stop it. The model is told of a stop at its
 * next request.
 */
export function RunningCommands({
  taskId,
  running,
  commands,
  onListed,
}: {
  taskId: string;
  running: readonly RunningCommand[];
  commands: Commands;
  /** The list as the core answered it when this conversation was shown. */
  onListed: (commands: readonly RunningCommand[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Asked again only when the conversation changes, however often the
  // callers hand over new functions.
  const latest = useRef({ commands, onListed });
  useEffect(() => {
    latest.current = { commands, onListed };
  });

  useEffect(() => {
    let current = true;
    void latest.current.commands
      .runningCommands(taskId)
      .then((listed) => {
        if (current) latest.current.onListed(listed);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [taskId]);

  if (!running.length && !open) return null;
  return (
    <>
      {running.length > 0 && (
        <button
          className={styles["running-commands__button"]}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="code" />
          <span>
            {running.length} {running.length === 1 ? "command" : "commands"}{" "}
            running
          </span>
        </button>
      )}
      {open && (
        <Dialog title="Running commands" onClose={() => setOpen(false)}>
          {running.length === 0 ? (
            <p className={styles["running-commands__empty"]}>
              No command is running now.
            </p>
          ) : (
            <>
              <p className={styles["running-commands__note"]}>
                Stop ends a command and all it started. Its work so far stays,
                and Zhiyin is told.
              </p>
              <ul className={styles["running-commands__list"]}>
                {running.map((command) => (
                  <CommandRow
                    key={command.id}
                    taskId={taskId}
                    command={command}
                    commands={commands}
                  />
                ))}
              </ul>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

function CommandRow({
  taskId,
  command,
  commands,
}: {
  taskId: string;
  command: RunningCommand;
  commands: Commands;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [output, setOutput] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string>();
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  // The newest line is what a person looks for, so the box stays at its end.
  const shown = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const box = shown.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [output]);

  useEffect(() => {
    let current = true;
    const look = () => {
      setNow(Date.now());
      void latest.current
        .commandOutput(taskId, command.id)
        .then((printed) => {
          if (current && printed) setOutput(lastLines(printed));
        })
        .catch(() => undefined);
    };
    look();
    const timer = setInterval(look, outputRefreshMs);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [taskId, command.id]);

  const stop = () => {
    setStopping(true);
    setError(undefined);
    commands.stopCommand(taskId, command.id).catch((reason: unknown) => {
      setStopping(false);
      setError(
        reason instanceof Error
          ? reason.message
          : "The command could not be stopped.",
      );
    });
  };

  return (
    <li className={styles["running-commands__item"]}>
      <div className={styles["running-commands__head"]}>
        <strong className={styles["running-commands__why"]}>
          {command.explanation}
        </strong>
        <button
          className="button button--small"
          type="button"
          aria-label={`Stop ${command.command}`}
          disabled={stopping}
          onClick={stop}
        >
          Stop
        </button>
      </div>
      <p className={styles["running-commands__meta"]}>
        <code className={styles["running-commands__command"]}>
          {command.command}
        </code>
        <span>
          {stopping
            ? "Stopping…"
            : `Running for ${elapsed(now - command.startedAt)}`}
        </span>
      </p>
      {error && (
        <p className={styles["running-commands__error"]} role="alert">
          {error}
        </p>
      )}
      <pre
        ref={shown}
        className={styles["running-commands__output"]}
        aria-label={`Latest output of ${command.command}`}
      >
        {output === undefined
          ? "Waiting for output…"
          : output || "Nothing printed yet."}
      </pre>
    </li>
  );
}

function lastLines(printed: { stdout: string; stderr: string }): string {
  const text = [printed.stdout, printed.stderr]
    .map((part) => part.trimEnd())
    .filter(Boolean)
    .join("\n");
  return text.split(/\r?\n/).slice(-shownLines).join("\n");
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
