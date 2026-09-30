/**
 * Lifecycle and transport for external MCP servers.
 *
 * Boundaries and invariants: docs/architecture/features/mcp/README.md
 */

export * from "./mcp.js";

export { routedName } from "./action-title.js";
export { McpUnauthorizedError } from "./connection-problems.js";
export { connectHttpMcpServer } from "./http-connection.js";
