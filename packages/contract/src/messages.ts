import type { ReasoningTrace } from "./reasoning.js";
import type { ReasoningSelection } from "./reasoning.js";

export type SendMessage = (
  taskId: string,
  message: string,
  reasoning?: ReasoningSelection,
  attachments?: readonly string[],
  delivery?: "guidance",
) => Promise<void>;

/**
 * A long text the person pasted, kept beside the conversation instead of in
 * the message. The model is told its address and reads it with `read_file`.
 */
export type PastedTextAttachment = {
  readonly kind: "pastedText";
  readonly id: string;
  readonly bytes: number;
  readonly lines: number;
};

/**
 * A picture the person pasted, dropped or attached. Sent to the model with
 * the message, and readable again with `read_document` by its address.
 */
export type PictureAttachment = {
  readonly kind: "picture";
  readonly id: string;
  /** The file's name, or `pasted-<time>.png` for one from the clipboard. */
  readonly name: string;
  readonly mediaType: string;
  /** The picture's own size, not its encoding's. */
  readonly bytes: number;
  /** Where it is stored, once its message is sent; read with `readPicture`. */
  readonly source?: string;
};

export type MessageAttachment = PastedTextAttachment | PictureAttachment;

/** As many pictures as one request keeps, so a message never loses its own. */
export const picturesPerMessage = 8;

/** The pictures a person may attach: the kinds every vision model reads. */
export const attachablePictureTypes: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** A picture as the window hands it over, before it is kept. */
export type PictureToKeep = {
  readonly name: string;
  readonly mediaType: string;
  /** Base64, without a data URL prefix. */
  readonly data: string;
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
  /** Its place on the timeline, shared with actions, views and the rest. */
  readonly sequence: number;
};

/** A message sent during a turn, waiting for a safe boundary or left as a draft. */
export type TaskGuidance = {
  readonly id: string;
  readonly text: string;
  readonly attachments?: readonly MessageAttachment[];
  readonly status: "pending" | "draft";
};
