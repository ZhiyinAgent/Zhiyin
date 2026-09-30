export type McpServerDefinition = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  /** Tool names withheld from routing even though the server still advertises them. */
  readonly disabledTools?: readonly string[];
};

/**
 * Whether an access token for this server is held in secure storage. The token
 * itself never appears here, in a definition, or in any renderer snapshot.
 */
export type McpCredentialState =
  | { readonly status: "saved" }
  | { readonly status: "none" }
  | { readonly status: "unavailable"; readonly reason: string };

export type McpToolSummary = {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
};

/** The outcome of a dry-run connection attempt, made without saving anything. */
export type McpConnectionTestOutcome =
  | { readonly ok: true; readonly tools: readonly McpToolSummary[] }
  | { readonly ok: false; readonly reason: string };

export type McpServerState = McpServerDefinition & {
  readonly status: "connected" | "disconnected" | "failed" | "unauthorized";
  readonly toolCount: number;
  /** Absent only on a workspace snapshot saved before tool summaries existed. */
  readonly tools?: readonly McpToolSummary[];
  readonly reason?: string;
  readonly credential: McpCredentialState;
  /**
   * Ships inside Zhiyin rather than being configured: no endpoint to change,
   * nothing to remove, and no account to sign in to.
   */
  readonly builtIn?: boolean;
};
