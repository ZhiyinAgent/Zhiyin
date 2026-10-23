import type { ProducedImage } from "@zhiyin/contract";

/**
 * The most a connection may hand back at all. What the model is shown is
 * bounded later, where every tool's result is: past that, the whole result is
 * kept for the conversation to read again, so this only guards memory.
 */
const maximumResultCharacters = 8_000_000;
/**
 * How many pictures one action may hand back, and how large each may be.
 *
 * Every picture is sent again with every later request in the same turn, so a
 * generous limit here is not paid once. Two is enough for a before and an
 * after; the size is about what a full-window screenshot encodes to.
 */
const maximumImages = 2;
const maximumImageCharacters = 2_000_000;

/**
 * Pictures, taken off the text channel and put on their own.
 *
 * A result reaches the model as text, so an image left inside it is a wall of
 * base64 that costs a fortune and shows nothing. The protocol already
 * distinguishes the two; this keeps that distinction instead of flattening it.
 */
export function separateImages(value: object): {
  readonly value: unknown;
  readonly images: readonly ProducedImage[];
} {
  const content =
    "content" in value && Array.isArray(value.content)
      ? (value.content as readonly unknown[])
      : undefined;
  if (!content) return { value, images: [] };
  const asImage = (item: unknown): ProducedImage | undefined => {
    if (!item || typeof item !== "object") return undefined;
    const block = item as {
      type?: unknown;
      data?: unknown;
      mimeType?: unknown;
    };
    if (block.type !== "image" || typeof block.data !== "string")
      return undefined;
    return {
      mediaType:
        typeof block.mimeType === "string" ? block.mimeType : "image/png",
      data: block.data,
    };
  };
  if (!content.some((item) => asImage(item))) return { value, images: [] };
  const images: ProducedImage[] = [];
  const next = content.map((item) => {
    const image = asImage(item);
    if (!image) return item;
    if (images.length >= maximumImages)
      return {
        type: "text",
        text: "[image not shown: too many in one answer]",
      };
    if (image.data.length > maximumImageCharacters)
      return { type: "text", text: "[image not shown: too large to send]" };
    images.push(image);
    return { type: "text", text: `[image ${images.length}, shown separately]` };
  });
  return { value: { ...value, content: next }, images };
}

/**
 * A result too long to send, made short enough to send.
 *
 * A page of documentation or a page's own text is often longer than a model
 * turn can carry, and refusing it outright throws away an answer that was
 * already found — the tool ran, the network was used, and the top of the reply
 * usually holds what was asked for. So the text is cut and says where it was
 * cut, which is a smaller loss than the whole result and an honest one.
 *
 * A result whose bulk is not text cannot be cut this way, and is still refused
 * rather than sent as something it is not.
 */
export function shortened(value: object): unknown | undefined {
  if (JSON.stringify(value).length <= maximumResultCharacters) return value;
  const content =
    "content" in value && Array.isArray(value.content)
      ? (value.content as readonly unknown[])
      : undefined;
  if (!content) return undefined;
  const isText = (item: unknown): item is { type: "text"; text: string } =>
    Boolean(item) &&
    typeof item === "object" &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string";
  const texts = content.filter(isText);
  if (!texts.length) return undefined;
  const marker = "\n… shortened: the rest was too long to send …";
  const room =
    maximumResultCharacters -
    (JSON.stringify({
      ...value,
      content: content.map((item) =>
        isText(item) ? { ...item, text: "" } : item,
      ),
    }).length +
      texts.length * marker.length);
  if (room <= 0) return undefined;
  const cut = (each: number) => ({
    ...value,
    content: content.map((item) =>
      isText(item) && item.text.length > each
        ? { ...item, text: `${item.text.slice(0, each)}${marker}` }
        : item,
    ),
  });
  // Encoding a character is not the same as counting it — a newline or a quote
  // costs two once written down — so the first cut is measured and, if it is
  // still long, taken again by exactly as much as it overran.
  let each = Math.floor(room / texts.length);
  let next = cut(each);
  const overrun = JSON.stringify(next).length - maximumResultCharacters;
  if (overrun > 0) {
    each -= Math.ceil(overrun / texts.length);
    if (each <= 0) return undefined;
    next = cut(each);
  }
  return JSON.stringify(next).length <= maximumResultCharacters
    ? next
    : undefined;
}
