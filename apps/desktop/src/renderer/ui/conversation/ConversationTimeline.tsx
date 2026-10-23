import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  turnUnderWay,
  type CoreApi,
  type MessageAttachment,
  type TaskGuidance,
} from "@zhiyin/contract";
import { elapsedTime, Icon, Logo, Notice } from "../shared/index.js";
import { AttachedPicture } from "./AttachedPicture.js";
import { CondensingCard } from "./CondensingCard.js";
import { PastedText } from "./PastedText.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";
import { WorkTrace } from "./WorkTrace.js";
import styles from "./conversation.module.css";
import {
  timelineBlocks,
  type Placed,
  type TimelineBlock,
  type TimelineMessage,
  type TimelineTask,
  type WaitingOn,
} from "./timeline.js";

export type { TimelineMessage, TimelineTask };

/** What tells one entry of the timeline from the others, for React. */
function blockKey<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed,
>(
  block: TimelineBlock<Action, View, Interaction, SpecialistRun>,
  index: number,
): string {
  switch (block.kind) {
    case "message":
      return block.message.id;
    case "view":
      return block.view.id;
    case "interaction":
      return block.interaction.id;
    case "specialistRun":
      return block.run.id;
    case "condensing":
      return block.condensing.id;
    case "actions":
      return `actions-${block.actions[0]?.id ?? index}`;
    default: {
      const unnamed: never = block;
      return unnamed;
    }
  }
}

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
  /**
   * Asks for the answer now, while the model only reasons; the answer says
   * whether a request was stopped for it. No offer when nothing is passed.
   */
  readonly answerNow?: () => Promise<boolean>;
  /**
   * What can be done with a message that waits for the turn's next step:
   * take it back, and have everything waiting sent now, which answers
   * whether a request was stopped for it. The message is drawn either way.
   */
  readonly waitingMessage?: {
    readonly takeBack: (messageId: string) => Promise<void>;
    readonly sendNow?: () => Promise<boolean>;
  };
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
  waiting = false,
}: {
  text: string;
  attachments?: readonly MessageAttachment[];
  onOpen?: (id: string) => void;
  readPicture?: NonNullable<CoreApi["readPicture"]>;
  /** Said, and not yet read by the model. */
  waiting?: boolean;
}) {
  return (
    <div
      className={`${styles["user-turn"]}${waiting ? ` ${styles["user-turn--waiting"]}` : ""}`}
    >
      <span className={styles["user-turn__text"]}>{text}</span>
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
 * One entry of the conversation, and the turn's end where it closes one.
 * Every entry has this same element whether it is condensed or not, so
 * compacting changes how an entry looks and is named, never which element it
 * is: nothing is drawn again, and each entry keeps its place and height.
 *
 * What the model now knows only from a summary is still here to read, at less
 * emphasis, and named as condensed for anyone who cannot see the difference.
 * Hovering it says what that means.
 */
function TimelineEntry({
  condensedNote: noteId,
  explains = false,
  children,
}: {
  /** The id of the note saying what condensed means; set when it is. */
  condensedNote: string | undefined;
  /**
   * Whether the note is said here, in the first condensed entry: inside an
   * entry, it scrolls with the conversation and is never taken for the entry
   * a person is reading.
   */
  explains?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={styles["timeline-entry"]}
      {...(noteId
        ? {
            "data-condensed": "",
            role: "group",
            "aria-label": "Compacted earlier conversation",
            "aria-describedby": noteId,
            title: condensedNote,
          }
        : {})}
    >
      {noteId && explains && (
        // Said once, before what it explains, and shown when reached from
        // the keyboard.
        <p id={noteId} className={styles["condensed-note"]} tabIndex={0}>
          {condensedNote}
        </p>
      )}
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
  /** A status alone, or one with the model's reasoning under it. */
  status?: boolean | "thinking";
  compact: boolean;
}) {
  const kind =
    status === "thinking"
      ? ` ${styles["agent-turn--thinking"]}`
      : status
        ? ` ${styles["agent-turn--status"]}`
        : "";
  return (
    <article
      className={`${styles["agent-turn"]}${kind}${compact ? ` ${styles["agent-turn--compact"]}` : ""}`}
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

/** Time is shown only once a turn has run long enough to wonder about. */
const showTimeAfterMs = 5_000;

/**
 * "Working", or what the turn says it is doing, and once it has gone on for a
 * while, for how long: set apart in a quieter colour rather than by a comma.
 */
function WorkingStatus({
  startedAt,
  label,
}: {
  /** When what it counts began; unknown, it counts from when it is shown. */
  startedAt?: string | undefined;
  label: string;
}) {
  const [shownAt] = useState(() => Date.now());
  const since = startedAt ? Date.parse(startedAt) : shownAt;
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
          {elapsedTime(ran)}
        </span>
      )}
    </div>
  );
}

/**
 * Something quietly offered beside what it acts on: the answer now, a waiting
 * message sent now or taken back. One press is taken. The offer stands again
 * when the answer says nothing changed; when something did, what it was
 * offered beside is gone and the offer with it.
 */
function QuietOffer({
  label,
  tip,
  ask,
}: {
  label: string;
  /** What pressing it does, said on hover and focus. */
  tip: string;
  ask: () => Promise<boolean | void>;
}) {
  const [asked, setAsked] = useState(false);
  return (
    <button
      type="button"
      className={styles["quiet-offer"]}
      data-tip={tip}
      disabled={asked}
      onClick={() => {
        setAsked(true);
        void ask().then(
          (changed) => {
            if (!changed) setAsked(false);
          },
          () => setAsked(false),
        );
      }}
    >
      {label}
    </button>
  );
}

/**
 * The person's messages that wait for the turn's next step: each as they
 * wrote it, at less emphasis, with what can be done meanwhile under it.
 * Sending now sends all of them, so it is offered once, under the last.
 */
function WaitingMessages({
  waiting,
  pieces,
  canSendNow,
}: {
  waiting: readonly TaskGuidance[];
  pieces: Pick<
    TimelinePieces<unknown, unknown, unknown>,
    "openAttachment" | "readPicture" | "waitingMessage"
  >;
  /** The model only reasons: its request can be stopped for these. */
  canSendNow: boolean;
}) {
  const offered = pieces.waitingMessage;
  return waiting.map((message, index) => (
    <div
      key={message.id}
      className={styles["waiting-turn"]}
      role="group"
      aria-label="Message waiting to be read"
    >
      <UserTurn
        text={message.text}
        waiting
        {...(message.attachments ? { attachments: message.attachments } : {})}
        {...(pieces.openAttachment ? { onOpen: pieces.openAttachment } : {})}
        {...(pieces.readPicture ? { readPicture: pieces.readPicture } : {})}
      />
      <div className={styles["waiting-turn__row"]}>
        <span className={styles["waiting-turn__note"]}>
          <Icon name="clock" />
          Read at the next step
        </span>
        {offered?.sendNow && canSendNow && index === waiting.length - 1 && (
          <QuietOffer
            label="Send now"
            tip="Stop the reasoning and send this now"
            ask={offered.sendNow}
          />
        )}
        {offered && (
          <QuietOffer
            label="Take back"
            tip="Return this to the message box"
            ask={() => offered.takeBack(message.id)}
          />
        )}
      </div>
    </div>
  ));
}

/** How much of a trace is drawn while it arrives: its end, a screen or so. */
const shownReasoningCharacters = 4_000;

/**
 * What the model is reasoning, as it arrives: the end of it, in a few quiet
 * lines that follow the newest. Plain text, never Markdown, and not announced
 * as it changes.
 */
function ReasoningTail({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  const end = text.slice(-shownReasoningCharacters);
  // From the first whole word, when the start was left out.
  const shown =
    end.length < text.length ? `…${end.slice(end.search(/\s/) + 1)}` : text;
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setCut(element.scrollHeight > element.clientHeight + 1);
  }, [shown]);
  return (
    <div
      ref={box}
      className={`${styles["reasoning-tail"]}${cut ? ` ${styles["reasoning-tail--cut"]}` : ""}`}
      role="group"
      aria-label="Reasoning"
      aria-live="off"
    >
      {shown}
    </div>
  );
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
          · {elapsedTime(now - Date.parse(waitingOn.since))}
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
  /**
   * What the model is reasoning, while it has not begun its answer. Drawn
   * under the status as it arrives; reasoning that is over is not drawn.
   */
  const reasoningNow = task.messages.at(-1);
  const liveReasoning =
    task.phase.kind === "working" &&
    reasoningNow?.role === "assistant" &&
    !reasoningNow.text.trim() &&
    reasoningNow.reasoning?.status === "streaming" &&
    reasoningNow.reasoning.text.trim()
      ? reasoningNow.reasoning.text
      : undefined;
  /** What the person added to this turn that the model has not read yet. */
  const waiting = (task.guidance ?? []).filter(
    (item) => item.status === "pending",
  );
  const hasPlan = task.plan.length > 0;
  const showWorkingStatus =
    !task.compacting &&
    task.phase.kind === "working" &&
    !hasAssistantAfterLatestUser &&
    task.phase.steps.length === 0 &&
    !task.phase.note;
  const fallbackPhase = task.phase.kind === "working" ? task.phase : undefined;
  const showFallbackActivity =
    !hasPlan &&
    task.actions.length === 0 &&
    fallbackPhase !== undefined &&
    !fallbackPhase.retry &&
    fallbackPhase.steps.length > 0;
  /**
   * What the turn says it is doing, when no step is drawing it: thinking,
   * waiting for the model, composing a request. Said the way "Working" is, in
   * a conversation's first round as in any later one.
   */
  const workingNote =
    task.phase.kind === "working" &&
    task.phase.note &&
    !task.phase.retry &&
    !showFallbackActivity
      ? task.phase.note
      : undefined;
  const condensedNoteId = useId();
  const busy = turnUnderWay(task.phase.kind);

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

  /** One entry of the timeline, as its kind is drawn. */
  const drawBlock = (block: (typeof blocks)[number]): ReactNode => {
    switch (block.kind) {
      case "message": {
        if (block.message.role !== "user")
          return (
            <AgentTurn compact={compact}>
              {block.message.text.trim() && (
                <StreamingMarkdown
                  text={block.message.text}
                  streaming={block.message.id === streamingMessageId}
                />
              )}
            </AgentTurn>
          );
        const bubble = (
          <UserTurn
            text={block.message.text}
            {...userTurnExtras(block.message, pieces)}
          />
        );
        return pieces.userMessage
          ? pieces.userMessage(block.message, busy, bubble)
          : bubble;
      }
      case "view":
        return (
          <AgentTurn compact={compact}>{pieces.view(block.view)}</AgentTurn>
        );
      case "interaction":
        return (
          <AgentTurn compact={compact}>
            {pieces.interaction(block.interaction)}
          </AgentTurn>
        );
      case "specialistRun":
        return pieces.specialistRun ? (
          <AgentTurn compact={compact}>
            {pieces.specialistRun(block.run)}
          </AgentTurn>
        ) : null;
      case "condensing":
        return <CondensingCard condensing={block.condensing} />;
      case "actions":
        return pieces.actions(block.actions);
      default: {
        const unnamed: never = block;
        return unnamed;
      }
    }
  };

  const condensedEnd = task.condensedThrough
    ? blocks.findIndex(
        (block) =>
          block.kind === "message" &&
          block.message.id === task.condensedThrough,
      )
    : -1;
  const drawn = blocks.map((block, index) => {
    const turn = turnOf[index];
    const turnEnd =
      turn && endsTurn(index)
        ? pieces.turnEnd?.(turn, busy && index === blocks.length - 1)
        : null;
    return (
      <TimelineEntry
        key={blockKey(block, index)}
        condensedNote={index <= condensedEnd ? condensedNoteId : undefined}
        explains={index === 0}
      >
        {drawBlock(block)}
        {turnEnd ? <AgentTurn compact={compact}>{turnEnd}</AgentTurn> : null}
      </TimelineEntry>
    );
  });

  return (
    <>
      {drawn}

      {task.compacting && (
        <AgentTurn status compact={compact}>
          {/* Its own time: a long summary while nothing else runs is no turn. */}
          <WorkingStatus
            key={`${task.id}:compacting`}
            startedAt={task.compactingSince}
            label="Compacting the earlier conversation"
          />
        </AgentTurn>
      )}

      {(showWorkingStatus || workingNote || liveReasoning) && (
        <AgentTurn status={liveReasoning ? "thinking" : true} compact={compact}>
          <div className={styles["response-status-row"]}>
            {/* A note is the same status as "Working", said more exactly. */}
            <WorkingStatus
              key={task.id}
              startedAt={task.turnStartedAt}
              label={
                workingNote ?? (showWorkingStatus ? "Working" : "Thinking")
              }
            />
            {liveReasoning && pieces.answerNow && (
              // A new request's reasoning is a new offer.
              <QuietOffer
                key={reasoningNow?.id}
                label="Answer now"
                tip="Stop the reasoning and answer directly"
                ask={pieces.answerNow}
              />
            )}
          </div>
          {liveReasoning && <ReasoningTail text={liveReasoning} />}
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
                <Icon name="globe" />
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

      {/* Said after what the model is doing began, so drawn below it. */}
      {waiting.length > 0 && (
        <WaitingMessages
          waiting={waiting}
          pieces={pieces}
          canSendNow={Boolean(liveReasoning)}
        />
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
