import { type ConnectionToolTreatment } from "@zhiyin/contract";
import { isConnectionToolTreatment } from "@zhiyin/value-checks";
import type { DeclaredMcpServer } from "./mcp-servers.js";
import { createHash } from "node:crypto";
import type {
  RememberedConnection,
  SavedConnections,
  SaidOfTool,
} from "./saved-connections.js";

/** A tool as its server lists it. */
type Tool = {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: unknown;
};

/** What the person said of each tool, where it differs from asking once. */
type Said = Readonly<Record<string, SaidOfTool>>;

/**
 * Which version of a tool the person spoke of: its schema and description,
 * which the model reads as what the tool does. A server that rewrites either
 * has a tool the person said nothing of.
 */
function toolVersion(tool: Tool): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        description: tool.description ?? "",
        schema: tool.inputSchema ?? null,
      }),
    )
    .digest("hex");
}

/**
 * How the person asked each tool of a connection Zhiyin does not ship to be
 * treated (ADR 0012). A connection a package Zhiyin ships takes no such word:
 * what its tools do is Zhiyin's to say. What was said of one endpoint is not
 * carried to another.
 */
export class ToolTreatments {
  #shipped: ReadonlySet<string> = new Set();
  #said: ReadonlyMap<string, Said> = new Map();

  /** Keeps what these declarations and the saved settings say. */
  learn(declared: readonly DeclaredMcpServer[], saved: SavedConnections): void {
    this.#shipped = new Set(
      declared.filter(shipsWithZhiyin).map((server) => server.id),
    );
    this.#said = new Map(
      declared.flatMap((server) => {
        const remembered = saved[server.id];
        return !this.#shipped.has(server.id) &&
          remembered?.url === server.url &&
          remembered.toolTreatments
          ? [[server.id, remembered.toolTreatments] as const]
          : [];
      }),
    );
  }

  /** A package Zhiyin ships declares the connection. */
  ships(connection: string): boolean {
    return this.#shipped.has(connection);
  }

  /**
   * What the person said of this version of the tool, when it is more than
   * asking once.
   */
  personSays(
    connection: string,
    tool: Tool,
  ): "ask-each-time" | "only-reads" | undefined {
    if (this.ships(connection)) return undefined;
    const said = this.#said.get(connection)?.[tool.name];
    return said?.version === toolVersion(tool) ? said.says : undefined;
  }

  /** How the tool is shown as treated; nothing for one Zhiyin ships. */
  shown(
    connection: string,
    tool: Tool,
  ): {
    readonly treatment?: ConnectionToolTreatment;
    readonly version?: string;
  } {
    return this.ships(connection)
      ? {}
      : {
          treatment: this.personSays(connection, tool) ?? "ask-once",
          version: toolVersion(tool),
        };
  }

  /** Throws for a connection Zhiyin ships: what its tools do is Zhiyin's to say. */
  refuseShipped(connection: string): void {
    if (this.ships(connection))
      throw new Error(
        "Zhiyin ships this connection and says itself what its tools do.",
      );
  }

  /**
   * Counts what is now remembered of the connection, once saved. What was
   * said of another endpoint than the one it is at, `url`, counts for nothing.
   */
  keep(connection: string, url: string, remembered: RememberedConnection) {
    if (remembered.url !== url) return;
    this.#said = new Map(this.#said).set(
      connection,
      remembered.toolTreatments ?? {},
    );
  }
}

/** What is remembered of a connection once the person said this of a tool. */
export function withToolTreatment(
  remembered: RememberedConnection,
  /** The address the connection has now. */
  url: string,
  tool: Tool | undefined,
  treatment: ConnectionToolTreatment,
  shown: string,
): RememberedConnection {
  // Still kept for the address the connection had, while the sign-in saved
  // for it is not yet forgotten: a choice saved there would count for nothing.
  if (remembered.url !== url)
    throw new Error(
      "The sign-in kept for this connection's earlier address could not be removed yet, so this choice cannot be kept. Try again.",
    );
  // The word is said of the tool as the person saw it, and only while the
  // server still offers that version.
  if (!tool)
    throw new Error(
      "Connect to this server first, so the choice is kept for the tool as it is now.",
    );
  if (toolVersion(tool) !== shown)
    throw new Error(
      "This tool changed since it was shown: read what it says now, then choose again.",
    );
  if (!isConnectionToolTreatment(treatment))
    throw new Error("Choose how this tool is treated.");
  const others = Object.entries(remembered.toolTreatments ?? {}).filter(
    ([name]) => name !== tool.name,
  );
  const said: Said = Object.fromEntries(
    treatment === "ask-once"
      ? others
      : [
          ...others,
          [tool.name, { says: treatment, version: toolVersion(tool) }],
        ],
  );
  const kept = {
    url: remembered.url,
    disabledTools: remembered.disabledTools,
  };
  return Object.keys(said).length ? { ...kept, toolTreatments: said } : kept;
}

/** A connection whose tools' doings a package Zhiyin ships says. */
function shipsWithZhiyin(server: DeclaredMcpServer): boolean {
  return server.shipped === true || Boolean(server.toolEffects?.length);
}
