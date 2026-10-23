import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ConversationPermission,
  ToolCallInspection,
  ToolOwner,
} from "@zhiyin/contract";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;
export type PermissionScope = Omit<ConversationPermission, "id" | "at">;

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

/**
 * Whether a path is a folder or inside it, comparing names exactly: both come
 * from the real workspace folder, so a sibling named like it but for case is
 * outside.
 */
function inside(folder: string, path: string): boolean {
  return (
    path === folder ||
    path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)
  );
}

/**
 * The files a call changes, in the real workspace folder. The tool resolved
 * each path once, links followed, and declared where it really is (ADR 0012):
 * a grant is checked against that, never resolved again, so it covers exactly
 * the file the tool writes. A full path, one that steps up a folder, and one
 * holding a colon, which names a drive or a hidden stream, are not how a tool
 * declares a change, and no grant covers them.
 */
async function changedFiles(inspection: Inspection, root?: string) {
  if (!root || inspection.scope !== "workspace" || !inspection.changes?.length)
    return;
  const canonicalRoot = await realpath(root).catch(() => undefined);
  if (!canonicalRoot) return;
  const targets: string[] = [];
  for (const change of inspection.changes) {
    if (
      isAbsolute(change.path) ||
      change.path.includes(":") ||
      change.path.split(/[\\/]/).some((part) => part === "..")
    )
      return;
    const target = resolve(canonicalRoot, change.path);
    if (target === canonicalRoot || !inside(canonicalRoot, target)) return;
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
  // The code that owns the tool says when no grant may cover a call (ADR 0009).
  if (inspection.asksEachTime) return;
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
  if (inspection.asksEachTime) return;
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
  return permissions.find((rule) => {
    const folder = rule.folder;
    return (
      rule.kind === "file-folder" &&
      rule.workspaceRoot === files.canonicalRoot &&
      !!folder &&
      files.targets.every((target) => inside(folder, target))
    );
  });
}
