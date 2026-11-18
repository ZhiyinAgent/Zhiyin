/**
 * The pictures a call made, as a turn's or a specialist's model is shown them: fitted to what
 * the model accepts, sent as themselves after the call's answer, each with
 * where it is stored, or a line in the answer where none can be sent.
 */

import type { ProducedImage, ToolOwner, ToolSpec } from "@zhiyin/contract";
import { readableToolName } from "../tools/invocation.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { ModelHistory, SentPicture } from "../context/model-history.js";
import type { RoundPictures } from "../round/round-answers.js";
import type { ToolCallOutcome } from "../tools/tool-calls.js";
import type { TurnRecords } from "./turn-records.js";
import type { AssembledToolCall } from "./turn-shared.js";
import {
  fitPictures,
  pictureCaption,
  picturesNotSent,
  type FittedPictures,
} from "./turn-pictures.js";

/** What sending a call's pictures uses. */
export type PictureSendingDependencies = Pick<
  AgentLoopDependencies,
  "host" | "kept" | "pictures"
>;

export class PictureSending implements RoundPictures {
  readonly #deps: PictureSendingDependencies;
  readonly #records: TurnRecords;
  readonly #taskId: string;
  readonly #history: Pick<ModelHistory, "pictures">;

  constructor(
    deps: PictureSendingDependencies,
    records: TurnRecords,
    taskId: string,
    history: Pick<ModelHistory, "pictures">,
  ) {
    this.#deps = deps;
    this.#records = records;
    this.#taskId = taskId;
    this.#history = history;
  }

  async fit(
    call: AssembledToolCall,
    outcome: ToolCallOutcome,
    owner: ToolOwner | undefined,
    offered: readonly ToolSpec[],
  ) {
    const taskId = this.#taskId;
    const produced = outcome.result.ok ? (outcome.result.images ?? []) : [];
    const seen = this.#deps.host.acceptsImages();
    // A picture the model is never shown is not made to fit for it.
    const fitted = seen
      ? await fitPictures(produced, this.#deps.pictures)
      : { pictures: [], from: [], notes: [] };
    if (fitted.notes.length && outcome.actionId)
      await this.#records.notePictureFitting(taskId, outcome.actionId, [
        ...fitted.notes,
      ]);
    const shown = picturesNotSent(produced, fitted, seen);
    return {
      fields: shown ? { picturesNotSent: shown } : {},
      send: async () => {
        if (fitted.pictures.length && seen)
          await this.#history.pictures(
            pictureCaption(readableToolName(call.name, offered), fitted),
            await this.#stored(
              outcome.actionId,
              produced,
              fitted,
              owner === "mcp" ? "connector" : "tool",
            ),
          );
      },
    };
  }

  /**
   * The pictures as sent, each with where it is stored. One the action already
   * stored unchanged is named by that; one made to fit is stored as sent.
   */
  async #stored(
    actionId: string | undefined,
    produced: readonly ProducedImage[],
    fitted: FittedPictures,
    owner: "tool" | "connector",
  ): Promise<SentPicture[]> {
    const taskId = this.#taskId;
    const kept = (
      this.#records.task(taskId).actions.find((item) => item.id === actionId)
        ?.details ?? []
    ).flatMap((detail) => (detail.kind === "image" ? [detail.source] : []));
    return Promise.all(
      fitted.pictures.map(async (picture, index) => {
        const from = fitted.from[index] ?? -1;
        const source =
          kept.length === produced.length && picture === produced[from]
            ? kept[from]
            : await this.#deps.kept
                .savePicture(taskId, picture, owner)
                .catch(() => "");
        return { ...picture, source: source ?? "" };
      }),
    );
  }
}
