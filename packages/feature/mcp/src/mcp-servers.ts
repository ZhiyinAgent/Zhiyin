/** What the connectors feature offers, and what it is handed. */

import type {
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import type { McpConnection } from "./connection-types.js";
import type { DeclaredToolEffects } from "./declared-effects.js";
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
  /** Minutes a call of each named tool may take, past the minute any other has. */
  readonly toolMinutes?: Readonly<Record<string, number>>;
  /**
   * The tools that only read, by the server's names for them, on the word of
   * whoever declared the connection — never on the server's own annotations.
   */
  readonly readOnlyTools?: readonly string[];
  /**
   * What the server's tools do, said by Zhiyin for a connection a package it
   * ships declares, and by nobody for any other. A call of a tool named here
   * carries it and goes as a call to a connection Zhiyin ships.
   */
  readonly toolEffects?: readonly DeclaredToolEffects[];
  /**
   * Declared by a package Zhiyin ships. How each of its tools is treated is
   * then Zhiyin's to say, never the person's (ADR 0012).
   */
  readonly shipped?: true;
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
  /**
   * How a tool of a connection Zhiyin does not ship is treated; refused for
   * one Zhiyin ships or builds in.
   */
  setToolTreatment(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    /** The version of the tool the person was shown, as its summary gave it. */
    shown: string,
  ): Promise<void>;
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
  /**
   * The tools of each connection the application provides, by connection id,
   * as `availableTools` gives them, from what each describes of itself: no
   * conversation's connection is opened. One that cannot work here is left
   * out.
   */
  builtInTools?(): Promise<ReadonlyMap<string, readonly ToolSpec[]>>;
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
