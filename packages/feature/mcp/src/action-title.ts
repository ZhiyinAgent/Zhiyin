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
  const serverWords = new Set(serverName.toLowerCase().split(/\s+/));
  const words = toolName.replace(/[_-]+/g, " ").trim().split(/\s+/);
  // Words the tool's name repeats from the connection's, as cad in cad_build
  // under the CAD studio, are said once, by the connection's name.
  while (words.length && serverWords.has(words[0]!.toLowerCase()))
    words.shift();
  const operation = words.join(" ");
  if (!operation) return serverName;
  return `${serverName} · ${operation[0]!.toUpperCase()}${operation.slice(1)}`;
}
