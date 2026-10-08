import {
  Client,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type Tool,
} from "@modelcontextprotocol/client";
import {
  McpRateRefusedError,
  McpUnauthorizedError,
  UNAUTHORIZED,
} from "./connection-problems.js";
import type { McpConnectionTool } from "./connection-types.js";
import type { McpConnectionFactory } from "./mcp.js";

/**
 * A refused credential must not read as an unreachable server. The SDK reports
 * a refusal after a refresh as an HTTP error, not as unauthorized.
 */
function rethrowRefusals(error: unknown): never {
  if (
    UnauthorizedError.isInstance(error) ||
    (SdkHttpError.isInstance(error) &&
      error.code === SdkErrorCode.ClientHttpAuthentication)
  )
    throw new McpUnauthorizedError(UNAUTHORIZED, { cause: error });
  throw error;
}

/**
 * The SDK reports a 429 as a generic HTTP error and drops its headers, so the
 * refusal and the wait the server asks for are read here, from the response.
 */
async function refusingForRate(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 429) return response;
  await response.body?.cancel().catch(() => undefined);
  throw new McpRateRefusedError(
    retryAfterMs(response.headers.get("retry-after")),
  );
}

/** `Retry-After` is either whole seconds or an HTTP date. */
function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function described(tool: Tool): McpConnectionTool {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
  };
}

export const connectHttpMcpServer: McpConnectionFactory = async (
  definition,
  token,
  refresh,
) => {
  const listeners: ((tools: readonly McpConnectionTool[]) => void)[] = [];
  const client = new Client(
    { name: "zhiyin", version: "0.1.0" },
    {
      // Active only when the server announces tool-list changes. A failed
      // refresh leaves the tools as they were; the next call says what broke.
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (error || !tools) return;
            const current = tools.map(described);
            for (const listener of listeners) listener(current);
          },
        },
      },
    },
  );
  // The transport asks for the token before every request, so a token saved or
  // revoked later takes effect without the credential being copied here.
  const transport = new StreamableHTTPClientTransport(new URL(definition.url), {
    authProvider: {
      token,
      // A signed-in connection's token is refreshed, and the request tried once
      // more; a pasted key has nothing to refresh, and the refusal stands.
      ...(refresh
        ? {
            onUnauthorized: async () => {
              await refresh();
            },
          }
        : {}),
    },
    fetch: refusingForRate,
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
      return tools.map(described);
    },
    callTool: (name, args, signal) =>
      client
        .callTool(
          { name, arguments: args },
          { ...(signal ? { signal } : {}), timeout: 60_000 },
        )
        .catch(rethrowRefusals),
    close: () => client.close(),
    onToolsChanged: (listener) => {
      listeners.push(listener);
    },
  };
};
