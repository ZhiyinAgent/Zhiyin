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
import { readableToolName } from "./invocation.js";
import { harnessNotice } from "./notices.js";

/**
 * How many pictures one request may still be carrying.
 *
 * Every picture is sent again with every later request in the same turn, so a
 * turn that keeps looking at the screen pays for all of them each time.
 * Providers also count: Z.AI documents a per-request limit of 150 images for
 * the GLM-5V and 4.6V series and 50 for GLM-4.5V (verified 2026-09-09). This
 * is well under either, and chosen for the cost rather than the ceiling — the
 * recent ones are what a turn is reasoning about.
 */
const picturesKeptInOneRequest = 8;

/**
 * Drops the pictures a turn has moved past, leaving a line where each was.
 * A picture silently missing invites the model to believe it is still looking
 * at it; a sentence saying it is gone does not.
 */
export function letGoOfOlderPictures(messages: ModelMessage[]): void {
  const carrying: number[] = [];
  for (const [index, message] of messages.entries())
    if (
      message.role === "user" &&
      typeof message.content !== "string" &&
      message.content.some((part) => part.kind === "image")
    )
      carrying.push(index);
  for (const index of carrying.slice(0, -picturesKeptInOneRequest)) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") continue;
    const gone = content.filter((part) => part.kind === "image").length;
    messages[index] = {
      role: "user",
      content: [
        {
          kind: "text",
          text: harnessNotice(
            "picture",
            `${gone === 1 ? "A picture" : `${gone} pictures`} shown earlier in this turn ${gone === 1 ? "is" : "are"} no longer attached. Take another if you need to look again.`,
          ),
        },
      ],
    };
  }
}

export type FittedPictures = {
  /** What the model may be shown, in the order the tool produced it. */
  readonly pictures: readonly ProducedImage[];
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
  const notes: string[] = [];
  for (const picture of produced) {
    const fitted = await fitting?.fit(picture);
    if (!fitted) {
      pictures.push(picture);
      continue;
    }
    if (fitted.status === "unusable") {
      notes.push(fitted.note);
      continue;
    }
    pictures.push(fitted.image);
    if (fitted.status === "resized") notes.push(fitted.note);
  }
  return { pictures, notes };
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

/** Sends the pictures as themselves, and lets go of the ones before them. */
export function sendPictures(
  messages: ModelMessage[],
  toolName: string,
  fitted: FittedPictures,
): void {
  messages.push({
    role: "user",
    content: [
      {
        kind: "text",
        text: harnessNotice(
          "picture",
          [
            `${fitted.pictures.length === 1 ? "The picture" : "The pictures"} from ${readableToolName(toolName)}:`,
            ...fitted.notes,
          ].join(" "),
        ),
      },
      ...fitted.pictures.map((picture) => ({
        kind: "image" as const,
        mediaType: picture.mediaType,
        data: picture.data,
      })),
    ],
  });
  letGoOfOlderPictures(messages);
}
