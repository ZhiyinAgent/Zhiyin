/**
 * A dry run against a draft definition, before anything is saved: connects,
 * lists the tools and closes at once. It holds no connection and writes
 * nothing, so it cannot disturb a connection already made under the same id.
 */

import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
} from "@zhiyin/contract";
import { McpUnauthorizedError, UNAUTHORIZED } from "./connection-problems.js";
import type { McpConnection } from "./connection-types.js";
import { validateDefinition } from "./endpoint.js";
import { toolSummary } from "./schema-limit.js";

export async function testConnection(
  definition: McpServerDefinition,
  token: string | undefined,
  connect: (
    definition: McpServerDefinition,
    token: () => Promise<string | undefined>,
  ) => Promise<McpConnection>,
  /** Whether the service at the address publishes its own sign-in. */
  offersSignIn: (url: string) => Promise<boolean>,
): Promise<McpConnectionTestOutcome> {
  // The same rules as a saved connection, before a token goes anywhere.
  try {
    validateDefinition(definition);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Invalid MCP endpoint.",
    };
  }
  let connection: McpConnection | undefined;
  try {
    connection = await connect(definition, () => Promise.resolve(token));
    const tools = await connection.listTools();
    return {
      ok: true,
      tools: tools.map((tool) => toolSummary(tool, true)),
    };
  } catch (error) {
    // A service refusing anyone without a credential still answered: the
    // address works, and says what it asks for.
    if (error instanceof McpUnauthorizedError && token === undefined)
      return (await offersSignIn(definition.url))
        ? {
            ok: false,
            reason:
              "This service has its own sign-in. Save the connector, then sign in to it.",
            needs: "sign-in",
          }
        : {
            ok: false,
            reason: "This service needs an access token.",
            needs: "token",
          };
    return {
      ok: false,
      reason:
        error instanceof McpUnauthorizedError
          ? UNAUTHORIZED
          : "Could not connect to this MCP server.",
    };
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
