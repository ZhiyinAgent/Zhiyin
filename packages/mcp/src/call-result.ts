/**
 * What a connection answered a call with, as a result: checked, its pictures
 * taken off, its text bounded, and a refusal read in the server's own words.
 */

import type { ProducedFile, ToolInvocationResult } from "@zhiyin/contract";
import { supportedResult } from "./result-validation.js";
import { separateImages, shortened } from "./result-shaping.js";

/** Characters of a refusal kept, as many as the action record holds. */
const maximumReason = 4000;

export function callResult(
  value: unknown,
  present: (result: ToolInvocationResult) => ToolInvocationResult,
  produced: () => readonly ProducedFile[],
): ToolInvocationResult {
  if (!supportedResult(value))
    return { ok: false, reason: "The server returned an invalid result." };
  // Pictures come off the text channel first: what is left is what has to
  // fit, and a screenshot is not something a size limit should judge.
  const separated = separateImages(value);
  const bounded = shortened(separated.value as object);
  if (!bounded)
    return {
      ok: false,
      reason: "The server returned too much data. Request a smaller result.",
    };
  if ("isError" in value && value.isError === true) {
    const content =
      "content" in value && Array.isArray(value.content) ? value.content : [];
    const reason = content
      .filter(
        (item): item is { type: string; text: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          item.type === "text" &&
          typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n");
    return present({
      ok: false,
      reason:
        startAndEnd(reason, maximumReason) ||
        "The server could not complete this action.",
    });
  }
  let files: readonly ProducedFile[];
  try {
    files = produced();
  } catch {
    files = [];
  }
  return present({
    ok: true,
    value: bounded,
    ...(files.length ? { produced: files } : {}),
    ...(separated.images.length ? { images: separated.images } : {}),
  });
}

/**
 * A failure is read for its end as much as its start: a script's traceback
 * ends with the error that stopped it, after whatever it printed first.
 */
function startAndEnd(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const start = Math.floor(maximum / 4);
  // Sized for the most characters that could be left out, so the whole fits.
  const marker = (left: number) => `\n… ${left} characters left out …\n`;
  const end = maximum - start - marker(text.length).length;
  return `${text.slice(0, start)}${marker(text.length - start - end)}${text.slice(-end)}`;
}
