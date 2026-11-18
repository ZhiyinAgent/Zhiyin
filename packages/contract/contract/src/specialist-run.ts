import type { ModelHistoryEntry } from "./model-history.js";
import type { ModelResponseRecord } from "./model-response.js";

/** What a plugin's specialist is allowed to request. */
export type SpecialistDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly provenance: { readonly source: "plugin"; readonly pluginId: string };
  readonly access?: "read" | "change";
  /**
   * The tools it may use, by their own names: a tool of one of `connections`
   * by the name its connection gives it, any other by the name it is offered
   * under.
   */
  readonly tools?: readonly string[];
  /** The ids of its plugin's connections, whose tools `tools` may name. */
  readonly connections?: readonly string[];
};

/** What a specialist reports when it finishes: one text, in Markdown. */
export type SpecialistHandoff = {
  readonly report: string;
};

/** One durable child run attached to the task that owns its authority. */
export type SpecialistRun = {
  readonly id: string;
  readonly parentRunId?: string;
  readonly specialist: SpecialistDefinition;
  readonly task: string;
  readonly depth: number;
  readonly status: "running" | "completed" | "failed" | "interrupted";
  readonly startedAt: string;
  readonly finishedAt?: string;
  /** Its place on the timeline: where it was delegated. */
  readonly sequence: number;
  /** Ids of actions stamped with this run, in call order. */
  readonly actionIds: readonly string[];
  readonly handoff?: SpecialistHandoff;
  readonly reason?: string;
  /** False until the parent has a durable notice of this result. */
  readonly handoffDelivered?: boolean;
  /**
   * Settled when or before the person stopped its turn, or interrupted by a
   * restart: told to the next turn they start, and never waking the
   * conversation, after a restart too.
   */
  readonly quiet?: true;
  /**
   * What it said and was answered after its instructions and task, as it was
   * sent: its words and calls, their results, and what Zhiyin told it. Kept
   * when the run ends; a run cut off by Zhiyin closing keeps only its actions.
   */
  readonly transcript?: readonly SpecialistTranscriptEntry[];
  /** The record of each of its model requests, as a conversation keeps its own. */
  readonly modelResponses?: readonly ModelResponseRecord[];
};

/** One entry of what a specialist was sent, pictures named by where they are stored. */
export type SpecialistTranscriptEntry = Extract<
  ModelHistoryEntry,
  { readonly kind: "calls" | "result" | "notice" | "pictures" }
>;
