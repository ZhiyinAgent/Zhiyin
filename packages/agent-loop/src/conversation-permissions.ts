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
  if (name === "delete_file" || name === "bash" || name === "run_python")
    return;
  if (owner === "mcp" && inspection.identity)
    return {
      kind: "connector-tool",
      label: `${name}, this version`,
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
  if (name === "delete_file" || name === "bash" || name === "run_python")
    return;
  if (owner === "mcp")
    return permissions.find(
      (rule) =>
        rule.kind === "connector-tool" &&
        rule.toolName === name &&
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
