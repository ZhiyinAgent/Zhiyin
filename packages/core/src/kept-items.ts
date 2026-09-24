/**
 * What the window reaches of the items kept beside conversations: a long paste,
 * kept before its message is sent so the window never holds it and opened in
 * the person's own editor by the name the store gave it, and the pictures an
 * action produced.
 */

import type { PasteOutcome, StoredPicture } from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { Sessions } from "@zhiyin/session";

/** Lines as a reader numbers them: a final line needs no line break. */
function lineCount(text: string): number {
  let breaks = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    breaks += 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

export class KeptItems {
  readonly #sessions: Sessions;

  constructor(sessions: Sessions) {
    this.#sessions = sessions;
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
   * Where a paste is, for opening outside the app. Only a text file is ever
   * handed on, so nothing opened this way can run.
   */
  async attachmentPath(taskId: string | null, id: string): Promise<string> {
    const located = id.endsWith(".txt")
      ? await this.#sessions.locate("pastedText", taskId ?? undefined, id)
      : undefined;
    if (located?.status !== "ready")
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
