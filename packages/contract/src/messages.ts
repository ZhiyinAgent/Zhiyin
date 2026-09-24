import type { ReasoningTrace } from "./reasoning.js";

/**
 * A long text the person pasted, kept beside the conversation instead of in
 * the message. The model is told its address and reads it with `read_file`.
 */
export type MessageAttachment = {
  readonly kind: "pastedText";
  readonly id: string;
  readonly bytes: number;
  readonly lines: number;
};

export type PasteOutcome =
  | { readonly status: "kept"; readonly attachment: MessageAttachment }
  | { readonly status: "refused"; readonly reason: string };

export type TaskMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments?: readonly MessageAttachment[];
  readonly reasoning?: ReasoningTrace;
  /** The structured interaction that already renders this model-facing answer. */
  readonly interactionId?: string;
  /** Optional so task history saved before ordered timeline entries can load. */
  readonly sequence?: number;
};
