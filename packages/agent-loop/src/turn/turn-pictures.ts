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
