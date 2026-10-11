import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  ConversationPermission,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;
export type PermissionScope = Omit<ConversationPermission, "id" | "at">;

/**
 * Asked for every time, under the names the model calls them by: a deletion,
 * a shell command, a Python run, which reaches the Python environment through
 * its built-in connection, and a Blender script, which reaches past its scene.
 */
const alwaysAsked: ReadonlySet<string> = new Set([
  "delete_file",
  "bash",
  "mcp__python__run_python",
  "mcp__blender__blender_run_script",
]);

/**
 * Every tool of the connection a tool belongs to, as a rule names them: the
 * name without its last part, which is the tool, since a connection's own id
 * may hold parts. The pattern is a name no tool has, so a rule for one tool
 * never reads as it.
 */
function everyToolOf(name: string): string {
  return `${name.split("__").slice(0, -1).join("__")}__*`;
}

// The connection, never the target: a browser call targets the page it is
// on, and the rule covers the tool on every page.
function connectionName(inspection: Inspection): string {
  return (
    inspection.connection?.trim() ||
    inspection.target.trim() ||
    "Connected tool"
  );
}

function connectorLabel(name: string, inspection: Inspection): string {
  const connection = connectionName(inspection);
  const tool = inspection.invocation?.name ?? name.split("__").at(-1) ?? name;
  const words = tool.replace(/[_-]+/g, " ").trim();
  const withoutConnection = words
    .toLowerCase()
    .startsWith(`${connection.toLowerCase()} `)
    ? words.slice(connection.length + 1)
    : words;
  const operation = withoutConnection || "Tool";
  const only = inspection.boundToCall ? " · only this exact call" : "";
  return `${connection} · ${operation[0]!.toUpperCase()}${operation.slice(1)}${only}`;
}

function inside(folder: string, path: string): boolean {
  const part = relative(folder, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

/** Follows existing links, including a link in a new file's parent folder. */
async function canonicalTarget(
  root: string,
  path: string,
): Promise<string | undefined> {
  if (isAbsolute(path)) return;
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) return;
  try {
    return await realpath(absolute);
  } catch {
    const missing: string[] = [basename(absolute)];
    let parent = dirname(absolute);
    for (;;) {
      try {
        return resolve(await realpath(parent), ...missing.reverse());
      } catch {
        if (parent === dirname(parent)) return;
        missing.push(basename(parent));
        parent = dirname(parent);
      }
    }
  }
}

async function changedFiles(inspection: Inspection, root?: string) {
  if (!root || inspection.scope !== "workspace" || !inspection.changes?.length)
    return;
  const canonicalRoot = await realpath(root).catch(() => undefined);
  if (!canonicalRoot) return;
  const targets: string[] = [];
  for (const change of inspection.changes) {
    const target = await canonicalTarget(canonicalRoot, change.path);
    if (!target || !inside(canonicalRoot, target)) return;
    targets.push(target);
  }
  return { canonicalRoot, targets };
}

/** Describes exactly the repeatable authority an inspection can offer. */
export async function offeredPermission(
  owner: ToolOwner,
  name: string,
  inspection: Inspection,
  workspaceRoot?: string,
): Promise<PermissionScope | undefined> {
  if (alwaysAsked.has(name)) return;
  if (owner === "mcp" && inspection.allowance)
    return {
      kind: "connector-tool",
      label: `${connectionName(inspection)} · ${inspection.allowance.label}`,
      toolName: everyToolOf(name),
      identity: inspection.allowance.key,
    };
  if (owner === "mcp" && inspection.identity)
    return {
      kind: "connector-tool",
      label: connectorLabel(name, inspection),
      toolName: name,
      identity: inspection.identity,
    };
  if (
    owner !== "built-in" ||
    (name !== "write_file" && name !== "multi_edit") ||
    inspection.access !== "change"
  )
    return;
  const files = await changedFiles(inspection, workspaceRoot);
  if (!files) return;
  let folder = dirname(files.targets[0]!);
  while (!files.targets.every((target) => inside(folder, target))) {
    if (folder === files.canonicalRoot) return;
    folder = dirname(folder);
  }
  if (folder === files.canonicalRoot) return;
  const display = relative(files.canonicalRoot, folder).replaceAll("\\", "/");
  return {
    kind: "file-folder",
    label: `Changes to files in ${display}/`,
    toolName: name,
    workspaceRoot: files.canonicalRoot,
    folder,
  };
}

/** Checks every post-repair, inspected target against the saved rule. */
export async function matchingPermission(
  permissions: readonly ConversationPermission[],
  owner: ToolOwner,
  name: string,
  inspection: Inspection,
  workspaceRoot?: string,
): Promise<ConversationPermission | undefined> {
  if (alwaysAsked.has(name)) return;
  if (owner === "mcp")
    return permissions.find((rule) =>
      rule.kind !== "connector-tool"
        ? false
        : rule.toolName === everyToolOf(name)
          ? !!inspection.allowance && rule.identity === inspection.allowance.key
          : rule.toolName === name &&
            !!inspection.identity &&
            rule.identity === inspection.identity,
    );
  if (
    owner !== "built-in" ||
    (name !== "write_file" && name !== "multi_edit") ||
    inspection.access !== "change"
  )
    return;
  const files = await changedFiles(inspection, workspaceRoot);
  if (!files) return;
  return permissions.find(
    (rule) =>
      rule.kind === "file-folder" &&
      rule.workspaceRoot === files.canonicalRoot &&
      !!rule.folder &&
      files.targets.every((target) => inside(rule.folder!, target)),
  );
}
