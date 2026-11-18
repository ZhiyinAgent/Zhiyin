import type { ProducedImage } from "./pictures.js";

/**
 * One piece of studio work ready for review: a scene or a part the
 * conversation changed that has a spec. The studio writes it from what it
 * measured and drew, never from the conversation that built the work.
 */
export type ReviewMaterial = {
  /** The plugin's reviewer, as `3d-rendering/scene-reviewer`. */
  readonly reviewer: string;
  /** What is reviewed, in words: "the scene kitchen.blend". */
  readonly subject: string;
  /**
   * In Markdown: each requirement as first written in this conversation, the
   * ones removed since listed as removed, and the latest measures of each.
   */
  readonly brief: string;
  /** Fresh views of it, drawn for the reviewer; none for a model that cannot see them. */
  readonly pictures: readonly ProducedImage[];
};

/** What each studio hands a reviewer, joined in the composition root. */
export interface StudioReviews {
  /** The reviewer its work goes to, as `3d-rendering/scene-reviewer`. */
  readonly reviewer: string;
  /**
   * The work the conversation changed since `since` that has a spec, each
   * piece as its studio hands it over; nothing when none was. `pictures`
   * says whether the reviewer can be shown views.
   */
  changedSince(
    conversationId: string,
    since: Date,
    pictures: boolean,
  ): Promise<readonly ReviewMaterial[]>;
  /**
   * Whether the conversation changed work with a spec since `since`, read
   * from the studio's records alone, without measuring or drawing anything:
   * what says a review will come when the turn ends.
   */
  hasChangedSince(conversationId: string, since: Date): Promise<boolean>;
}
