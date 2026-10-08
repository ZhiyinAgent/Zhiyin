/** Identifies the running core. Answers "what am I actually talking to". */
export interface CoreInfo {
  readonly version: string;
}

/** One step of a running turn's work, as the conversation shows it. */
export type WorkStep = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: "complete" | "active" | "queued" | "failed";
};
