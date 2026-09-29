import type { ConversationPermission } from "@zhiyin/contract";

/** Older grants saved a routed tool identifier as their visible label. */
export function permissionTitle(permission: ConversationPermission): string {
  if (
    permission.kind !== "connector-tool" ||
    !permission.label.startsWith("mcp_")
  )
    return permission.label;

  let connection = "Connected tool";
  let serverId: string | undefined;
  try {
    const identity: unknown = JSON.parse(permission.identity ?? "");
    if (identity && typeof identity === "object" && "server" in identity) {
      const server = identity.server;
      if (server && typeof server === "object") {
        if (
          "name" in server &&
          typeof server.name === "string" &&
          server.name.trim()
        )
          connection = server.name.trim();
        if ("id" in server && typeof server.id === "string")
          serverId = server.id;
      }
    }
  } catch {
    // A saved grant may predate structured identities.
  }

  const prefix = serverId ? `mcp__${serverId.replaceAll("/", "__")}__` : "";
  const routedTool =
    prefix && permission.toolName.startsWith(prefix)
      ? permission.toolName.slice(prefix.length)
      : (permission.toolName.match(/^mcp_[a-f0-9]{12}_(.+)$/)?.[1] ??
        permission.toolName.split("__").at(-1) ??
        permission.toolName);
  const words = routedTool.replace(/[_-]+/g, " ").trim();
  const short = words.toLowerCase().startsWith(`${connection.toLowerCase()} `)
    ? words.slice(connection.length + 1)
    : words;
  const operation = short || "Tool";
  return `${connection} · ${operation[0]!.toUpperCase()}${operation.slice(1)}`;
}
