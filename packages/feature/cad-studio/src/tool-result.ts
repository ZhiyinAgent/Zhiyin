/** A call's answer as the model reads it: its text, and the text alone of one that carries a picture. */

export function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no answer)" }],
    ...(isError ? { isError: true } : {}),
  };
}

/** The answer's text, without the picture it carries. */
export function answerText(value: unknown): string {
  const content = (value as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content
        .map((part: { type?: unknown; text?: unknown }) =>
          part.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
        )
        .filter(Boolean)
        .join("\n")
    : "";
}
