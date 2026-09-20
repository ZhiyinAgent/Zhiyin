import type { ViewCheckOutcome, ViewCheckRequest } from "@zhiyin/contract";
import { parseChartData } from "./chartData.js";
import { validateMermaid } from "./mermaidRuntime.js";

function reason(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "The drawing library rejected this view.";
  return message.replace(/\s+/g, " ").slice(0, 4000);
}

export async function validateView(
  request: ViewCheckRequest,
): Promise<ViewCheckOutcome> {
  try {
    if (request.kind === "diagram") await validateMermaid(request.source);
    else parseChartData(request.kind, request.source);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reason(error) };
  }
}
