import type { ConnectionTool, OfferedConnection } from "@zhiyin/contract";
import { resolveGit } from "./resolve-git.js";
import { describeGitResult, gitTools, type GitToolSpec } from "./tools.js";
import type { GitContainment } from "./run-git.js";

const unavailableMessage =
  "No git was found. Zhiyin runs git through the one that ships with Git for Windows.";
const installUrl = "https://git-scm.com/download/win";

export type GitAutomationOptions = {
  /** The one folder git operates in. No folder selected means no git tool. */
  readonly workspaceRoot: () => string | undefined;
  readonly containment?: GitContainment;
  /** Resolved fresh by default; swapped in tests. */
  readonly resolveGit?: () => string | undefined;
};

function specOf(tool: { readonly spec: GitToolSpec }): ConnectionTool {
  const { name, description, inputSchema } = tool.spec;
  return { name, description, inputSchema };
}

export function gitAutomation(
  options: GitAutomationOptions,
): OfferedConnection {
  const resolve = options.resolveGit ?? resolveGit;
  const byName = new Map(gitTools.map((tool) => [tool.spec.name, tool]));

  return {
    /**
     * Re-detects git every call, so it is picked up as soon as it is
     * installed — no separate "recheck" step, the same live check
     * `manage()` already re-runs for every built-in.
     */
    async listTools() {
      if (!resolve()) throw new Error(unavailableMessage);
      return gitTools.map(specOf);
    },
    async callTool(name, args, signal) {
      const tool = byName.get(name);
      if (!tool)
        return {
          content: [{ type: "text", text: `Unknown git tool "${name}".` }],
          isError: true,
        };
      const root = options.workspaceRoot();
      if (!root)
        return {
          content: [
            { type: "text", text: "Choose a folder before using git." },
          ],
          isError: true,
        };
      const git = resolve();
      if (!git)
        return {
          content: [{ type: "text", text: unavailableMessage }],
          isError: true,
        };
      return tool.execute(git, root, args, signal, options.containment);
    },
    async inspect(name, args) {
      const tool = byName.get(name);
      if (!tool)
        return { ok: false, reason: `The tool “${name}” is not available.` };
      const root = options.workspaceRoot();
      if (!root)
        return { ok: false, reason: "Choose a folder before using git." };
      const git = resolve();
      if (!git) return { ok: false, reason: unavailableMessage };
      return tool.inspect(root, args, git, options.containment);
    },
    describeResult(name, _args, result) {
      return describeGitResult(name, result);
    },
    async close() {
      // Nothing persists between calls — each tool call is one git
      // invocation that has already ended by the time this could run.
    },
  };
}

export { installUrl as gitInstallUrl };
