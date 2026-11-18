import type { ConnectionTool, McpToolSummary } from "@zhiyin/contract";

/**
 * The most a tool's input schema may weigh, sent whole with every request of
 * a turn that offers the tool: about twelve times the largest of Zhiyin's own
 * tools. A schema means something only whole, so one past it is not
 * shortened but withheld.
 */
const maximumSchemaBytes = 64 * 1024;

const reasons = new WeakMap<ConnectionTool, string | null>();

/** Why a tool is not offered to the model, or nothing when it may be. */
export function withheldReason(tool: ConnectionTool): string | undefined {
  let reason = reasons.get(tool);
  if (reason === undefined) {
    const bytes = Buffer.byteLength(JSON.stringify(tool.inputSchema ?? {}));
    reason =
      bytes > maximumSchemaBytes
        ? `Not offered to the model: its input schema is ${Math.ceil(bytes / 1024)} KB, more than the ${maximumSchemaBytes / 1024} KB a tool may have.`
        : null;
    reasons.set(tool, reason);
  }
  return reason ?? undefined;
}

/** A tool as a connector's page shows it: switched on, off, or withheld. */
export function toolSummary(
  tool: ConnectionTool,
  enabled: boolean,
): McpToolSummary {
  const withheld = withheldReason(tool);
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    enabled: enabled && !withheld,
    ...(withheld ? { withheld } : {}),
  };
}
