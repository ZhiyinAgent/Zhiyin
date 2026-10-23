/**
 * What happens to a picture a tool produced on its way to the model.
 *
 * A picture never goes down the text channel. Encoded into the tool result it
 * is a megabyte the model pays for and cannot see, so it is lifted out and sent
 * as itself in the message that follows — and when the model cannot be shown
 * one at all, the result says so rather than leaving an answer that silently
 * refers to nothing.
 */

import type { PictureFitting, ProducedImage } from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { readableToolName } from "../tools/invocation.js";
import { harnessNotice } from "./notices.js";

/**
 * The line left where pictures were let go of. A picture silently missing
 * invites the model to believe it is still looking at it; a sentence saying it
 * is gone does not.
 */
export function picturesLetGo(count: number): string {
  return harnessNotice(
    "picture",
    `${count === 1 ? "A picture" : `${count} pictures`} shown earlier ${count === 1 ? "is" : "are"} no longer attached. Take another if you need to look again.`,
  );
}

/** What a person's message says once the pictures sent with it are let go. */
export function attachedPicturesLetGo(ids: readonly string[]): string {
  return harnessNotice(
    "picture",
    `${ids.length === 1 ? "The picture" : `The ${ids.length} pictures`} the person attached here ${ids.length === 1 ? "is" : "are"} no longer sent with this message. Look again with read_document: ${ids.map((id) => `attachment://${id}`).join(", ")}.`,
  );
}

/**
 * The conversation for a model that cannot see pictures: each picture becomes
 * a sentence saying one was there, so the provider is never sent what it would
 * refuse and the model never answers as if nothing had been shown.
 */
export function withoutPictures(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return messages.map((message) =>
    message.role === "user" &&
    typeof message.content !== "string" &&
    message.content.some((part) => part.kind === "image")
      ? {
          ...message,
          content: message.content.map((part) =>
            part.kind === "image"
              ? {
                  kind: "text" as const,
                  text: harnessNotice(
                    "picture",
                    "A picture was attached here. This model cannot see pictures, so it was not sent.",
                  ),
                }
              : part,
          ),
        }
      : message,
  );
}

export type FittedPictures = {
  /** What the model may be shown, in the order the tool produced it. */
  readonly pictures: readonly ProducedImage[];
  /** Which of the produced pictures each one is. */
  readonly from: readonly number[];
  /** What was done to them, in words the record and the model both get. */
  readonly notes: readonly string[];
};

/**
 * Every picture is checked against what this model accepts before it is sent.
 * One too large is not a failure: it is scaled and the model is told so, or —
 * when nothing in it would survive being scaled — described instead of sent,
 * with what to do about it.
 */
export async function fitPictures(
  produced: readonly ProducedImage[],
  fitting: PictureFitting | undefined,
): Promise<FittedPictures> {
  const pictures: ProducedImage[] = [];
  const from: number[] = [];
  const notes: string[] = [];
  for (const [index, picture] of produced.entries()) {
    const fitted = await fitting?.fit(picture);
    if (fitted?.status === "unusable") {
      notes.push(fitted.note);
      continue;
    }
    pictures.push(fitted ? fitted.image : picture);
    from.push(index);
    if (fitted?.status === "resized") notes.push(fitted.note);
  }
  return { pictures, from, notes };
}

/** The line the tool result carries when the pictures are not being sent. */
export function picturesNotSent(
  produced: readonly ProducedImage[],
  fitted: FittedPictures,
  acceptsImages: boolean,
): string | undefined {
  if (produced.length && !acceptsImages)
    return `${produced.length === 1 ? "1 picture was" : `${produced.length} pictures were`} produced. This model cannot be shown pictures, so ${produced.length === 1 ? "it was" : "they were"} not sent.`;
  if (fitted.notes.length && !fitted.pictures.length)
    return fitted.notes.join(" ");
  return undefined;
}

/** The line the pictures are sent under, naming where they came from. */
export function pictureCaption(
  toolName: string,
  fitted: FittedPictures,
): string {
  return harnessNotice(
    "picture",
    [
      `${fitted.pictures.length === 1 ? "The picture" : "The pictures"} from ${readableToolName(toolName)}:`,
      ...fitted.notes,
    ].join(" "),
  );
}
