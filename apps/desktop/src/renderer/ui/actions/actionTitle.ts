import type { TaskAction } from "@zhiyin/contract";

/** Older connector actions stored the routed tool name as their title. */
export function actionTitle(action: TaskAction): string {
  if (!action.toolName?.startsWith("mcp_")) return action.action;
  const prefix = `Use ${action.target}: `;
  if (!action.action.startsWith(prefix)) return action.action;
  const words = action.action
    .slice(prefix.length)
    .replace(/[_-]+/g, " ")
    .trim();
  const operation = words
    .toLowerCase()
    .startsWith(`${action.target.toLowerCase()} `)
    ? words.slice(action.target.length + 1)
    : words;
  if (
    !operation ||
    operation.toLowerCase() === action.target.split(/\s+/).at(-1)?.toLowerCase()
  )
    return action.target;
  return `${action.target} · ${operation[0]!.toUpperCase()}${operation.slice(1)}`;
}
