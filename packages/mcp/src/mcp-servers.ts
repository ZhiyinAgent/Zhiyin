/** What the connectors feature offers, and what it is handed. */

import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import type { McpConnection } from "./connection-types.js";
import type { Network } from "./network.js";

/**
 * `token` is asked for the current credential rather than handed one, so a
 * transport can read it per request and no caller keeps a copy. `refresh` is
 * asked once when the service refuses it, before the refusal stands.
 */
export type McpConnectionFactory = (
  definition: McpServerDefinition,
  token: () => Promise<string | undefined>,
  refresh?: () => Promise<unknown>,
  /** How the connection goes online; Node's own `fetch` when absent. */
  network?: Network,
) => Promise<McpConnection>;

/**
 * A connection some package declares. The declaration is the only source of a
 * connection's identity and endpoint; this feature keeps nothing about a
 * connection that is no longer declared.
 */
export type DeclaredMcpServer = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** Off when its package or the connector itself is switched off. */
  readonly enabled: boolean;
  /** The most calls a minute the service accepts; unset sends one at a time. */
  readonly requestsPerMinute?: number;
  /**
   * The tools that only read, by the server's names for them, on the word of
   * whoever declared the connection — never on the server's own annotations.
   */
  readonly readOnlyTools?: readonly string[];
};

export type DeclaredMcpServers = () => Promise<readonly DeclaredMcpServer[]>;

/**
 * The packages that cannot be read right now, by name. Their connectors, whose
 * ids start with the package's name and a slash, are declared by nobody until
 * the package opens again, and keep what is remembered about them meanwhile.
 */
export type UnreadableMcpPackages = () => Promise<readonly string[]>;

/** What running a connector's tool may be given beside its name and arguments. */
export type McpExecuteOptions = {
  readonly signal?: AbortSignal | undefined;
  /** The tool as it was when the call was approved; another is refused. */
  readonly expectedIdentity?: string | undefined;
  /** The conversation whose connections the call may use. */
  readonly scope?: string | undefined;
  readonly excludedServerIds?: readonly string[];
};

export interface McpServers {
  /** Every connection's state, after reaching each enabled one. */
  manage(): Promise<readonly McpServerState[]>;
  /** Every connection's state as last seen, reaching none of them. */
  states(): Promise<readonly McpServerState[]>;
  /** Reaches one connection now, whatever it last answered. */
  check(id: string): Promise<McpServerState>;
  /** Forgets remembered connection failures so the next look tries again. */
  retryFailed(): Promise<void>;
  /** The ids of the connections the application itself provides. */
  builtInIds(): readonly string[];
  /**
   * Lists the tools of every open connection the application provides again,
   * without closing it, and has the rest describe themselves again.
   */
  listBuiltInsAgain(): Promise<void>;
  setToolEnabled(id: string, toolName: string, enabled: boolean): Promise<void>;
  /** A dry run against an endpoint and (optional) token, saving nothing. */
  test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;
  saveToken(id: string, token: string): Promise<void>;
  /** Forgets the key or the sign-in, whichever the connection holds. */
  clearToken(id: string): Promise<void>;
  /**
   * Signs in through the service's own sign-in, in the person's browser, for a
   * connection whose service offers it. The signal cancels it.
   */
  signIn(id: string, signal?: AbortSignal): Promise<McpSignInOutcome>;
  /**
   * `onConnecting` hears the name of each connection this has to wait for,
   * before waiting: one reached for the first time, or one still connecting.
   */
  availableTools(
    scope?: string,
    excludedServerIds?: readonly string[],
    onConnecting?: (connectionName: string) => void,
  ): Promise<readonly ToolSpec[]>;
  inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds?: readonly string[],
  ): Promise<ToolCallInspection>;
  execute(
    name: string,
    args: unknown,
    options?: McpExecuteOptions,
  ): Promise<ToolInvocationResult>;
  shutdownScope(scope: string): Promise<void>;
  shutdownAll(): Promise<void>;
}
