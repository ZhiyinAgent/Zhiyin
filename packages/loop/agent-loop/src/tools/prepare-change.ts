/**
 * `prepare_change` (ADR 0031): saves one file of the conversation's folder,
 * or of a folder granted for changing, now, so the next program may change
 * it and going back can still put it back. A turn watches at most so many
 * files; past that, a large file not saved yet is held read-only from a
 * sealed program until it is saved.
 *
 * Its effects: it reads the one file, inside one of those folders, and keeps
 * its bytes in Zhiyin's own store, within the undo budget. It changes no
 * file of the person's and sends nothing anywhere, so it asks nothing.
 */

import { isAbsolute, relative } from "node:path";
import type { ToolSpec } from "@zhiyin/contract";
import type { TurnFiles } from "@zhiyin/rewind";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { LoopAnswer, LoopTool } from "../round/loop-tool.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { refusal } from "./refusals.js";

const prepareChangeToolName = "prepare_change";

const prepareChangeTool: ToolSpec = {
  name: prepareChangeToolName,
  description:
    "Save a file of the conversation's folder, or of a folder granted for changing, now, so the next command may change it and going back can still put it back. Use it when a command was refused, or held read-only, a file because it was not saved yet: then run the command again. It changes nothing in the file.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "The file's path inside the conversation's folder, or its whole path in a folder granted for changing.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

/** `path` relative to `folder`, when it is inside it. */
function inside(folder: string, path: string): string | undefined {
  const within = relative(folder, path);
  return within && !within.startsWith("..") && !isAbsolute(within)
    ? within
    : undefined;
}

export class PrepareChange implements LoopTool {
  readonly #files: TurnFiles;
  readonly #workspace: AgentLoopDependencies["workspace"];
  readonly #taskId: string;
  readonly #granted: () => readonly string[];

  /** `granted` names the folders outside the workspace granted for changing. */
  constructor(
    files: TurnFiles,
    workspace: AgentLoopDependencies["workspace"],
    taskId: string,
    granted: () => readonly string[],
  ) {
    this.#files = files;
    this.#workspace = workspace;
    this.#taskId = taskId;
    this.#granted = granted;
  }

  /** The folder the file is saved for, and its path there. */
  #placed(
    root: string | undefined,
    path: string,
  ): { readonly folder: string; readonly path: string } | undefined {
    if (!isAbsolute(path)) return root ? { folder: root, path } : undefined;
    for (const folder of [...(root ? [root] : []), ...this.#granted()]) {
      const within = inside(folder, path);
      if (within) return { folder, path: within };
    }
    // Refused by recovery as a path outside the folder.
    return root ? { folder: root, path } : undefined;
  }

  specs(): readonly ToolSpec[] {
    return [prepareChangeTool];
  }

  answers(name: string): boolean {
    return name === prepareChangeToolName;
  }

  async answer(
    _call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer> {
    const path = input["path"];
    if (typeof path !== "string" || !path.trim())
      return refusal(
        "input-check",
        "prepare_change takes the file's path in path.",
        "Send prepare_change again with the path.",
      );
    const placed = this.#placed(
      this.#workspace.workspaceRoot(this.#taskId),
      path.trim(),
    );
    if (!placed)
      return refusal(
        "tool",
        "This conversation has no folder to save a file of.",
        "Go on without it.",
      );
    const saved = await this.#files.prepareChange(placed.folder, placed.path);
    return saved.ok
      ? { saved: path.trim(), next: "Run the command that changes it now." }
      : refusal(
          "tool",
          saved.reason,
          "Tell the person, who can make room for going back in Settings.",
        );
  }
}
