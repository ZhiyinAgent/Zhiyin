import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { McpUnauthorizedError, UNAUTHORIZED } from "./connection-problems.js";
import type { McpConnectionFactory } from "./mcp.js";

/** A refused credential must not read as an unreachable server. */
function rethrowRefusals(error: unknown): never {
  if (UnauthorizedError.isInstance(error))
    throw new McpUnauthorizedError(UNAUTHORIZED, { cause: error });
  throw error;
}

export const connectHttpMcpServer: McpConnectionFactory = async (
  definition,
  token,
) => {
  const client = new Client({ name: "zhiyin", version: "0.1.0" });
  // The transport asks for the token before every request, so a token saved or
  // revoked later takes effect without the credential being copied here.
  const transport = new StreamableHTTPClientTransport(new URL(definition.url), {
    authProvider: { token },
  });
  try {
    await client.connect(transport, { timeout: 10_000 });
  } catch (error) {
    await client.close().catch(() => undefined);
    rethrowRefusals(error);
  }
  return {
    listTools: async () => {
      const { tools } = await client.listTools().catch(rethrowRefusals);
      return tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
      }));
    },
    callTool: (name, args, signal) =>
      client
        .callTool(
          { name, arguments: args },
          { ...(signal ? { signal } : {}), timeout: 60_000 },
        )
        .catch(rethrowRefusals),
    close: () => client.close(),
  };
};
