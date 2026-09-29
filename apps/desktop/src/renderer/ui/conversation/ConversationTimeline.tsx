import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import type {
  MessageAttachment,
  ReasoningTrace as Trace,
  TaskCondensing,
  TaskPlanItem,
} from "@zhiyin/contract";
import { Icon, Logo, Notice } from "../shared/index.js";
import { CondensingCard } from "./CondensingCard.js";
import { ConversationSkeleton } from "./ConversationSkeleton.js";
import { OutcomeCard } from "./OutcomeCard.js";
import { PastedText } from "./PastedText.js";
import { StreamingMarkdown } from "./StreamingMarkdown.js";
import { TaskPlan } from "./TaskPlan.js";
import { WorkTrace, type WorkStep } from "./WorkTrace.js";
import styles from "./conversation.module.css";

/**
 * Something the timeline places by when it happened, without knowing what it
 * is. Actions, views and answered questions are drawn by their own modules.
 */
type Placed = { readonly id: string; readonly sequence?: number };

export type TimelineMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments?: readonly MessageAttachment[];
  readonly interactionId?: string;
  readonly sequence?: number;
  readonly reasoning?: Trace;
};

export type TimelinePhase =
  | { readonly kind: "draft" | "approval" | "input" | "loading" }
  | {
      readonly kind: "working" | "browser";
      readonly steps: WorkStep[];
      readonly note?: string;
      readonly retry?: { readonly readyAt: string; readonly count?: string };
    }
  | {
      readonly kind: "completed";
      readonly outcome: {
        readonly title: string;
        readonly summary: string;
        readonly file?: string;
      };
    }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "interrupted"; readonly reason?: string };

export type TimelineTask<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed = never,
> = {
  readonly id: string;
  readonly messages: readonly TimelineMessage[];
  readonly actions?: readonly Action[];
  readonly views?: readonly View[];
  readonly interactions?: readonly Interaction[];
  readonly specialistRuns?: readonly SpecialistRun[];
  /** Each attempt to condense the conversation, drawn by the conversation. */
  readonly condensings?: readonly TaskCondensing[];
  /** The last message the model now knows only from a summary. */
  readonly condensedThrough?: string;
  readonly plan?: readonly TaskPlanItem[];
  readonly phase: TimelinePhase;
};

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
  readonly actions: (actions: Action[]) => ReactNode;
  readonly view: (view: View) => ReactNode;
  readonly interaction: (interaction: Interaction) => ReactNode;
  /** A delegated specialist's own run, drawn beside the main task's own history. */
  readonly specialistRun?: (run: SpecialistRun) => ReactNode;
};

/** A person’s own message, as the conversation draws it. */
export function UserTurn({
  text,
  attachments = [],
  onOpen,
}: {
  text: string;
  attachments?: readonly MessageAttachment[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className={styles["user-turn"]}>
      {text}
      {attachments.length > 0 && (
        <div className={styles["user-turn__attachments"]}>
          {attachments.map((attachment) => (
            <PastedText
              key={attachment.id}
              attachment={attachment}
              {...(onOpen ? { onOpen } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function userTurnExtras(
  message: TimelineMessage,
  openAttachment: ((id: string) => void) | undefined,
) {
  return {
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(openAttachment ? { onOpen: openAttachment } : {}),
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
    <div className={styles["activity-note"]} role="status">
      <Icon name="clock" />
      <span>
        {note}
        <span aria-live="off">{seconds > 0 ? ` in ${seconds} s` : ""}</span>
        {count ? ` (${count})` : ""}…
      </span>
    </div>
  );
}

type TimelineBlock<Action, View, Interaction, SpecialistRun> =
  | { kind: "message"; message: TimelineMessage }
  | { kind: "actions"; actions: Action[] }
  | { kind: "view"; view: View }
  | { kind: "interaction"; interaction: Interaction }
  | { kind: "specialistRun"; run: SpecialistRun }
  | { kind: "condensing"; condensing: TaskCondensing };

function timelineBlocks<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed,
>(
  task: TimelineTask<Action, View, Interaction, SpecialistRun>,
): TimelineBlock<Action, View, Interaction, SpecialistRun>[] {
  const actions = task.actions ?? [];
  const entries = [
    ...task.messages
      .map((message, index) => ({
        kind: "message" as const,
        sequence: message.sequence ?? index,
        fallbackOrder: index,
        message,
      }))
      // A turn opens as soon as the model starts speaking, and what it sends
      // first is often a blank line. Drawing that is a response bubble with
      // nothing in it, sitting next to the one saying the work is still
      // running. Filtered here rather than dropped upstream: whatever the
      // reason a message has nothing visible in it, there is nothing to draw.
      .filter(
        (entry) =>
          !entry.message.interactionId &&
          (entry.message.role !== "assistant" || entry.message.text.trim()),
      ),
    ...actions.map((action, index) => ({
      kind: "action" as const,
      sequence: action.sequence ?? task.messages.length + index,
      fallbackOrder: task.messages.length + index,
      action,
    })),
    ...(task.views ?? []).map((view, index) => ({
      kind: "view" as const,
      sequence: view.sequence ?? task.messages.length + actions.length + index,
      fallbackOrder: task.messages.length + actions.length + index,
      view,
    })),
    ...(task.interactions ?? []).map((interaction, index) => ({
      kind: "interaction" as const,
      sequence:
        interaction.sequence ??
        task.messages.length +
          actions.length +
          (task.views?.length ?? 0) +
          index,
      fallbackOrder:
        task.messages.length +
        actions.length +
        (task.views?.length ?? 0) +
        index,
      interaction,
    })),
    ...(task.specialistRuns ?? []).map((run, index) => ({
      kind: "specialistRun" as const,
      sequence:
        run.sequence ??
        task.messages.length +
          actions.length +
          (task.views?.length ?? 0) +
          (task.interactions?.length ?? 0) +
          index,
      fallbackOrder:
        task.messages.length +
        actions.length +
        (task.views?.length ?? 0) +
        (task.interactions?.length ?? 0) +
        index,
      run,
    })),
    // Always saved with their place, so none needs a fallback of its own.
    // "Nothing old enough" is news only until the conversation moves on.
    ...(task.condensings ?? [])
      .filter(
        (condensing) =>
          condensing.outcome !== "failed" ||
          condensing.reason !== "nothing-to-condense" ||
          !task.messages.some(
            (message) => (message.sequence ?? -1) >= condensing.sequence,
          ),
      )
      .map((condensing) => ({
        kind: "condensing" as const,
        sequence: condensing.sequence,
        fallbackOrder: Number.MAX_SAFE_INTEGER,
        condensing,
      })),
  ].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.fallbackOrder - right.fallbackOrder,
  );

  return entries.reduce<
    TimelineBlock<Action, View, Interaction, SpecialistRun>[]
  >((blocks, entry) => {
    if (entry.kind === "message") {
      blocks.push({ kind: "message", message: entry.message });
      return blocks;
    }
    if (entry.kind === "view") {
      blocks.push({ kind: "view", view: entry.view });
      return blocks;
    }
    if (entry.kind === "interaction") {
      blocks.push({ kind: "interaction", interaction: entry.interaction });
      return blocks;
    }
    if (entry.kind === "specialistRun") {
      blocks.push({ kind: "specialistRun", run: entry.run });
      return blocks;
    }
    if (entry.kind === "condensing") {
      blocks.push({ kind: "condensing", condensing: entry.condensing });
      return blocks;
    }
    const previous = blocks.at(-1);
    if (previous?.kind === "actions") {
      previous.actions.push(entry.action);
    } else {
      blocks.push({ kind: "actions", actions: [entry.action] });
    }
    return blocks;
  }, []);
}

/**
 * A conversation as it happened: messages, actions, views and answered
 * questions in the order they occurred, the plan after the latest request, and
 * what the turn is doing or how it ended.
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
  const hasPlan = (task.plan?.length ?? 0) > 0;
  const showWorkingStatus =
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
    (task.actions?.length ?? 0) === 0 &&
    fallbackPhase !== undefined &&
    !fallbackPhase.retry &&
    (fallbackPhase.steps.length > 0 || Boolean(fallbackPhase.note));
  /**
   * What the turn is composing, when nothing else is drawing it.
   *
   * The fallback block below only appears with no plan and no actions, which is
   * the first round and no other, and it gives way to the work trace as soon as
   * there are steps. A real session has actions by its second round — so the
   * note the loop sends was never reaching anybody. Measured in the installed
   * application on 2026-09-14: eight views drawn across 150 seconds, and not one
   * note shown.
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

  const drawn = blocks.map((block, index) => {
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
                  {...userTurnExtras(block.message, pieces.openAttachment)}
                />,
              )
            ) : (
              <UserTurn
                text={block.message.text}
                {...userTurnExtras(block.message, pieces.openAttachment)}
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
        {index === latestUserIndex && <TaskPlan items={task.plan ?? []} />}
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

      {showWorkingStatus && (
        <AgentTurn status compact={compact}>
          <div className={styles["response-status"]} role="status">
            <span aria-hidden="true" />
            Working
          </div>
        </AgentTurn>
      )}

      {composingNote && (
        <AgentTurn status compact={compact}>
          <div className={styles["activity-note"]} role="status">
            <Icon name="code" />
            <span>{composingNote}</span>
          </div>
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

      {task.phase.kind === "completed" && task.phase.outcome.file && (
        <OutcomeCard
          title={task.phase.outcome.title}
          summary={task.phase.outcome.summary}
          file={task.phase.outcome.file}
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
                : (task.phase.reason ??
                  "No further work will run. You can send a follow-up when ready.")}
            </p>
          </Notice>
        </AgentTurn>
      )}
    </>
  );
}
