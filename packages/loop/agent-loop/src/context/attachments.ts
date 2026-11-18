/**
 * How a message with pasted text or pictures reaches a model: the person's
 * words, then one line per attachment naming where it is kept. A paste's text
 * is never inlined; the model reads it by its address, a page at a time. A
 * picture is sent beside the words, and can be looked at again by its address.
 * The tools that read those addresses say so in their own descriptions.
 */

import type { MessageAttachment, TaskMessage } from "@zhiyin/contract";
import { readableSize } from "./result-size.js";

function attachmentLine(attachment: MessageAttachment): string {
  return attachment.kind === "picture"
    ? `Picture attached as attachment://${attachment.id} (${attachment.name}); look at it again by that address`
    : `Pasted text saved as attachment://${attachment.id} (${readableSize(attachment.bytes)}, ${attachment.lines.toLocaleString("en-US")} lines); read it by that address`;
}

/** A message's text as a model is sent it. */
export function modelText(
  message: Pick<TaskMessage, "text" | "attachments">,
): string {
  return [message.text, ...(message.attachments ?? []).map(attachmentLine)]
    .filter(Boolean)
    .join("\n\n");
}
