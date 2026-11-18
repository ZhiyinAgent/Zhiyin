import type { ViewCheckOutcome, ViewCheckRequest } from "@zhiyin/contract";
import { parseChartData, type ChartData } from "./chartData.js";
import { drawnView } from "./drawnView.js";
import { validateMermaid } from "./mermaidRuntime.js";

function reason(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "The drawing library rejected this view.";
  return message.replace(/\s+/g, " ").slice(0, 4000);
}

/**
 * Whether the view can be drawn, and once it can, what drawing it decided and
 * a picture of it, for the model that asked for it.
 */
export async function validateView(
  request: ViewCheckRequest,
): Promise<ViewCheckOutcome> {
  let parsed: { chart?: ChartData; diagramType?: string | undefined };
  try {
    parsed =
      request.kind === "diagram"
        ? { diagramType: await validateMermaid(request.source) }
        : { chart: parseChartData(request.kind, request.source) };
  } catch (error) {
    return { ok: false, reason: reason(error) };
  }
  const drawn = await drawnView(request, parsed, request.source);
  return drawn ? { ok: true, drawn } : { ok: true };
}
