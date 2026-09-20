/**
 * Lifecycle and transport for external MCP servers.
 *
 * Boundaries and invariants: docs/architecture/features/mcp/README.md
 */

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActionDetail,
  McpCredentialState,
  McpConnectionTestOutcome,
  ProducedImage,
  McpServerDefinition,
  McpServerState,
  ToolCallInspection,
  ToolInvocation,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { supportedResult } from "./result-validation.js";

const UNAUTHORIZED =
  "This server refused the access token. Save a current token to sign in again.";
const STORAGE_UNAVAILABLE = "Secure storage for access tokens is unavailable.";

/**
 * A server rejected our credential. Distinct from an unreachable server: the
 * remedy is a new token, not a retry.
 */
export class McpUnauthorizedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpUnauthorizedError";
  }
}

/**
 * Where access tokens live. Only this holds a token; definitions, snapshots,
 * and evidence never do.
 */
export interface McpCredentialStore {
  get(id: string): Promise<string | undefined>;
  set(id: string, token: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Tokens for the life of the process. Suitable for tests and headless use. */
export class InMemoryMcpCredentials implements McpCredentialStore {
  readonly #tokens = new Map<string, string>();
  async get(id: string) {
    return this.#tokens.get(id);
  }
  async set(id: string, token: string) {
    this.#tokens.set(id, token);
  }
  async delete(id: string) {
    this.#tokens.delete(id);
  }
}

/** Tokens in the operating system credential store, one entry per server. */
export class KeyringMcpCredentials implements McpCredentialStore {
  readonly #entries = new Map<
    string,
    Promise<{
      getPassword(): Promise<string | undefined>;
      setPassword(password: string): Promise<void>;
      deletePassword(): Promise<boolean>;
    }>
  >();

  #entry(id: string) {
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = import("@napi-rs/keyring").then(
        ({ AsyncEntry }) => new AsyncEntry("Zhiyin", `mcp:${id}`),
      );
      this.#entries.set(id, entry);
    }
    return entry;
  }

  async get(id: string) {
    return (await this.#entry(id)).getPassword();
  }
  async set(id: string, token: string) {
    await (await this.#entry(id)).setPassword(token);
  }
  async delete(id: string) {
    await (await this.#entry(id)).deletePassword();
  }
}

export type McpConnectionTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export interface McpConnection {
  listTools(): Promise<readonly McpConnectionTool[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    binding?: string,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * `token` is asked for the current credential rather than handed one, so a
 * transport can read it per request and no caller keeps a copy.
 */
/**
 * A connection the application supplies rather than the person configuring:
 * it ships inside the app, has no endpoint to point elsewhere and no account
 * to sign in to, and so it is not editable, removable, or credentialed.
 */
export type BuiltInMcpServer = {
  readonly id: string;
  readonly name: string;
  /** One in-process connection is created for each conversation scope. */
  readonly scope?: "conversation";
  /** Opened on first use, and closed when the application shuts down. */
  open(scope?: string): Promise<McpConnection>;
  inspect?(
    name: string,
    args: Readonly<Record<string, unknown>>,
    scope?: string,
  ): Promise<ToolCallInspection>;
  describeResult?(
    name: string,
    args: Readonly<Record<string, unknown>>,
    result: ToolInvocationResult,
    scope?: string,
  ): readonly ActionDetail[];
  forget?(scope: string): Promise<void>;
  /**
   * For a connection scoped to conversations, whose connections each belong to
   * one: what it offers and whether it can work on this machine, answered
   * without any conversation. Throws with a reason a person can read when it
   * cannot.
   */
  describe?(): Promise<readonly McpConnectionTool[]>;
};

export type McpConnectionFactory = (
  definition: McpServerDefinition,
  token: () => Promise<string | undefined>,
) => Promise<McpConnection>;

const builtInRefusal =
  "This connection is built in to Zhiyin and cannot be changed.";

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
};

export type DeclaredMcpServers = () => Promise<readonly DeclaredMcpServer[]>;

export interface McpServers {
  manage(): Promise<readonly McpServerState[]>;
  /** Forgets remembered connection failures so the next look tries again. */
  retryFailed(): Promise<void>;
  /** The ids of the connections the application itself provides. */
  builtInIds(): readonly string[];
  setToolEnabled(id: string, toolName: string, enabled: boolean): Promise<void>;
  /** A dry run against an endpoint and (optional) token, saving nothing. */
  test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;
  saveToken(id: string, token: string): Promise<void>;
  clearToken(id: string): Promise<void>;
  availableTools(
    scope?: string,
    excludedServerIds?: readonly string[],
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
    signal?: AbortSignal,
    expectedIdentity?: string,
    scope?: string,
    excludedServerIds?: readonly string[],
  ): Promise<ToolInvocationResult>;
  shutdownScope(scope: string): Promise<void>;
  shutdownAll(): Promise<void>;
}

type ConnectedServer = {
  readonly connection: McpConnection;
  readonly tools: readonly McpConnectionTool[];
};

type Failure = {
  readonly status: "failed" | "unauthorized";
  readonly reason: string;
};

type RoutedTool = {
  readonly server: McpServerDefinition;
  readonly tool: McpConnectionTool;
  readonly connection: McpConnection;
  readonly connectionKey: string;
};

/** What is remembered about one declared connection. */
type RememberedConnection = {
  /** The endpoint a saved token and tool choices belong to. */
  readonly url: string;
  readonly disabledTools: readonly string[];
};

type SavedConnections = Record<string, RememberedConnection>;

function isRemembered(value: unknown): value is RememberedConnection {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const tools = item["disabledTools"];
  return (
    typeof item["url"] === "string" &&
    Array.isArray(tools) &&
    tools.every((tool) => typeof tool === "string")
  );
}

function isSavedConnections(
  value: unknown,
): value is { version: 1; connections: SavedConnections } {
  if (typeof value !== "object" || value === null) return false;
  const saved = value as Record<string, unknown>;
  const connections = saved["connections"];
  return (
    saved["version"] === 1 &&
    typeof connections === "object" &&
    connections !== null &&
    !Array.isArray(connections) &&
    Object.values(connections).every(isRemembered)
  );
}

function validateDefinition(server: McpServerDefinition) {
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

function asArguments(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

/** Tool names every supported model API accepts. */
const modelToolName = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * The name a model calls a connection's tool by. A package connector's id
 * carries its plugin (`plugin/server`), and a slash is not allowed in a tool
 * name, so the plugin and server are joined with `__`. A name that would
 * still be refused falls back to a short digest of both parts.
 */
export function routedName(serverId: string, toolName: string): string {
  const readable = `mcp__${serverId.replaceAll("/", "__")}__${toolName}`;
  if (modelToolName.test(readable)) return readable;
  const digest = createHash("sha256")
    .update(`${serverId}\0${toolName}`)
    .digest("hex")
    .slice(0, 12);
  return `mcp_${digest}_${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
    0,
    64,
  );
}

const maximumResultCharacters = 128_000;
/**
 * How many pictures one action may hand back, and how large each may be.
 *
 * Every picture is sent again with every later request in the same turn, so a
 * generous limit here is not paid once. Two is enough for a before and an
 * after; the size is about what a full-window screenshot encodes to.
 */
const maximumImages = 2;
const maximumImageCharacters = 2_000_000;

/**
 * Pictures, taken off the text channel and put on their own.
 *
 * A result reaches the model as text, so an image left inside it is a wall of
 * base64 that costs a fortune and shows nothing. The protocol already
 * distinguishes the two; this keeps that distinction instead of flattening it.
 */
function separateImages(value: object): {
  readonly value: unknown;
  readonly images: readonly ProducedImage[];
} {
  const content =
    "content" in value && Array.isArray(value.content)
      ? (value.content as readonly unknown[])
      : undefined;
  if (!content) return { value, images: [] };
  const asImage = (item: unknown): ProducedImage | undefined => {
    if (!item || typeof item !== "object") return undefined;
    const block = item as {
      type?: unknown;
      data?: unknown;
      mimeType?: unknown;
    };
    if (block.type !== "image" || typeof block.data !== "string")
      return undefined;
    return {
      mediaType:
        typeof block.mimeType === "string" ? block.mimeType : "image/png",
      data: block.data,
    };
  };
  if (!content.some((item) => asImage(item))) return { value, images: [] };
  const images: ProducedImage[] = [];
  const next = content.map((item) => {
    const image = asImage(item);
    if (!image) return item;
    if (images.length >= maximumImages)
      return {
        type: "text",
        text: "[image not shown: too many in one answer]",
      };
    if (image.data.length > maximumImageCharacters)
      return { type: "text", text: "[image not shown: too large to send]" };
    images.push(image);
    return { type: "text", text: `[image ${images.length}, shown separately]` };
  });
  return { value: { ...value, content: next }, images };
}

/**
 * A result too long to send, made short enough to send.
 *
 * A page of documentation or a page's own text is often longer than a model
 * turn can carry, and refusing it outright throws away an answer that was
 * already found — the tool ran, the network was used, and the top of the reply
 * usually holds what was asked for. So the text is cut and says where it was
 * cut, which is a smaller loss than the whole result and an honest one.
 *
 * A result whose bulk is not text cannot be cut this way, and is still refused
 * rather than sent as something it is not.
 */
function shortened(value: object): unknown | undefined {
  if (JSON.stringify(value).length <= maximumResultCharacters) return value;
  const content =
    "content" in value && Array.isArray(value.content)
      ? (value.content as readonly unknown[])
      : undefined;
  if (!content) return undefined;
  const isText = (item: unknown): item is { type: "text"; text: string } =>
    Boolean(item) &&
    typeof item === "object" &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string";
  const texts = content.filter(isText);
  if (!texts.length) return undefined;
  const marker = "\n… shortened: the rest was too long to send …";
  const room =
    maximumResultCharacters -
    (JSON.stringify({
      ...value,
      content: content.map((item) =>
        isText(item) ? { ...item, text: "" } : item,
      ),
    }).length +
      texts.length * marker.length);
  if (room <= 0) return undefined;
  const cut = (each: number) => ({
    ...value,
    content: content.map((item) =>
      isText(item) && item.text.length > each
        ? { ...item, text: `${item.text.slice(0, each)}${marker}` }
        : item,
    ),
  });
  // Encoding a character is not the same as counting it — a newline or a quote
  // costs two once written down — so the first cut is measured and, if it is
  // still long, taken again by exactly as much as it overran.
  let each = Math.floor(room / texts.length);
  let next = cut(each);
  const overrun = JSON.stringify(next).length - maximumResultCharacters;
  if (overrun > 0) {
    each -= Math.ceil(overrun / texts.length);
    if (each <= 0) return undefined;
    next = cut(each);
  }
  return JSON.stringify(next).length <= maximumResultCharacters
    ? next
    : undefined;
}

/** Long enough to read an input by; short enough not to be a second copy of it. */
const maximumArgumentCharacters = 2000;

/**
 * The parameter descriptions a tool declares, by parameter name. Absent
 * wherever the server said nothing: an input nobody described is shown
 * undescribed rather than given words this app made up for it.
 */
function schemaDescriptions(
  schema: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, string> {
  const properties =
    schema && typeof schema.properties === "object" && schema.properties
      ? (schema.properties as Record<string, unknown>)
      : {};
  const described = new Map<string, string>();
  for (const [name, property] of Object.entries(properties)) {
    if (!property || typeof property !== "object") continue;
    const description = (property as { description?: unknown }).description;
    if (typeof description === "string" && description.trim())
      described.set(name, description.trim());
  }
  return described;
}

/** Keeps both ends of an over-long value, and says how much of the middle went. */
function boundArgument(text: string): {
  readonly value: string;
  readonly omitted?: number;
} {
  if (text.length <= maximumArgumentCharacters) return { value: text };
  const half = Math.floor(maximumArgumentCharacters / 2);
  return {
    value: `${text.slice(0, half)}${text.slice(text.length - half)}`,
    omitted: text.length - half * 2,
  };
}

/**
 * One row per input, with what the server says it is for.
 *
 * Every input the model actually sent appears, whether the schema mentions it
 * or not: what is going to the server is the thing being agreed to, and an
 * input hidden because it was unexpected is the one most worth seeing.
 */
function describeCall(
  toolName: string,
  args: Record<string, unknown>,
  via: string,
  schema: Readonly<Record<string, unknown>> | undefined,
): ToolInvocation {
  const described = schemaDescriptions(schema);
  return {
    name: toolName,
    via,
    arguments: Object.entries(args).map(([name, value]) => {
      const text =
        typeof value === "string"
          ? value
          : (JSON.stringify(value, null, 2) ?? "");
      const description = described.get(name);
      return {
        name,
        ...boundArgument(text),
        ...(description ? { described: description } : {}),
      };
    }),
  };
}

export class ManagedMcpServers implements McpServers {
  readonly #directory: string;
  #mutations: Promise<void> = Promise.resolve();
  #enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#mutations.then(operation);
    this.#mutations = result.catch(() => undefined);
    return result;
  }
  setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    return this.#enqueue(() => this.#setToolEnabled(id, toolName, enabled));
  }
  saveToken(id: string, token: string): Promise<void> {
    return this.#enqueue(() => this.#saveToken(id, token));
  }
  clearToken(id: string): Promise<void> {
    return this.#enqueue(() => this.#clearToken(id));
  }
  readonly #file: string;
  readonly #connect: McpConnectionFactory;
  readonly #store: McpCredentialStore;
  readonly #builtIns: readonly BuiltInMcpServer[];
  readonly #declared: DeclaredMcpServers;
  readonly #connected = new Map<string, ConnectedServer>();
  readonly #connecting = new Map<string, Promise<void>>();
  readonly #epochs = new Map<string, number>();
  readonly #failures = new Map<string, Failure>();
  readonly #credentials = new Map<string, McpCredentialState>();
  /** What each conversation-scoped built-in offers, once it has said. */
  readonly #descriptions = new Map<string, readonly McpConnectionTool[]>();
  readonly #describing = new Map<string, Promise<void>>();
  /** Not kept once it works: the fix, such as installing a browser, is outside. */
  readonly #descriptionFailures = new Map<string, string>();
  #definitions: McpServerDefinition[] | undefined;

  constructor(
    directory: string,
    connect: McpConnectionFactory,
    store: McpCredentialStore,
    builtIns: readonly BuiltInMcpServer[] = [],
    declared: DeclaredMcpServers = async () => [],
  ) {
    this.#directory = directory;
    this.#file = join(directory, "mcp-connections.json");
    this.#connect = connect;
    this.#store = store;
    this.#builtIns = builtIns;
    this.#declared = declared;
  }

  /** Built-in connections have no stored definition to look up. */
  #isBuiltIn(id: string): boolean {
    return this.#builtIns.some((server) => server.id === id);
  }

  #refuseBuiltIn(id: string): void {
    if (this.#isBuiltIn(id)) throw new Error(builtInRefusal);
  }

  #builtInKey(server: BuiltInMcpServer, scope?: string): string | undefined {
    if (server.scope !== "conversation") return server.id;
    return scope ? `${server.id}\0${scope}` : undefined;
  }

  async #openBuiltIns(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<void> {
    await Promise.all(
      this.#builtIns.map(async (server) => {
        // A withheld connection is not opened on a conversation's account.
        if (excludedServerIds.includes(server.id)) return;
        const key = this.#builtInKey(server, scope);
        if (!key) return;
        // A failure is not cached the way an external server's is: a built-in's
        // prerequisite (a browser, a shell) is cheap to re-check and the fix
        // usually happens outside the app, so every `manage()` call tries again
        // rather than requiring a person to explicitly retry.
        if (this.#connected.has(key)) return;
        const pending = this.#connecting.get(key);
        if (pending) return pending;
        const connecting = (async () => {
          const epoch = this.#epochs.get(key) ?? 0;
          let connection: McpConnection | undefined;
          try {
            connection = await server.open(scope);
            const tools = await connection.listTools();
            if ((this.#epochs.get(key) ?? 0) !== epoch) {
              await connection.close();
              return;
            }
            this.#connected.set(key, { connection, tools });
          } catch (error) {
            await connection?.close().catch(() => undefined);
            if ((this.#epochs.get(key) ?? 0) === epoch)
              this.#failures.set(key, {
                status: "failed",
                reason:
                  error instanceof Error && error.message
                    ? error.message
                    : "This built-in connection could not be started.",
              });
          }
        })();
        this.#connecting.set(key, connecting);
        try {
          await connecting;
        } finally {
          if (this.#connecting.get(key) === connecting)
            this.#connecting.delete(key);
        }
      }),
    );
  }

  /** Asks each conversation-scoped built-in that can describe itself. */
  async #describeBuiltIns(): Promise<void> {
    await Promise.all(
      this.#builtIns.map(async (server) => {
        const describe = server.describe;
        if (server.scope !== "conversation" || !describe) return;
        if (this.#descriptions.has(server.id)) return;
        const pending = this.#describing.get(server.id);
        if (pending) return pending;
        const describing = (async () => {
          try {
            this.#descriptions.set(server.id, await describe());
            this.#descriptionFailures.delete(server.id);
          } catch (error) {
            this.#descriptionFailures.set(
              server.id,
              error instanceof Error && error.message
                ? error.message
                : "This built-in connection cannot work on this machine.",
            );
          }
        })();
        this.#describing.set(server.id, describing);
        try {
          await describing;
        } finally {
          this.#describing.delete(server.id);
        }
      }),
    );
  }

  /**
   * A built-in's general state. One scoped to conversations speaks for itself,
   * since no single conversation's connection speaks for all of them.
   */
  #builtInHealth(server: BuiltInMcpServer): {
    tools: readonly McpConnectionTool[] | undefined;
    failure: Failure | undefined;
  } {
    if (server.scope === "conversation" && server.describe) {
      const reason = this.#descriptionFailures.get(server.id);
      return {
        tools: this.#descriptions.get(server.id),
        failure: reason ? { status: "failed", reason } : undefined,
      };
    }
    const prefix = `${server.id}\0`;
    const connected =
      this.#connected.get(server.id) ??
      [...this.#connected.entries()].find(([key]) =>
        key.startsWith(prefix),
      )?.[1];
    const failure =
      this.#failures.get(server.id) ??
      [...this.#failures.entries()].find(([key]) =>
        key.startsWith(prefix),
      )?.[1];
    return { tools: connected?.tools, failure };
  }

  #builtInStates(): McpServerState[] {
    return this.#builtIns.map((server) => {
      const { tools, failure } = this.#builtInHealth(server);
      return {
        id: server.id,
        name: server.name,
        // It runs inside the application, so there is no address to show and
        // nothing leaves the machine on its account.
        url: "",
        enabled: true,
        builtIn: true,
        status: tools
          ? ("connected" as const)
          : (failure?.status ?? ("disconnected" as const)),
        toolCount: tools?.length ?? 0,
        tools:
          tools?.map(({ name, description }) => ({
            name,
            enabled: true,
            ...(description ? { description } : {}),
          })) ?? [],
        ...(failure ? { reason: failure.reason } : {}),
        credential: { status: "none" as const },
      };
    });
  }

  async manage(): Promise<readonly McpServerState[]> {
    const definitions = await this.#reconciled();
    await Promise.all([
      this.#openBuiltIns(),
      this.#describeBuiltIns(),
      ...definitions.map(async (server) => {
        if (server.enabled) await this.#ensureConnected(server);
        else await this.#disconnect(server.id);
      }),
    ]);
    const configured = await Promise.all(
      definitions.map(async (server) => {
        const connected = this.#connected.get(server.id);
        const failure = this.#failures.get(server.id);
        const disabledTools = new Set(server.disabledTools ?? []);
        return {
          ...server,
          status: connected
            ? ("connected" as const)
            : (failure?.status ?? ("disconnected" as const)),
          toolCount: connected?.tools.length ?? 0,
          tools:
            connected?.tools.map(({ name, description }) => ({
              name,
              enabled: !disabledTools.has(name),
              ...(description ? { description } : {}),
            })) ?? [],
          ...(failure ? { reason: failure.reason } : {}),
          credential: await this.#credential(server.id),
        };
      }),
    );
    return [...this.#builtInStates(), ...configured];
  }

  builtInIds(): readonly string[] {
    return this.#builtIns.map((server) => server.id);
  }

  async retryFailed(): Promise<void> {
    for (const [key, failure] of [...this.#failures.entries()])
      if (failure.status === "failed") this.#failures.delete(key);
  }

  /** Cached so routine management does not reopen the credential store. */
  async #credential(id: string): Promise<McpCredentialState> {
    const cached = this.#credentials.get(id);
    if (cached) return cached;
    let state: McpCredentialState;
    try {
      state = (await this.#store.get(id))
        ? { status: "saved" }
        : { status: "none" };
    } catch {
      state = { status: "unavailable", reason: STORAGE_UNAVAILABLE };
    }
    this.#credentials.set(id, state);
    return state;
  }

  async #saveToken(id: string, token: string): Promise<void> {
    this.#refuseBuiltIn(id);
    const value = token.trim();
    if (!value) throw new Error("Enter an access token before saving.");
    const definitions = await this.#reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    // The endpoint is written down before the token exists, so a token is
    // never held for a connection nothing remembers.
    await this.#remember(id, server.url);
    try {
      await this.#store.set(id, value);
    } catch (error) {
      this.#credentials.set(id, {
        status: "unavailable",
        reason: STORAGE_UNAVAILABLE,
      });
      throw new Error(STORAGE_UNAVAILABLE, { cause: error });
    }
    this.#credentials.set(id, { status: "saved" });
    await this.#reconnect(server);
  }

  async #clearToken(id: string): Promise<void> {
    this.#refuseBuiltIn(id);
    const definitions = await this.#reconcile();
    await this.#forgetToken(id);
    const server = definitions.find((item) => item.id === id);
    if (server) await this.#reconnect(server);
  }

  /** True only when the token is known to be gone. */
  async #forgetToken(id: string): Promise<boolean> {
    try {
      await this.#store.delete(id);
      this.#credentials.set(id, { status: "none" });
      return true;
    } catch {
      this.#credentials.set(id, {
        status: "unavailable",
        reason: STORAGE_UNAVAILABLE,
      });
      return false;
    }
  }

  /** Credentials are read at connection time, so a change means reconnecting. */
  async #reconnect(server: McpServerDefinition): Promise<void> {
    await this.#disconnect(server.id);
    if (server.enabled) await this.#ensureConnected(server);
  }

  async #setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    this.#refuseBuiltIn(id);
    const definitions = await this.#reconcile();
    const server = definitions.find((item) => item.id === id);
    if (!server) throw new Error("The MCP server no longer exists.");
    const state = await this.#readState();
    const current = state[id] ?? { url: server.url, disabledTools: [] };
    const disabled = new Set(current.disabledTools);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    const disabledTools = [...disabled].sort();
    await this.#writeState({ ...state, [id]: { ...current, disabledTools } });
    this.#definitions = definitions.map((item) =>
      item.id === id ? { ...item, disabledTools } : item,
    );
  }

  /**
   * A dry run against a draft definition: connects, lists tools, and closes
   * immediately. Never touches `#connected`, `#failures`, or persisted state,
   * so it cannot disturb a server already connected under the same id.
   */
  async test(
    definition: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> {
    let connection: McpConnection | undefined;
    try {
      connection = await this.#connect(definition, () =>
        Promise.resolve(token),
      );
      const tools = await connection.listTools();
      return {
        ok: true,
        tools: tools.map(({ name, description }) => ({
          name,
          enabled: true,
          ...(description ? { description } : {}),
        })),
      };
    } catch (error) {
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

  async availableTools(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<readonly ToolSpec[]> {
    await this.manage();
    await this.#openBuiltIns(scope, excludedServerIds);
    return [...this.#routes(scope, excludedServerIds).entries()].map(
      ([name, route]) => ({
        name,
        description:
          route.tool.description ??
          `Use ${route.tool.name} from ${route.server.name}.`,
        inputSchema: route.tool.inputSchema ?? { type: "object" },
      }),
    );
  }

  async inspect(
    name: string,
    args: unknown,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolCallInspection> {
    await this.manage();
    await this.#openBuiltIns(scope, excludedServerIds);
    const route = this.#routes(scope, excludedServerIds).get(name);
    if (!route) {
      return {
        ok: false,
        reason: "This MCP tool is no longer available.",
      };
    }
    const presentation = await this.#builtIns
      .find((server) => server.id === route.server.id)
      ?.inspect?.(route.tool.name, asArguments(args), scope);
    if (presentation && !presentation.ok) return presentation;
    return {
      ok: true,
      action: `Use ${route.server.name}: ${route.tool.name}`,
      target: route.server.name,
      destination: route.server.url,
      // Laid out from the tool's own schema, so a connection added tomorrow is
      // as readable as a built-in one. A built-in that describes its own call
      // better keeps its version: the spread below lets it win.
      invocation: describeCall(
        route.tool.name,
        asArguments(args),
        route.server.url,
        route.tool.inputSchema,
      ),
      ...presentation,
      identity: JSON.stringify({
        server: route.server,
        schema: route.tool.inputSchema,
        ...(presentation?.identity ? { action: presentation.identity } : {}),
      }),
      // A built-in connection knows its own arguments — which of them run to
      // pages of text, and how they read — so its own wording stands. Only a
      // server that says nothing is described from out here.
      command:
        presentation?.ok && presentation.command
          ? presentation.command
          : `${name}(${JSON.stringify(asArguments(args))})`,
    };
  }

  async execute(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    expectedIdentity?: string,
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Promise<ToolInvocationResult> {
    if (signal?.aborted)
      return { ok: false, reason: "The action was stopped." };
    await this.manage();
    await this.#openBuiltIns(scope, excludedServerIds);
    const route = this.#routes(scope, excludedServerIds).get(name);
    if (!route) {
      return { ok: false, reason: "This MCP tool is no longer available." };
    }
    const builtIn = this.#builtIns.find(
      (server) => server.id === route.server.id,
    );
    const current =
      expectedIdentity !== undefined || builtIn?.inspect
        ? await this.inspect(name, args, scope, excludedServerIds)
        : undefined;
    if (
      current &&
      (!current.ok ||
        (expectedIdentity !== undefined &&
          current.identity !== expectedIdentity))
    )
      return {
        ok: false,
        reason:
          "The connection changed after approval. Request approval again.",
      };
    const present = (result: ToolInvocationResult): ToolInvocationResult => {
      const describe = this.#builtIns.find(
        (server) => server.id === route.server.id,
      )?.describeResult;
      if (!describe) return result;
      try {
        return {
          ...result,
          details: describe(route.tool.name, asArguments(args), result, scope),
        };
      } catch {
        return result;
      }
    };
    try {
      if (signal?.aborted)
        return { ok: false, reason: "The action was stopped." };
      const binding: string | undefined =
        current?.ok && current.identity
          ? (JSON.parse(current.identity) as { action?: string }).action
          : undefined;
      const value = await (builtIn?.inspect
        ? route.connection.callTool(
            route.tool.name,
            asArguments(args),
            signal,
            binding,
          )
        : signal
          ? route.connection.callTool(
              route.tool.name,
              asArguments(args),
              signal,
            )
          : route.connection.callTool(route.tool.name, asArguments(args)));
      if (signal?.aborted)
        return builtIn
          ? { ok: false, reason: "The action was stopped." }
          : {
              ok: false,
              reason:
                "Stopped waiting. The remote action may already have taken effect.",
            };
      if (!supportedResult(value))
        return { ok: false, reason: "The server returned an invalid result." };
      // Pictures come off the text channel first: what is left is what has to
      // fit, and a screenshot is not something a size limit should judge.
      const separated = separateImages(value);
      const bounded = shortened(separated.value as object);
      if (!bounded)
        return {
          ok: false,
          reason:
            "The server returned too much data. Request a smaller result.",
        };
      if ("isError" in value && value.isError === true) {
        const content =
          "content" in value && Array.isArray(value.content)
            ? value.content
            : [];
        const reason = content
          .filter(
            (item): item is { type: string; text: string } =>
              Boolean(item) &&
              typeof item === "object" &&
              item.type === "text" &&
              typeof item.text === "string",
          )
          .map((item) => item.text)
          .join("\n")
          .slice(0, 4000);
        return present({
          ok: false,
          reason: reason || "The server could not complete this action.",
        });
      }
      return present({
        ok: true,
        value: bounded,
        ...(separated.images.length ? { images: separated.images } : {}),
      });
    } catch (error) {
      if (signal?.aborted)
        return {
          ok: false,
          reason: builtIn
            ? "The action was stopped."
            : "Stopped waiting. The remote action may already have taken effect.",
        };
      if (builtIn)
        return present({
          ok: false,
          reason:
            error instanceof Error && error.message.trim()
              ? error.message
              : "The built-in connection could not complete this action.",
        });
      const refused = error instanceof McpUnauthorizedError;
      await this.#disconnect(route.connectionKey);
      this.#failures.set(
        route.connectionKey,
        refused
          ? { status: "unauthorized", reason: UNAUTHORIZED }
          : {
              status: "failed",
              reason: "The connection to this MCP server was lost.",
            },
      );
      return {
        ok: false,
        reason: refused
          ? UNAUTHORIZED
          : "The MCP server could not complete this action.",
      };
    }
  }

  async shutdownAll(): Promise<void> {
    const scopes = this.#builtIns.flatMap((server) => {
      if (server.scope !== "conversation") return [];
      const prefix = `${server.id}\0`;
      return [
        ...new Set([...this.#connected.keys(), ...this.#connecting.keys()]),
      ]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ server, scope: key.slice(prefix.length) }));
    });
    for (const id of new Set([
      ...this.#connected.keys(),
      ...this.#connecting.keys(),
    ]))
      this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    await Promise.all(
      [...this.#connected.values()].map(({ connection }) =>
        connection.close().catch(() => undefined),
      ),
    );
    this.#connected.clear();
    this.#descriptions.clear();
    await Promise.all(
      scopes.map(({ server, scope }) => server.forget?.(scope)),
    );
  }

  async shutdownScope(scope: string): Promise<void> {
    const scoped = this.#builtIns.filter(
      (server) => server.scope === "conversation",
    );
    await Promise.all(
      scoped.map(async (server) => {
        const key = this.#builtInKey(server, scope);
        if (key) await this.#disconnect(key);
        await server.forget?.(scope);
      }),
    );
  }

  async #ensureConnected(server: McpServerDefinition): Promise<void> {
    if (this.#connected.has(server.id) || this.#failures.has(server.id)) return;
    const pending = this.#connecting.get(server.id);
    if (pending) return pending;
    const connecting = this.#openConnection(server);
    this.#connecting.set(server.id, connecting);
    try {
      await connecting;
    } finally {
      if (this.#connecting.get(server.id) === connecting)
        this.#connecting.delete(server.id);
    }
  }

  async #openConnection(server: McpServerDefinition): Promise<void> {
    const epoch = this.#epochs.get(server.id) ?? 0;
    let connection: McpConnection | undefined;
    try {
      connection = await this.#connect(server, () =>
        this.#store.get(server.id),
      );
      const tools = await connection.listTools();
      if ((this.#epochs.get(server.id) ?? 0) !== epoch) {
        await connection.close();
        return;
      }
      this.#connected.set(server.id, { connection, tools });
    } catch (error) {
      await connection?.close().catch(() => undefined);
      if ((this.#epochs.get(server.id) ?? 0) === epoch)
        this.#failures.set(
          server.id,
          error instanceof McpUnauthorizedError
            ? { status: "unauthorized", reason: UNAUTHORIZED }
            : {
                status: "failed",
                reason: "Could not connect to this MCP server.",
              },
        );
    }
  }

  async #disconnect(id: string): Promise<void> {
    this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    this.#connecting.delete(id);
    const connected = this.#connected.get(id);
    this.#connected.delete(id);
    this.#failures.delete(id);
    if (connected) await connected.connection.close().catch(() => undefined);
  }

  #routes(
    scope?: string,
    excludedServerIds: readonly string[] = [],
  ): Map<string, RoutedTool> {
    const routes = new Map<string, RoutedTool>();
    const claimed = new Set<string>();
    // A name two tools would answer to routes to neither.
    const route = (name: string, value: RoutedTool) => {
      if (claimed.has(name)) routes.delete(name);
      else routes.set(name, value);
      claimed.add(name);
    };
    const excluded = new Set(excludedServerIds);
    for (const server of this.#builtIns) {
      if (excluded.has(server.id)) continue;
      const connectionKey = this.#builtInKey(server, scope);
      if (!connectionKey) continue;
      const connected = this.#connected.get(connectionKey);
      if (!connected) continue;
      for (const tool of connected.tools) {
        route(routedName(server.id, tool.name), {
          server: { id: server.id, name: server.name, url: "", enabled: true },
          tool,
          connection: connected.connection,
          connectionKey,
        });
      }
    }
    for (const server of this.#definitions ?? []) {
      if (excluded.has(server.id)) continue;
      const connected = this.#connected.get(server.id);
      if (!server.enabled || !connected) continue;
      const disabledTools = new Set(server.disabledTools ?? []);
      for (const tool of connected.tools) {
        if (disabledTools.has(tool.name)) continue;
        route(routedName(server.id, tool.name), {
          server,
          tool,
          connection: connected.connection,
          connectionKey: server.id,
        });
      }
    }
    return routes;
  }

  /** The declared connections, after forgetting what is no longer declared. */
  async #reconciled(): Promise<McpServerDefinition[]> {
    let result: McpServerDefinition[] = [];
    await this.#enqueue(async () => {
      result = await this.#reconcile();
    });
    return result;
  }

  /**
   * Joins what packages declare to what is remembered about each connection.
   * A connection that is no longer declared loses its token and its choices;
   * one whose endpoint changed loses its token, since a token is issued for
   * one endpoint. A choice is only dropped once its token is known to be gone,
   * so an unavailable credential store is asked again next time.
   * Runs inside the mutation queue.
   */
  async #reconcile(): Promise<McpServerDefinition[]> {
    let declared: readonly DeclaredMcpServer[];
    try {
      declared = await this.#declared();
    } catch (error) {
      throw new Error("Connections could not be read.", { cause: error });
    }
    const state = await this.#readState();
    const next: SavedConnections = { ...state };
    const byId = new Map(declared.map((server) => [server.id, server]));
    for (const id of Object.keys(state)) {
      if (byId.has(id)) continue;
      await this.#disconnect(id);
      if (await this.#forgetToken(id)) {
        delete next[id];
        this.#credentials.delete(id);
      }
    }
    const definitions: McpServerDefinition[] = [];
    for (const server of declared) {
      if (this.#isBuiltIn(server.id))
        throw new Error(`Connection “${server.id}” is built in to Zhiyin.`);
      const remembered = next[server.id];
      if (
        remembered &&
        remembered.url !== server.url &&
        (await this.#forgetToken(server.id))
      )
        next[server.id] = { url: server.url, disabledTools: [] };
      const previous = this.#definitions?.find((item) => item.id === server.id);
      // Switching a connection on, or pointing it elsewhere, starts it afresh
      // rather than repeating a failure remembered from before.
      if (
        !server.enabled ||
        (previous &&
          (!previous.enabled ||
            previous.url !== server.url ||
            previous.name !== server.name))
      )
        await this.#disconnect(server.id);
      const disabledTools = next[server.id]?.disabledTools ?? [];
      const definition: McpServerDefinition = {
        id: server.id,
        name: server.name,
        url: server.url,
        enabled: server.enabled,
        ...(disabledTools.length ? { disabledTools } : {}),
      };
      try {
        validateDefinition(definition);
      } catch (error) {
        this.#failures.set(server.id, {
          status: "failed",
          reason:
            error instanceof Error ? error.message : "Invalid MCP endpoint.",
        });
      }
      definitions.push(definition);
    }
    if (JSON.stringify(next) !== JSON.stringify(state))
      await this.#writeState(next);
    this.#definitions = definitions;
    return definitions;
  }

  async #remember(id: string, url: string): Promise<void> {
    const state = await this.#readState();
    if (state[id]?.url === url) return;
    await this.#writeState({ ...state, [id]: { url, disabledTools: [] } });
  }

  async #readState(): Promise<SavedConnections> {
    let source: string;
    try {
      source = await readFile(this.#file, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return {};
      throw new Error("Connection settings could not be read.", {
        cause: error,
      });
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!isSavedConnections(value))
        throw new Error("Invalid connection settings");
      return value.connections;
    } catch (error) {
      throw new Error("Saved connection settings are damaged.", {
        cause: error,
      });
    }
  }

  async #writeState(connections: SavedConnections): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const temporary = `${this.#file}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, connections }, null, 2),
        "utf8",
      );
      await rename(temporary, this.#file);
    } catch (error) {
      throw new Error("Connection settings could not be saved.", {
        cause: error,
      });
    }
  }
}

/** A refused credential must not read as an unreachable server. */
function rethrowRefusals(error: unknown): never {
  if (UnauthorizedError.isInstance(error))
    throw new McpUnauthorizedError(UNAUTHORIZED, { cause: error });
  throw error;
}

export const connectHttpMcpServer: McpConnectionFactory = async (
  definition,
  token,
) => {
  const client = new Client({ name: "zhiyin", version: "0.1.0" });
  // The transport asks for the token before every request, so a token saved or
  // revoked later takes effect without the credential being copied here.
  const transport = new StreamableHTTPClientTransport(new URL(definition.url), {
    authProvider: { token },
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
      return tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
      }));
    },
    callTool: (name, args, signal) =>
      client
        .callTool(
          { name, arguments: args },
          { ...(signal ? { signal } : {}), timeout: 60_000 },
        )
        .catch(rethrowRefusals),
    close: () => client.close(),
  };
};
