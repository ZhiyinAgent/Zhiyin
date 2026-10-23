import { travelsSecurely, type McpServerDefinition } from "@zhiyin/contract";

/**
 * Where a declared connection may be dialled: an HTTPS endpoint, or HTTP on
 * this computer only, so a token never crosses the network unencrypted. It
 * carries no credentials of its own, since an endpoint is displayed and kept
 * as the connection's identity.
 */
export function validateDefinition(server: McpServerDefinition) {
  if (!server.id.trim() || !server.name.trim()) {
    throw new Error("An MCP server needs a name.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(server.url);
  } catch {
    throw new Error("Enter a valid MCP endpoint.");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("MCP endpoints must use HTTP or HTTPS.");
  }
  if (!travelsSecurely(endpoint))
    throw new Error(
      "MCP endpoints must use HTTPS unless the server runs on this computer.",
    );
  if (
    endpoint.username ||
    endpoint.password ||
    [...endpoint.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key/i.test(key),
    )
  )
    throw new Error(
      "Use an endpoint without embedded credentials. Save the access token separately.",
    );
}
