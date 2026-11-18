import type {
  ActionEffects,
  ConnectionTool,
  OfferedConnection,
  ToolArgument,
} from "@zhiyin/contract";
import { checkRepository } from "./repository.js";
import { resolveGit } from "./resolve-git.js";
import { gitCall, type GitToolSpec } from "./git-tool.js";
import { describeGitResult, gitTools } from "./tools.js";
import { gitLimits, type GitContainment } from "./run-git.js";

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

function specOf(tool: {
  readonly spec: GitToolSpec;
  readonly access: "read" | "change";
}): ConnectionTool {
  const { name, label, description, inputSchema } = tool.spec;
  return {
    name,
    label,
    description: `${description} ${gitLimits}`,
    inputSchema,
    ...(tool.access === "read" ? { access: "read" as const } : {}),
  };
}

/** The folder a call acts on, as what an approval of it is bound to. */
function folderIdentity(root: string): string {
  return JSON.stringify({ workspace: root });
}

/**
 * What a call does. One that only reads runs none of the programs the
 * repository names; one that changes it runs its hooks and filters with the
 * person's full access, and nothing is backed up first. Where the repository
 * or the history git keeps for it lies beyond the folder, as for a folder
 * inside a repository, a submodule or a linked work tree, both reach outside.
 */
function effectsOf(
  access: "read" | "change",
  withinFolder: boolean,
): ActionEffects {
  const where = withinFolder ? "workspace" : "elsewhere";
  const reading = access === "read";
  return {
    reads: where,
    changes: reading
      ? "none"
      : withinFolder
        ? "workspace-for-good"
        : "elsewhere",
    sends: "none",
    actsAsPerson: "none",
    runs: reading ? "none" : "full-access",
    lasting: false,
    brings: "none",
  };
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
     * every look at the connections already re-runs for every built-in.
     */
    async listTools() {
      if (!resolve()) throw new Error(unavailableMessage);
      return gitTools.map(specOf);
    },
    async callTool(name, args, signal, binding) {
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
      // A call allowed in one folder does not run in another.
      if (binding !== undefined && binding !== folderIdentity(root))
        return {
          content: [
            {
              type: "text",
              text: "The conversation's folder changed after this was allowed, so it did not run. Request approval again.",
            },
          ],
          isError: true,
        };
      const git = resolve();
      if (!git)
        return {
          content: [{ type: "text", text: unavailableMessage }],
          isError: true,
        };
      // One look at the repository's settings serves the check and the
      // tool's reads.
      const call = gitCall(git, root, signal, options.containment);
      const repository = await checkRepository(call, root);
      if (!repository.ok)
        return {
          content: [{ type: "text", text: repository.reason }],
          isError: true,
        };
      return tool.execute({ ...call, top: repository.top }, args);
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
      const call = gitCall(git, root, undefined, options.containment);
      const repository = await checkRepository(call, root);
      if (!repository.ok) return { ok: false, reason: repository.reason };
      const inspected = await tool.inspect(
        { ...call, top: repository.top },
        args,
      );
      if (!inspected.ok) return inspected;
      const { access, ...inspection } = inspected;
      // What a call is allowed for includes the folder it reads, so allowing
      // it for the conversation covers that folder alone. The person sees the
      // tool's inputs in words, then the git command it runs.
      return {
        ...inspection,
        identity: folderIdentity(root),
        effects: effectsOf(access, repository.withinFolder),
        ...(inspection.command
          ? {
              invocation: {
                name: inspection.action,
                arguments: [
                  ...inputRows(args),
                  {
                    name: "Command",
                    value: inspection.command,
                    runs: true as const,
                  },
                ],
              },
            }
          : {}),
      };
    },
    describeResult(_name, _args, result) {
      return describeGitResult(result);
    },
    async close() {
      // Nothing persists between calls — each tool call is one git
      // invocation that has already ended by the time this could run.
    },
  };
}

export { installUrl as gitInstallUrl };

/** Each git tool input, as a person names it. */
const inputNames: Readonly<Record<string, string>> = {
  message: "Message",
  paths: "Files",
  name: "Branch",
  ref: "Commit",
  limit: "How many",
};

/** The call's inputs in words, in the order the person reads them. */
function inputRows(args: unknown): ToolArgument[] {
  if (typeof args !== "object" || args === null) return [];
  return Object.entries(inputNames).flatMap(([key, label]) => {
    const value = (args as Record<string, unknown>)[key];
    const words = Array.isArray(value)
      ? value.filter((item) => typeof item === "string").join(", ")
      : typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    return words
      ? [{ name: label, value: words, readable: true as const }]
      : [];
  });
}
