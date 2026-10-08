import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import type { CoreApi, MessageAttachment } from "@zhiyin/contract";
import { Icon, Logo, Notice } from "../shared/index.js";
import { AttachedPicture } from "./AttachedPicture.js";
import { CondensingCard } from "./CondensingCard.js";
import { ConversationSkeleton } from "./ConversationSkeleton.js";
import { PastedText } from "./PastedText.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";
import { WorkTrace } from "./WorkTrace.js";
import styles from "./conversation.module.css";
import {
  timelineBlocks,
  type Placed,
  type TimelineMessage,
  type TimelineTask,
  type WaitingOn,
} from "./timeline.js";

export type { TimelineMessage, TimelineTask };

/**
 * What other modules draw inside the conversation, passed in by the app shell.
 * The conversation decides where each goes and never what it is.
 */
export type TimelinePieces<Action, View, Interaction, SpecialistRun = never> = {
  /**
   * A person’s own message, given as the conversation draws it and told
   * whether a turn is under way. Drawn on its own when nothing is passed.
   */
  readonly userMessage?: (
    message: TimelineMessage,
    busy: boolean,
    bubble: ReactNode,
  ) => ReactNode;
  /** Opens a paste a message carried; its chip is inert when nothing is passed. */
  readonly openAttachment?: (id: string) => void;
  /** Reads a picture a message carried, to show it. */
  readonly readPicture?: NonNullable<CoreApi["readPicture"]>;
  readonly actions: (actions: Action[]) => ReactNode;
  readonly view: (view: View) => ReactNode;
  readonly interaction: (interaction: Interaction) => ReactNode;
  /** A delegated specialist's own run, drawn beside the main task's own history. */
  readonly specialistRun?: (run: SpecialistRun) => ReactNode;
  /**
   * What closes a turn, drawn after its last entry: the turn is named by the
   * person's message that opened it, and told whether it is still working.
   */
  readonly turnEnd?: (opening: TimelineMessage, running: boolean) => ReactNode;
  /** What a failed turn offers to do next; only the reason when absent. */
  readonly failure?: (
    remedies: readonly import("@zhiyin/contract").TurnRemedy[],
  ) => ReactNode;
};

/** A person’s own message, as the conversation draws it. */
export function UserTurn({
  text,
  attachments = [],
  onOpen,
  readPicture,
}: {
  text: string;
  attachments?: readonly MessageAttachment[];
  onOpen?: (id: string) => void;
  readPicture?: NonNullable<CoreApi["readPicture"]>;
}) {
  return (
    <div className={styles["user-turn"]}>
      {text}
      {attachments.length > 0 && (
        <div className={styles["user-turn__attachments"]}>
          {attachments.map((attachment) =>
            attachment.kind === "picture" ? (
              <AttachedPicture
                key={attachment.id}
                attachment={attachment}
                {...(readPicture ? { readPicture } : {})}
              />
            ) : (
              <PastedText
                key={attachment.id}
                attachment={attachment}
                {...(onOpen ? { onOpen } : {})}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function userTurnExtras(
  message: TimelineMessage,
  pieces: Pick<
    TimelinePieces<unknown, unknown, unknown>,
    "openAttachment" | "readPicture"
  >,
) {
  return {
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(pieces.openAttachment ? { onOpen: pieces.openAttachment } : {}),
    ...(pieces.readPicture ? { readPicture: pieces.readPicture } : {}),
  };
}

const condensedNote =
  "Not in the assistant's memory any more: it works from the summary below.";

/**
 * What the model now knows only from a summary: still here to read, at less
 * emphasis, and named as condensed for anyone who cannot see the difference.
 * Hovering or focusing it says what that means.
 */
function CondensedHistory({ children }: { children: ReactNode }) {
  const noteId = useId();
  return (
    <div
      className={styles["condensed-history"]}
      role="group"
      aria-label="Compacted earlier conversation"
      aria-describedby={noteId}
      tabIndex={0}
      title={condensedNote}
    >
      <p id={noteId} className={styles["condensed-history__note"]}>
        {condensedNote}
      </p>
      {children}
    </div>
  );
}

function AgentTurn({
  children,
  status = false,
  compact,
}: {
  children: ReactNode;
  status?: boolean;
  compact: boolean;
}) {
  return (
    <article
      className={`${styles["agent-turn"]}${status ? ` ${styles["agent-turn--status"]}` : ""}${compact ? ` ${styles["agent-turn--compact"]}` : ""}`}
      aria-label="Zhiyin response"
    >
      <div className={styles["agent-turn__mark"]}>
        <Logo compact size={17} />
      </div>
      <div className={styles["agent-turn__body"]}>{children}</div>
    </article>
  );
}

function RetryCountdown({
  note,
  readyAt,
  count,
}: {
  note: string;
  readyAt: string;
  count?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [readyAt]);
  const seconds = Math.max(0, Math.ceil((Date.parse(readyAt) - now) / 1_000));
  return (
    <div
      className={`${styles["response-status"]} ${styles["response-status--retry"]}`}
      role="status"
    >
      <Icon name="clock" />
      <span>
        {note}
        <span aria-live="off">{seconds > 0 ? ` in ${seconds} s` : "…"}</span>
      </span>
      {count && (
        <span className={styles["response-status__time"]}>attempt {count}</span>
      )}
    </div>
  );
}

/**
 * When each conversation was first seen working in this window, so the time
 * keeps counting when it is shown again. Forgotten once its turn ends.
 */
const workingSince = new Map<string, number>();

/** Time is shown only once a turn has run long enough to wonder about. */
const showTimeAfterMs = 5_000;

/**
 * "Working", or what the turn is composing, and once it has gone on for a
 * while, for how long: set apart in a quieter colour rather than by a comma.
 */
function WorkingStatus({ taskId, label }: { taskId: string; label: string }) {
  const [since] = useState(() => {
    const known = workingSince.get(taskId) ?? Date.now();
    workingSince.set(taskId, known);
    return known;
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const ran = now - since;
  return (
    <div className={styles["response-status"]} role="status">
      <span aria-hidden="true" />
      {label}
      {ran >= showTimeAfterMs && (
        // Ticking every second; not announced each time it changes.
        <span className={styles["response-status__time"]} aria-live="off">
          {elapsed(ran)}
        </span>
      )}
    </div>
  );
}

/** "5 s", "1 min 20 s", "1 h 5 min". */
function elapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function listed(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function WaitingForSpecialists({ waitingOn }: { waitingOn: WaitingOn }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className={styles["response-status"]} role="status">
      <span aria-hidden="true" />
      <span>
        Waiting for {listed(waitingOn.names)} · {waitingOn.calls}{" "}
        {waitingOn.calls === 1 ? "call" : "calls"}
        {/* Ticking every second; announced once, with the rest. */}
        <span aria-live="off">
          {" "}
          · {elapsed(now - Date.parse(waitingOn.since))}
        </span>
      </span>
    </div>
  );
}

/**
 * A conversation as it happened: messages, actions, views and answered
 * questions in the order they occurred, and what the turn is doing or how it
 * ended. The plan is not part of it: it is a pill above the conversation.
 */
export function ConversationTimeline<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed = never,
>({
  task,
  pieces,
  compact = false,
}: {
  task: TimelineTask<Action, View, Interaction, SpecialistRun>;
  pieces: TimelinePieces<Action, View, Interaction, SpecialistRun>;
  /** Tighter turns, for a conversation sharing the window with the browser. */
  compact?: boolean;
}) {
  const blocks = timelineBlocks(task);
  const latestUserId = task.messages.findLast(
    (message) => message.role === "user" && !message.interactionId,
  )?.id;
  const latestUserIndex = blocks.findLastIndex(
    (block) =>
      (block.kind === "message" && block.message.id === latestUserId) ||
      block.kind === "interaction",
  );
  const hasAssistantAfterLatestUser = blocks
    .slice(latestUserIndex + 1)
    .some(
      (block) =>
        block.kind === "message" &&
        block.message.role === "assistant" &&
        Boolean(block.message.text.trim()),
    );
  /**
   * The one message still being written: the last thing in the timeline, from
   * the assistant, while the turn is still running. Only that one is paced;
   * everything above it is finished text and is drawn at once.
   */
  const streamingMessageId =
    task.phase.kind === "working" && blocks.at(-1)?.kind === "message"
      ? (() => {
          const last = blocks.at(-1);
          return last?.kind === "message" && last.message.role === "assistant"
            ? last.message.id
            : undefined;
        })()
      : undefined;
  const hasPlan = task.plan.length > 0;
  const showWorkingStatus =
    !task.compacting &&
    task.phase.kind === "working" &&
    !hasAssistantAfterLatestUser &&
    task.phase.steps.length === 0 &&
    !task.phase.note;
  const fallbackPhase =
    task.phase.kind === "working" || task.phase.kind === "browser"
      ? task.phase
      : undefined;
  const showFallbackActivity =
    !hasPlan &&
    task.actions.length === 0 &&
    fallbackPhase !== undefined &&
    !fallbackPhase.retry &&
    (fallbackPhase.steps.length > 0 || Boolean(fallbackPhase.note));
  /**
   * What the turn is composing, when nothing else is drawing it.
   *
   * The fallback block below only appears with no plan and no actions, which is
   * the first round and no other, and it gives way to the work trace as soon as
   * there are steps. A real session has actions by its second round, so
   * without this the note the loop sends would reach nobody after the first.
   */
  const composingNote =
    task.phase.kind === "working" &&
    task.phase.note &&
    !task.phase.retry &&
    !showFallbackActivity
      ? task.phase.note
      : undefined;
  const busy =
    task.phase.kind === "working" ||
    task.phase.kind === "browser" ||
    task.phase.kind === "loading" ||
    task.phase.kind === "approval" ||
    task.phase.kind === "input";
  useEffect(() => {
    if (!busy) workingSince.delete(task.id);
  }, [busy, task.id]);
  useEffect(() => {
    if (!task.compacting) workingSince.delete(`${task.id}:compacting`);
  }, [task.compacting, task.id]);

  // Each entry's turn: the person's message that opened it.
  const turnOf: (TimelineMessage | undefined)[] = [];
  for (const block of blocks)
    turnOf.push(
      block.kind === "message" && block.message.role === "user"
        ? block.message
        : turnOf.at(-1),
    );
  const endsTurn = (index: number) => {
    const next = blocks[index + 1];
    return !next || (next.kind === "message" && next.message.role === "user");
  };

  const drawn = blocks.map((block, index) => {
    const turn = turnOf[index];
    const turnEnd =
      turn && endsTurn(index)
        ? pieces.turnEnd?.(turn, busy && index === blocks.length - 1)
        : null;
    const key =
      block.kind === "message"
        ? block.message.id
        : block.kind === "view"
          ? block.view.id
          : block.kind === "interaction"
            ? block.interaction.id
            : block.kind === "specialistRun"
              ? block.run.id
              : block.kind === "condensing"
                ? block.condensing.id
                : `actions-${block.actions[0]?.id ?? index}`;
    return (
      <Fragment key={key}>
        {block.kind === "message" ? (
          block.message.role === "user" ? (
            pieces.userMessage ? (
              pieces.userMessage(
                block.message,
                busy,
                <UserTurn
                  text={block.message.text}
                  {...userTurnExtras(block.message, pieces)}
                />,
              )
            ) : (
              <UserTurn
                text={block.message.text}
                {...userTurnExtras(block.message, pieces)}
              />
            )
          ) : (
            <AgentTurn compact={compact}>
              {block.message.text.trim() && (
                <StreamingMarkdown
                  text={block.message.text}
                  streaming={block.message.id === streamingMessageId}
                />
              )}
            </AgentTurn>
          )
        ) : block.kind === "view" ? (
          <AgentTurn compact={compact}>{pieces.view(block.view)}</AgentTurn>
        ) : block.kind === "interaction" ? (
          <AgentTurn compact={compact}>
            {pieces.interaction(block.interaction)}
          </AgentTurn>
        ) : block.kind === "specialistRun" ? (
          pieces.specialistRun ? (
            <AgentTurn compact={compact}>
              {pieces.specialistRun(block.run)}
            </AgentTurn>
          ) : null
        ) : block.kind === "condensing" ? (
          <CondensingCard condensing={block.condensing} />
        ) : (
          pieces.actions(block.actions)
        )}
        {turnEnd ? <AgentTurn compact={compact}>{turnEnd}</AgentTurn> : null}
      </Fragment>
    );
  });
  const condensedEnd = task.condensedThrough
    ? blocks.findIndex(
        (block) =>
          block.kind === "message" &&
          block.message.id === task.condensedThrough,
      )
    : -1;

  return (
    <>
      {condensedEnd >= 0 ? (
        <>
          <CondensedHistory>
            {drawn.slice(0, condensedEnd + 1)}
          </CondensedHistory>
          {drawn.slice(condensedEnd + 1)}
        </>
      ) : (
        drawn
      )}

      {task.phase.kind === "loading" && <ConversationSkeleton />}

      {task.compacting && (
        <AgentTurn status compact={compact}>
          {/* Its own time: a long summary while nothing else runs is no turn. */}
          <WorkingStatus
            taskId={`${task.id}:compacting`}
            label="Compacting the earlier conversation"
          />
        </AgentTurn>
      )}

      {showWorkingStatus && (
        <AgentTurn status compact={compact}>
          <WorkingStatus taskId={task.id} label="Working" />
        </AgentTurn>
      )}

      {composingNote && (
        <AgentTurn status compact={compact}>
          {/* The same status as "Working": this is that, with its object named. */}
          <WorkingStatus taskId={task.id} label={composingNote} />
        </AgentTurn>
      )}

      {task.phase.kind === "working" && task.phase.retry && task.phase.note && (
        <AgentTurn status compact={compact}>
          <RetryCountdown
            key={task.phase.retry.readyAt}
            note={task.phase.note}
            {...task.phase.retry}
          />
        </AgentTurn>
      )}

      {showFallbackActivity && fallbackPhase && (
        <AgentTurn compact={compact}>
          {fallbackPhase.steps.length > 0 ? (
            <WorkTrace steps={fallbackPhase.steps} />
          ) : (
            fallbackPhase.note && (
              <div className={styles["activity-note"]}>
                <Icon
                  name={fallbackPhase.kind === "browser" ? "globe" : "code"}
                />
                <span>{fallbackPhase.note}</span>
              </div>
            )
          )}
        </AgentTurn>
      )}

      {task.phase.kind === "completed" && task.waitingOn && (
        <AgentTurn status compact={compact}>
          <WaitingForSpecialists waitingOn={task.waitingOn} />
        </AgentTurn>
      )}

      {(task.phase.kind === "failed" || task.phase.kind === "interrupted") && (
        <AgentTurn compact={compact}>
          <Notice role="status">
            <strong>
              {task.phase.kind === "failed"
                ? "Task stopped with an error"
                : "Task stopped"}
            </strong>
            <p>
              {task.phase.kind === "failed"
                ? task.phase.reason
                : // Only a stop the person asked for comes without a reason.
                  (task.phase.reason ??
                  "You stopped this. Send a message when you want to carry on.")}
            </p>
            {task.phase.kind === "failed" && task.phase.remedies?.length
              ? pieces.failure?.(task.phase.remedies)
              : null}
          </Notice>
        </AgentTurn>
      )}
    </>
  );
}
