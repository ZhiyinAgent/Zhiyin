import type { DrawnView, ProducedImage } from "@zhiyin/contract";

/**
 * What the window says it drew arrives from another process, so it is taken
 * as words and a PNG of bounded size or not at all. A view the window
 * accepted is accepted either way: what was drawn is extra.
 */

const mostFacts = 60;
const longestFact = 1_000;
/** Base64 characters: about 6 MB of PNG, past any picture the window makes. */
const largestPicture = 8 * 1024 * 1024;
/** As large a drawing as write_file writes: 2 MiB. */
const largestFile = 2 * 1024 * 1024;

function file(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= largestFile &&
    /^<svg[\s>]/.test(value)
    ? value
    : undefined;
}

function picture(value: unknown): ProducedImage | undefined {
  const given = value as Partial<ProducedImage> | undefined;
  return given &&
    given.mediaType === "image/png" &&
    typeof given.data === "string" &&
    given.data.length <= largestPicture &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(given.data)
    ? { mediaType: "image/png", data: given.data }
    : undefined;
}

export function drawnFrom(value: unknown): DrawnView | undefined {
  const facts = (value as { facts?: unknown } | undefined)?.facts;
  if (
    !Array.isArray(facts) ||
    !facts.every((fact): fact is string => typeof fact === "string")
  )
    return undefined;
  const kept = facts
    .slice(0, mostFacts)
    .map((fact) =>
      [...fact].length > longestFact
        ? `${[...fact].slice(0, longestFact).join("")}…`
        : fact,
    );
  const left = facts.length - kept.length;
  if (left > 0)
    kept.push(
      `${left} more ${left === 1 ? "fact was" : "facts were"} left out.`,
    );
  const shown = picture((value as { picture?: unknown }).picture);
  const svg = file((value as { svg?: unknown }).svg);
  return {
    facts: kept,
    ...(shown ? { picture: shown } : {}),
    ...(svg ? { svg } : {}),
  };
}
