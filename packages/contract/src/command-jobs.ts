/**
 * A command that carried on as a job of its conversation (ADR 0007), as a
 * person sees it while it runs.
 */
export type RunningCommand = {
  /** The job's name in its conversation, such as "J1". */
  readonly id: string;
  /** The command as it was approved. */
  readonly command: string;
  /** The sentence it was approved with: what it does, for a person. */
  readonly explanation: string;
  /** When it started, in milliseconds since the epoch. */
  readonly startedAt: number;
};

/** The ends of what a running command has printed so far. */
export type CommandOutput = {
  readonly stdout: string;
  readonly stderr: string;
};
