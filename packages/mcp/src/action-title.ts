import { createHash } from "node:crypto";

const modelToolName = /^[a-zA-Z0-9_-]{1,64}$/;

/** A routed identity that fits every supported model API. */
export function routedName(serverId: string, toolName: string): string {
  const readable = `mcp__${serverId.replaceAll("/", "__")}__${toolName}`;
  if (modelToolName.test(readable)) return readable;
  const digest = createHash("sha256")
    .update(`${serverId}\0${toolName}`)
    .digest("hex")
    .slice(0, 12);
  return `mcp_${digest}_${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
    0,
    64,
  );
}

/** A short action title; the exact tool identifier stays in the call inspector. */
export function actionTitle(serverName: string, toolName: string): string {
  const words = toolName.replace(/[_-]+/g, " ").trim();
  const prefix = `${serverName.toLowerCase()} `;
  const operation = words.toLowerCase().startsWith(prefix)
    ? words.slice(serverName.length + 1)
    : words;
  const lastServerWord = serverName.split(/\s+/).at(-1)?.toLowerCase();
  if (!operation || operation.toLowerCase() === lastServerWord)
    return serverName;
  return `${serverName} · ${operation[0]!.toUpperCase()}${operation.slice(1)}`;
}
