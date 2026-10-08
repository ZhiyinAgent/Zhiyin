/**
 * `close_document`: gives back the space beside the conversation (ADR 0018).
 *
 * This feature cannot reach the document panel, and does not need to: the
 * call says it closes the document, and the agent loop has the app close it
 * and say what the person sees then. The tool itself changes nothing.
 */

import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";

export const closeDocumentSpec: ToolSpec = {
  name: "close_document",
  description:
    "Close the document shown beside the conversation. Use it once the person no longer needs to look at it, for example when you move on to other work. Do not close it to give your answer: leave open the page your answer rests on, so the person can check it. The file is not changed. If the person chose what that space shows during this turn, it stays as they chose and the result says so.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export function inspectCloseDocument(): ToolCallInspection {
  return {
    ok: true,
    action: "Close document",
    target: "The document beside the conversation",
    command: "close_document()",
    access: "read",
    scope: "workspace",
    closesDocument: true,
  };
}

export function runCloseDocument(): ToolInvocationResult {
  return { ok: true, value: {} };
}
