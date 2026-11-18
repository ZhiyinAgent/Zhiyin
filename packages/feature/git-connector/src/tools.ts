/** Every git tool the connector offers, and how a result is shown. */

import type { ActionDetail, ToolInvocationResult } from "@zhiyin/contract";
import {
  branchTool,
  createBranchTool,
  switchBranchTool,
} from "./branch-tools.js";
import { commitTool, stageTool } from "./commit-tools.js";
import type { GitToolDefinition } from "./git-tool.js";
import { logTool, showTool } from "./history-tools.js";
import { stashTool } from "./stash-tool.js";
import { diffTool, statusTool } from "./status-tools.js";

export const gitTools: readonly GitToolDefinition[] = [
  statusTool,
  diffTool,
  logTool,
  showTool,
  branchTool,
  stageTool,
  commitTool,
  stashTool,
  createBranchTool,
  switchBranchTool,
];

export function describeGitResult(
  result: ToolInvocationResult,
): readonly ActionDetail[] {
  if (!result.ok) return [];
  const value = result.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("content" in value) ||
    !Array.isArray((value as { content: unknown }).content)
  )
    return [];
  const text = (value as { content: readonly { text?: string }[] }).content
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
  return text ? [{ kind: "text", label: "What git answered", text }] : [];
}
