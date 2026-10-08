/**
 * What the window reaches of the items kept beside conversations: a long paste,
 * kept before its message is sent so the window never holds it and opened in
 * the person's own editor by the name the store gave it, a picture the person
 * attached, and the pictures an action produced.
 */

import type {
  PasteOutcome,
  PictureToKeep,
  StoredPicture,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";

/** Lines as a reader numbers them: a final line needs no line break. */
function lineCount(text: string): number {
  let breaks = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    breaks += 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** Strict base64: what a browser's reader produces, and nothing else. */
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;

export class KeptItems {
  readonly #sessions: Sessions;
  readonly #seesPictures: () => boolean;

  /** `seesPictures` answers for the model chosen now. */
  constructor(sessions: Sessions, seesPictures: () => boolean) {
    this.#sessions = sessions;
    this.#seesPictures = seesPictures;
  }

  /**
   * A picture for the next message. Refused before anything is stored when the
   * model could not look at it: a picture kept and then quietly left out of
   * the request would be worse than one never taken.
   */
  async keepPicture(picture: PictureToKeep): Promise<PasteOutcome> {
    if (!this.#seesPictures())
      return {
        status: "refused",
        reason:
          "This model can't see pictures. Choose one that can, or describe what's in it.",
      };
    if (!base64.test(picture.data) || picture.data.length % 4 !== 0)
      return {
        status: "refused",
        reason: "This is not a picture Zhiyin can read.",
      };
    const kept = await this.#sessions.keepPicture(picture);
    return kept.status === "kept"
      ? {
          status: "kept",
          attachment: {
            kind: "picture",
            id: kept.id,
            name: picture.name,
            mediaType: picture.mediaType,
            bytes: Buffer.byteLength(picture.data, "base64"),
          },
        }
      : { status: "refused", reason: kept.reason };
  }

  async keepPaste(text: string): Promise<PasteOutcome> {
    const kept = await this.#sessions.keep("pastedText", undefined, { text });
    return kept.status === "kept"
      ? {
          status: "kept",
          attachment: {
            kind: "pastedText",
            id: kept.id,
            bytes: kept.bytes,
            lines: lineCount(text),
          },
        }
      : { status: "refused", reason: kept.reason };
  }

  /**
   * Where a paste is, for opening outside the app: the conversation's own, or
   * a draft not yet sent. Only a text file is ever handed on, so nothing
   * opened this way can run.
   */
  async attachmentPath(taskId: string | null, id: string): Promise<string> {
    if (!id.endsWith(".txt"))
      throw new VisibleError("This pasted text is no longer available.");
    let located = taskId
      ? await this.#sessions.locate("pastedText", taskId, id)
      : undefined;
    if (located?.status !== "ready")
      located = await this.#sessions.locate("pastedText", undefined, id);
    if (located.status !== "ready")
      throw new VisibleError("This pasted text is no longer available.");
    return located.path;
  }

  /**
   * The bytes behind an `image` detail, for whoever is drawing it. The store
   * answers why a picture is gone — deleted to stay inside its limits, or
   * never there — and that answer is passed on rather than replaced.
   */
  async readPicture(source: string): Promise<StoredPicture> {
    return this.#sessions.readPicture(source).catch(() => ({
      status: "missing" as const,
      reason: "This picture could not be read.",
    }));
  }
}
