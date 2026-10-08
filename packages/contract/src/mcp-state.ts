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
  /** Signed in through the service's own sign-in, kept the same way. */
  | { readonly status: "signed-in" }
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
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * What the service asked for, when it refused to connect without it: its
       * own sign-in, made once the connector is saved, or an access token.
       */
      readonly needs?: "sign-in" | "token";
    };

export type McpServerState = McpServerDefinition & {
  /**
   * `unchecked` is an enabled connection nothing has needed yet: it is reached
   * when a conversation may use it or a person checks it, never on a look.
   */
  readonly status:
    "connected" | "unchecked" | "disconnected" | "failed" | "unauthorized";
  /**
   * When the connection last answered or failed to, in milliseconds since the
   * epoch. A past answer is not a live one; say when it was.
   */
  readonly checkedAt?: number;
  readonly toolCount: number;
  readonly tools: readonly McpToolSummary[];
  readonly reason?: string;
  readonly credential: McpCredentialState;
  /**
   * The service offers the standard sign-in, so a person can sign in from the
   * connector's settings instead of pasting a key. Known once it was reached.
   */
  readonly signIn?: true;
  /**
   * Ships inside Zhiyin rather than being configured: no endpoint to change,
   * nothing to remove, and no account to sign in to.
   */
  readonly builtIn?: boolean;
};

/** How a sign-in the person started ended. */
export type McpSignInOutcome =
  | { readonly status: "signed-in" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };
