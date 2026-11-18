import { readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  WorkspaceDescription,
  WorkspaceEntry,
} from "@zhiyin/contract";
import { detailsOf } from "../../shared/action-detail.js";
import { effectsOf } from "../../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import {
  describeBytes,
  errorCode,
  isAbortError,
  normalizePath,
  realLocation,
  scopeOf,
  toForwardSlashes,
  type PathScope,
} from "../../shared/workspace-path.js";
import { searchesSkip } from "@zhiyin/workspace-listing";
import type { ToolDefinition } from "../../tool-definition.js";

const maximumEntries = 300;
const maximumDepth = 2;

export type { WorkspaceDescription };

type ListArguments = {
  readonly path: string;
  readonly depth: number;
};

/** An entry as the listing gives it: a file with its size and when it last changed. */
type ListedEntry = WorkspaceEntry & {
  readonly bytes?: number;
  readonly modified?: string;
  /** How many entries a folder of generated files holds, which are not listed. */
  readonly holds?: number;
  readonly notListed?: true;
  /** A folder inside whose entries could not be read, so none are listed. */
  readonly notRead?: true;
};

type DirectoryListing = {
  readonly path: string;
  readonly entries: readonly ListedEntry[];
  readonly truncated: boolean;
  readonly note?: string;
};

const listDirectorySpec: ToolSpec = {
  access: "read",
  name: "list_directory",
  description: `List files and folders, each file with its size and when it last changed. A workspace-relative path lists inside the current workspace. An absolute path may list a folder elsewhere on this computer, which the person is asked about first. Use this before guessing file paths, and to check that files were written. A listing shows at most ${maximumEntries} entries. It gives every entry of the folder before what its folders hold, and says how many it leaves out. At depth 2, what a folder of generated files such as node_modules, .git or build holds is counted, not listed.`,
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
  const input = schemaInput<{ readonly path: string; readonly depth?: number }>(
    listDirectorySpec.inputSchema,
    args,
  );
  if (!input?.path.trim()) return;
  return { path: normalizePath(input.path), depth: input.depth ?? 1 };
}

function inspectListDirectory(root: string, args: unknown): ToolCallInspection {
  const input = listArguments(args);
  if (!input) {
    return {
      ok: false,
      reason: withSchemaProblems(
        "Choose a directory and a depth of 1 or 2.",
        args,
        listDirectorySpec.inputSchema,
      ),
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
      command,
      effects: effectsOf({ reads: "elsewhere" }),
    };
  }
  return {
    ok: true,
    action: "List a workspace directory",
    target: input.path === "." ? "Workspace root" : input.path,
    command,
    effects: effectsOf({ reads: "workspace" }),
  };
}

type Child = {
  readonly name: string;
  readonly path: string;
  readonly folder: string;
  readonly kind: WorkspaceEntry["kind"];
};

async function childrenOf(
  folder: string,
  relativeFolder: string,
): Promise<Child[]> {
  const children = await readdir(folder, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  return children.map((child) => ({
    name: child.name,
    path: toForwardSlashes(
      relativeFolder === "." ? child.name : `${relativeFolder}/${child.name}`,
    ),
    folder,
    kind: child.isSymbolicLink()
      ? "link"
      : child.isDirectory()
        ? "directory"
        : child.isFile()
          ? "file"
          : "other",
  }));
}

/** Paths in the order a person reads a listing: each folder before what it holds. */
function treeOrder(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = a[index]!.localeCompare(b[index]!);
    if (order) return order;
  }
  return a.length - b.length;
}

/**
 * Every entry of the folder comes before any inside its folders, so a large
 * folder inside never hides the folder's own entries. A folder of generated
 * files at the second level is counted, not listed inside.
 */
async function directoryListing(
  base: string,
  displayPath: string,
  depth: number,
  signal?: AbortSignal,
): Promise<DirectoryListing> {
  const cancelled = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  cancelled();
  const top = await childrenOf(base, displayPath);
  const counted = new Map<string, number>();
  const unread = new Set<string>();
  const inside: Child[] = [];
  if (depth > 1)
    for (const child of top) {
      if (child.kind !== "directory") continue;
      cancelled();
      const children = await childrenOf(
        resolve(base, child.name),
        child.path,
      ).catch(() => undefined);
      if (!children) unread.add(child.path);
      // A folder the searches skip usually holds generated files: what it
      // holds is counted, not listed.
      else if (searchesSkip(child.name))
        counted.set(child.path, children.length);
      else inside.push(...children);
    }
  const total = top.length + inside.length;
  const shown = [...top, ...inside].slice(0, maximumEntries);
  const entries: ListedEntry[] = [];
  for (const child of shown) {
    cancelled();
    const file =
      child.kind === "file"
        ? await stat(resolve(child.folder, child.name)).catch(() => undefined)
        : undefined;
    const holds = counted.get(child.path);
    entries.push({
      path: child.path,
      kind: child.kind,
      ...(file
        ? {
            bytes: file.size,
            modified: `${file.mtime.toISOString().slice(0, 19)}Z`,
          }
        : {}),
      ...(holds === undefined ? {} : { holds, notListed: true }),
      ...(unread.has(child.path) ? { notRead: true as const } : {}),
    });
  }
  entries.sort((left, right) => treeOrder(left.path, right.path));
  const truncated = total > entries.length;
  const notListed = entries.filter((entry) => entry.notListed);
  const notRead = entries
    .filter((entry) => entry.notRead)
    .map((entry) => entry.path);
  const notes = [
    truncated
      ? `${entries.length} of ${total.toLocaleString("en-US")} entries are shown. List a folder inside this one, or find files by name with find_files.`
      : undefined,
    notListed.length
      ? `What ${spokenList(notListed.map((entry) => entry.path.split("/").at(-1)!))} ${notListed.length === 1 ? "holds is" : "hold is"} counted, not listed: ${notListed.length === 1 ? "it usually holds" : "they usually hold"} generated files. List one by its path to see inside it.`
      : undefined,
    notRead.length
      ? `${spokenList(notRead)} could not be read, so what ${notRead.length === 1 ? "it holds" : "they hold"} is not listed.`
      : undefined,
  ].filter((note) => note !== undefined);
  return {
    path: displayPath,
    entries,
    truncated,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}

/** Names as a sentence lists them: "a", "a and b", "a, b and c". */
function spokenList(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

async function runListDirectory(
  root: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolInvocationResult> {
  const inspected = inspectListDirectory(root, args);
  if (!inspected.ok) return inspected;
  const input = listArguments(args);
  if (!input) return { ok: false, reason: "The directory input is invalid." };
  const outside = inspected.effects?.reads === "elsewhere";

  try {
    const real = await realLocation(root, input.path);
    const realTarget = real.path;
    // A link can point out of the workspace after the request was presented as
    // staying in it. The approval that was given was for the contained listing.
    if (!outside && real.scope !== "workspace") {
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
      outside ? inspected.target : input.path,
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
            `${entry.path}${entry.kind === "directory" ? `/${entry.notRead ? " (could not be read)" : entry.holds === undefined ? "" : ` (${entry.holds} inside, not listed)`}` : entry.kind === "link" ? " (link)" : entry.bytes !== undefined ? ` (${describeBytes(entry.bytes)})` : ""}`,
        ),
        ...(listing.truncated ? { truncated: true } : {}),
      }),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        ok: false,
        reason: outside
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
    entries: (listing?.entries ?? []).map(({ path, kind }) => ({ path, kind })),
    truncated: listing?.truncated ?? false,
  };
}

/** The listing tool, as the registry offers it. */
export function listDirectoryTool(): ToolDefinition {
  return {
    spec: listDirectorySpec,
    requiresWorkspace: true,
    inspect: async (args, _id, { root }) => inspectListDirectory(root, args),
    execute: (args, signal, _id, { root }) =>
      runListDirectory(root, args, signal),
  };
}
