import { readdir, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  WorkspaceDescription,
  WorkspaceEntry,
} from "@zhiyin/contract";
import { detailsOf } from "./action-detail.js";
import {
  errorCode,
  isAbortError,
  normalizePath,
  scopeOf,
  toForwardSlashes,
  type PathScope,
} from "./workspace-path.js";

const maximumEntries = 300;
const maximumDepth = 2;

export type { WorkspaceDescription, WorkspaceEntry };

type ListArguments = {
  readonly path: string;
  readonly depth: number;
};

type DirectoryListing = {
  readonly path: string;
  readonly entries: readonly WorkspaceEntry[];
  readonly truncated: boolean;
};

export const listDirectorySpec: ToolSpec = {
  access: "read",
  name: "list_directory",
  description:
    "List files and folders. A workspace-relative path lists inside the current workspace. An absolute path may list a folder elsewhere on this computer, which the person is asked about first. Use this before guessing file paths.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Workspace-relative directory path, or an absolute path for a folder outside the workspace. Use "." for the workspace root.',
      },
      depth: {
        type: "integer",
        minimum: 1,
        maximum: maximumDepth,
        description: "How many directory levels to include.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

function listArguments(args: unknown): ListArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "path" && key !== "depth")) {
    return;
  }
  if (typeof source["path"] !== "string" || !source["path"].trim()) return;
  const depth = source["depth"] ?? 1;
  if (!Number.isInteger(depth) || Number(depth) < 1 || Number(depth) > 2) {
    return;
  }
  return {
    path: normalizePath(source["path"]),
    depth: Number(depth),
  };
}

export function inspectListDirectory(
  root: string,
  args: unknown,
): ToolCallInspection {
  const input = listArguments(args);
  if (!input) {
    return {
      ok: false,
      reason: "Choose a directory and a depth of 1 or 2.",
      // The shape of the request, not a question of authority: the model can
      // fix this itself, and a person watching learns nothing from it.
      correctable: true,
    };
  }
  const absolute = resolve(root, input.path);
  const scope: PathScope = scopeOf(root, absolute);
  const command = `list_directory(${JSON.stringify(input)})`;
  if (scope === "outside") {
    return {
      ok: true,
      action: "List a folder outside the workspace",
      target: toForwardSlashes(absolute),
      detail:
        "This folder is outside the folder you selected. Its file and folder names become part of this conversation.",
      access: "read",
      scope: "outside",
      command,
    };
  }
  return {
    ok: true,
    action: "List a workspace directory",
    target: input.path === "." ? "Workspace root" : input.path,
    access: "read",
    scope: "workspace",
    command,
  };
}

async function directoryListing(
  base: string,
  displayPath: string,
  depth: number,
  signal?: AbortSignal,
): Promise<DirectoryListing> {
  const entries: WorkspaceEntry[] = [];
  let truncated = false;

  async function visit(
    directory: string,
    relativeDirectory: string,
    remainingDepth: number,
  ): Promise<void> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (entries.length >= maximumEntries) {
        truncated = true;
        return;
      }
      const childPath =
        relativeDirectory === "."
          ? child.name
          : `${relativeDirectory}/${child.name}`;
      const kind = child.isSymbolicLink()
        ? "link"
        : child.isDirectory()
          ? "directory"
          : child.isFile()
            ? "file"
            : "other";
      entries.push({ path: toForwardSlashes(childPath), kind });
      if (kind === "directory" && remainingDepth > 1) {
        await visit(
          resolve(directory, child.name),
          childPath,
          remainingDepth - 1,
        );
        if (truncated) return;
      }
    }
  }

  await visit(base, displayPath, depth);
  return { path: displayPath, entries, truncated };
}

export async function runListDirectory(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  const inspected = inspectListDirectory(root, args);
  if (!inspected.ok) return inspected;
  const input = listArguments(args);
  if (!input) return { ok: false, reason: "The directory input is invalid." };

  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(root),
      realpath(resolve(root, input.path)),
    ]);
    // A link can point out of the workspace after the request was presented as
    // staying in it. The approval that was given was for the contained listing.
    if (
      inspected.scope === "workspace" &&
      scopeOf(realRoot, realTarget) !== "workspace"
    ) {
      return {
        ok: false,
        reason: "The directory leads outside the current workspace.",
      };
    }
    const target = await stat(realTarget);
    if (!target.isDirectory()) {
      return { ok: false, reason: "The selected path is not a directory." };
    }
    const listing = await directoryListing(
      realTarget,
      inspected.scope === "outside" ? inspected.target : input.path,
      input.depth,
      signal,
    );
    return {
      ok: true,
      value: listing,
      ...detailsOf({
        kind: "list",
        label: `${listing.entries.length} in ${listing.path}`,
        items: listing.entries.map(
          (entry) =>
            `${entry.path}${entry.kind === "directory" ? "/" : entry.kind === "link" ? " (link)" : ""}`,
        ),
        ...(listing.truncated ? { truncated: true } : {}),
      }),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        ok: false,
        reason:
          inspected.scope === "outside"
            ? `${inspected.target} was not found.`
            : `${input.path} was not found in this workspace.`,
      };
    }
    if (isAbortError(error)) {
      return { ok: false, reason: "The directory listing was cancelled." };
    }
    return {
      ok: false,
      reason: "The directory could not be listed.",
    };
  }
}

export async function describeWorkspaceRoot(
  root: string,
): Promise<WorkspaceDescription> {
  const result = await runListDirectory(root, { path: ".", depth: 1 });
  const listing = result.ok ? (result.value as DirectoryListing) : undefined;
  return {
    rootName: basename(root),
    entries: listing?.entries ?? [],
    truncated: listing?.truncated ?? false,
  };
}
