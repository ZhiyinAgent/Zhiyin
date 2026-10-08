/** What a plugin's specialist is allowed to request. */
export type SpecialistDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly provenance: { readonly source: "plugin"; readonly pluginId: string };
  readonly access?: "read" | "change";
  readonly tools?: readonly string[];
};

export type SpecialistHandoff = {
  readonly summary: string;
  readonly findings: readonly string[];
  readonly recommendations: readonly string[];
  readonly limitations: readonly string[];
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
};
