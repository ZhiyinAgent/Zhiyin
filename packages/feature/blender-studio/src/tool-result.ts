/** A call's answer as the model reads it, and as the person reads how it went. */

import type { ActionDetail, ToolInvocationResult } from "@zhiyin/contract";

export function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no answer)" }],
    ...(isError ? { isError: true } : {}),
  };
}

/** The text of a tool's answer, without the pictures it carries. */
function answerText(value: unknown): string {
  const content = (value as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content
        .map((part: { type?: unknown; text?: unknown }) =>
          part.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
        )
        .filter((part) => part && !part.startsWith("[image"))
        .join("\n")
    : "";
}

/** How a finished call went, for the person to read. */
export function resultDetails(
  name: string,
  result: ToolInvocationResult,
): readonly ActionDetail[] {
  if (!result.ok)
    return [{ kind: "text", label: "Blender's answer", text: result.reason }];
  const answer = answerText(result.value);
  if (!answer) return [];
  // What a script printed, and Blender's own API listing, are kept as
  // they were written.
  if (name === "blender_run_script")
    return [{ kind: "text", label: "What it printed", text: answer }];
  if (name === "blender_api")
    return [{ kind: "text", label: "Blender's answer", text: answer }];
  return [
    {
      kind: "facts",
      items: [
        {
          label: name === "blender_describe_scene" ? "The scene" : "Blender",
          value: answer,
        },
      ],
    },
  ];
}
