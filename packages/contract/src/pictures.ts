/** Pictures on their way from a tool, to a model, and into storage. */

/** A stored picture, read back for display. */
export type StoredPicture =
  | {
      readonly status: "ready";
      readonly mediaType: string;
      readonly data: string;
    }
  | { readonly status: "missing"; readonly reason: string };

/**
 * A picture an action produced, for a model that can be shown one.
 *
 * Kept apart from `value` because a model reads a result as text: a screenshot
 * encoded into that text is a megabyte the model cannot see. This is the same
 * picture on the channel it can.
 */
export type ProducedImage = {
  /** An image media type, such as `image/png`. */
  readonly mediaType: string;
  /** The image itself, base64-encoded, without a data URL prefix. */
  readonly data: string;
};

/**
 * What became of a picture on its way to a model that has a size it accepts.
 *
 * A picture too large is not a failed action: the thing it is a picture of is
 * still there to be looked at. What matters is that the model is told what it
 * is looking at — a whole page made small, or a strip too thin to read — so it
 * can decide to look again more closely instead of trusting a blur.
 */
export type FittedPicture =
  | { readonly status: "unchanged"; readonly image: ProducedImage }
  | {
      readonly status: "resized";
      readonly image: ProducedImage;
      /** One sentence for the model: what it is seeing and at what size. */
      readonly note: string;
    }
  | { readonly status: "unusable"; readonly note: string };

/**
 * Brings a picture inside what the configured model accepts.
 *
 * Kept out of the tools that produce pictures: what a model will accept is not
 * a property of a screenshot or of a file on disk, and every tool that answers
 * in pictures would otherwise carry its own copy of the same rule.
 */
export interface PictureFitting {
  fit(image: ProducedImage): Promise<FittedPicture>;
}
