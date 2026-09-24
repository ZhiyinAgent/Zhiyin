/**
 * How a message with pasted text reaches a model: the person's words, then one
 * line per paste naming where it is kept. The text itself is never inlined;
 * the model reads it with `read_file`, a page at a time.
 */

import type { MessageAttachment, TaskMessage } from "@zhiyin/contract";
import { readableSize } from "./result-size.js";

export function attachmentLine(attachment: MessageAttachment): string {
  return `Pasted text saved as attachment://${attachment.id} (${readableSize(attachment.bytes)}, ${attachment.lines.toLocaleString("en-US")} lines); read it with read_file`;
}

/** A message's text as a model is sent it. */
export function modelText(
  message: Pick<TaskMessage, "text" | "attachments">,
): string {
  return [message.text, ...(message.attachments ?? []).map(attachmentLine)]
    .filter(Boolean)
    .join("\n\n");
}
