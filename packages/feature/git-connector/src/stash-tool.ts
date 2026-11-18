/** Setting changes aside and back: `git_stash`. */

import { basename } from "node:path";
import {
  argumentsInspection,
  changeOutput,
  commandLine,
  errorResult,
  readAnswer,
  textResult,
  type GitToolDefinition,
} from "./git-tool.js";
import { leftUncommitted, reader, stashCount } from "./resulting-state.js";

function stashAction(args: unknown): "save" | "pop" | "list" | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["action"]
      : undefined;
  return value === "save" || value === "pop" || value === "list"
    ? value
    : undefined;
}

function stashMessage(args: unknown): string | undefined {
  const value =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)["message"]
      : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const stashTool: GitToolDefinition = {
  spec: {
    name: "git_stash",
    label: "Stash changes",
    description:
      "Save the working tree's uncommitted changes aside, restore them, or list what is stashed. After a save or a restore, the answer gives how many stashes are kept and what is left uncommitted; a save with nothing to stash is an error.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["save", "pop", "list"] },
        message: {
          type: "string",
          description: "A note for a saved stash. Only used with `save`.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  access: "change",
  async inspect({ root, top }, args) {
    const action = stashAction(args);
    if (!action) return argumentsInspection("Choose one of: save, pop, list.");
    const message = stashMessage(args);
    const commands = {
      save: commandLine(["stash", "push", ...(message ? ["-m", message] : [])]),
      pop: "git stash pop",
      list: "git stash list",
    } as const;
    const details = {
      // Git stashes and restores the whole repository's tracked changes,
      // whichever of its folders it runs in.
      save: `Sets aside the uncommitted changes to tracked files across the whole repository at ${top}, and leaves new files where they are.`,
      pop: `Restores the most recently stashed changes across the whole repository at ${top}, and removes them from the stash.`,
      list: undefined,
    } as const;
    return {
      ok: true,
      action:
        action === "save"
          ? "Stash uncommitted changes"
          : action === "pop"
            ? "Restore the last stash"
            : "List stashes",
      target: basename(root),
      command: commands[action],
      access: action === "list" ? "read" : "change",
      ...(details[action] ? { detail: details[action] } : {}),
      // Saving and restoring run the repository's own filters (ADR 0012).
      ...(action === "list" ? {} : { asksEachTime: true as const }),
    };
  },
  async execute(call, args) {
    const action = stashAction(args);
    if (!action) return errorResult("Choose one of: save, pop, list.");
    const message = stashMessage(args);
    if (action === "list") return readAnswer(call, ["stash", "list"]);
    const read = reader(call);
    const before = await stashCount(read);
    const ran = await changeOutput(
      call,
      action === "save"
        ? ["stash", "push", ...(message ? ["-m", message] : [])]
        : ["stash", "pop"],
    );
    if ("failed" in ran) return ran.failed;
    const after = await stashCount(read);
    // git answers a stash of nothing with success and keeps no stash.
    if (action === "save" && before !== undefined && after === before)
      return errorResult("Nothing was stashed: no tracked file has changes.");
    const kept = after === undefined ? "" : `Stashes kept: ${after}. `;
    return textResult(
      `${ran.text}\n${kept}${await leftUncommitted(read)}`.trim(),
    );
  },
};
