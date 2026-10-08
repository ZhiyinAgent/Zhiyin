/**
 * What a conversation's timeline is made of, and the order its pieces are
 * drawn in: messages, actions, views, answered questions, specialist runs and
 * condensings, placed by when they happened.
 */

import type {
  MessageAttachment,
  ReasoningTrace as Trace,
  TaskCondensing,
  TaskPlanItem,
} from "@zhiyin/contract";
import type { WorkStep } from "./WorkTrace.js";

/**
 * Something the timeline places by when it happened, without knowing what it
 * is. Actions, views and answered questions are drawn by their own modules.
 */
export type Placed = { readonly id: string; readonly sequence: number };

export type TimelineMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments?: readonly MessageAttachment[];
  readonly interactionId?: string;
  readonly sequence: number;
  readonly reasoning?: Trace;
};

type TimelinePhase =
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
      };
    }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly remedies?: readonly import("@zhiyin/contract").TurnRemedy[];
    }
  | { readonly kind: "interrupted"; readonly reason?: string };

export type TimelineTask<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed = never,
> = {
  readonly id: string;
  readonly messages: readonly TimelineMessage[];
  readonly actions: readonly Action[];
  readonly views: readonly View[];
  readonly interactions: readonly Interaction[];
  readonly specialistRuns: readonly SpecialistRun[];
  /** Each attempt to condense the conversation, drawn by the conversation. */
  readonly condensings: readonly TaskCondensing[];
  /** The last message the model now knows only from a summary. */
  readonly condensedThrough?: string;
  readonly plan: readonly TaskPlanItem[];
  readonly phase: TimelinePhase;
  /** The earlier part is being summarised now, whatever the turn is doing. */
  readonly compacting?: boolean;
  /**
   * Specialists still running after the turn itself has finished: the only
   * thing the conversation is waiting on.
   */
  readonly waitingOn?: WaitingOn;
};

export type WaitingOn = {
  readonly names: readonly string[];
  /** Calls the running specialists have made between them. */
  readonly calls: number;
  /** When the first of them started. */
  readonly since: string;
};

export type TimelineBlock<Action, View, Interaction, SpecialistRun> =
  | { kind: "message"; message: TimelineMessage }
  | { kind: "actions"; actions: Action[] }
  | { kind: "view"; view: View }
  | { kind: "interaction"; interaction: Interaction }
  | { kind: "specialistRun"; run: SpecialistRun }
  | { kind: "condensing"; condensing: TaskCondensing };

export function timelineBlocks<
  Action extends Placed,
  View extends Placed,
  Interaction extends Placed,
  SpecialistRun extends Placed,
>(
  task: TimelineTask<Action, View, Interaction, SpecialistRun>,
): TimelineBlock<Action, View, Interaction, SpecialistRun>[] {
  // Sorted by place on the timeline. The sort is stable, so entries sharing a
  // place keep the order of the kinds listed here.
  const entries = [
    ...task.messages
      .map((message) => ({
        kind: "message" as const,
        sequence: message.sequence,
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
    ...task.actions.map((action) => ({
      kind: "action" as const,
      sequence: action.sequence,
      action,
    })),
    ...task.views.map((view) => ({
      kind: "view" as const,
      sequence: view.sequence,
      view,
    })),
    ...task.interactions.map((interaction) => ({
      kind: "interaction" as const,
      sequence: interaction.sequence,
      interaction,
    })),
    ...task.specialistRuns.map((run) => ({
      kind: "specialistRun" as const,
      sequence: run.sequence,
      run,
    })),
    // "Nothing old enough" is news only until the conversation moves on.
    ...task.condensings
      .filter(
        (condensing) =>
          condensing.outcome !== "failed" ||
          condensing.reason !== "nothing-to-condense" ||
          !task.messages.some(
            (message) => message.sequence >= condensing.sequence,
          ),
      )
      .map((condensing) => ({
        kind: "condensing" as const,
        sequence: condensing.sequence,
        condensing,
      })),
    // A condensing comes before what shares its place, which was sent while
    // it ran: its summary stands for everything above.
  ].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      Number(right.kind === "condensing") - Number(left.kind === "condensing"),
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
