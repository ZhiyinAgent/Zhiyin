/**
 * The tools the loop itself calls, found by the part their own feature says
 * they play, never by their names: renaming one is that feature's change
 * alone.
 */

import type { ToolSpec } from "@zhiyin/contract";

/** The name of the tool among `tools` that plays `role`, if one is offered. */
export function toolPlaying(
  tools: readonly ToolSpec[],
  role: NonNullable<ToolSpec["role"]>,
): string | undefined {
  return tools.find((tool) => tool.role === role)?.name;
}
