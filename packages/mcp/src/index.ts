/**
 * Lifecycle and transport for external MCP servers.
 *
 * Boundaries and invariants: docs/architecture/features/mcp/README.md
 */

export * from "./mcp.js";
export * from "./connection-types.js";
export * from "./credentials.js";

export { routedName } from "./action-title.js";
export {
  McpRateRefusedError,
  McpUnauthorizedError,
} from "./connection-problems.js";
export { connectHttpMcpServer } from "./http-connection.js";
export type { SignInOptions } from "./sign-in.js";
