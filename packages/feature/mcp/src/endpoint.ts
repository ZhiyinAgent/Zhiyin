import type { McpServerDefinition } from "@zhiyin/contract";
import { addressProblem } from "@zhiyin/trust-rules";

/** What a person is told of an endpoint the connection will not dial. */
const refusals = {
  unreadable: "Enter a valid MCP endpoint.",
  "not-http": "MCP endpoints must use HTTP or HTTPS.",
  unencrypted:
    "MCP endpoints must use HTTPS unless the server runs on this computer.",
  credentials:
    "Use an endpoint without embedded credentials. Save the access token separately.",
} as const;

/**
 * Where a declared connection may be dialled: the contract's rule for a
 * connector's address, so a token never crosses the network unencrypted and
 * an endpoint, displayed and kept as the connection's identity, carries no
 * credentials of its own.
 */
export function validateDefinition(server: McpServerDefinition) {
  if (!server.id.trim() || !server.name.trim()) {
    throw new Error("An MCP server needs a name.");
  }
  const problem = addressProblem(
    URL.canParse(server.url) ? new URL(server.url) : undefined,
  );
  if (problem) throw new Error(refusals[problem]);
}
