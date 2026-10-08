/**
 * What a connection answered a call with, as a result: checked, its pictures
 * taken off, its text bounded, and a refusal read in the server's own words.
 */

import type { ProducedFile, ToolInvocationResult } from "@zhiyin/contract";
import { supportedResult } from "./result-validation.js";
import { separateImages, shortened } from "./result-shaping.js";

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
      .join("\n")
      .slice(0, 4000);
    return present({
      ok: false,
      reason: reason || "The server could not complete this action.",
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
