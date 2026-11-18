/**
 * What is remembered about each declared connection, in one file: the endpoint
 * a saved token belongs to, and which of its tools a person switched off.
 */

import { mkdir, readFile } from "node:fs/promises";
import { replaceFile } from "@zhiyin/files";
import { join } from "node:path";
import { isConnectionToolTreatment } from "@zhiyin/value-checks";

/** What is remembered about one declared connection. */
export type RememberedConnection = {
  /** The endpoint a saved token and tool choices belong to. */
  readonly url: string;
  readonly disabledTools: readonly string[];
  /**
   * Only what differs from asking once per conversation is kept, with the
   * version of the tool it was said of: its schema and description.
   */
  readonly toolTreatments?: Readonly<Record<string, SaidOfTool>>;
};

/** What the person said of one tool, and of which version of it. */
export type SaidOfTool = {
  readonly says: "ask-each-time" | "only-reads";
  readonly version: string;
};

function isSaidOfTool(value: unknown): value is SaidOfTool {
  if (typeof value !== "object" || value === null) return false;
  const said = value as Record<string, unknown>;
  return (
    isConnectionToolTreatment(said["says"]) &&
    said["says"] !== "ask-once" &&
    typeof said["version"] === "string"
  );
}

export type SavedConnections = Record<string, RememberedConnection>;

function isRemembered(value: unknown): value is RememberedConnection {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const tools = item["disabledTools"];
  const treatments = item["toolTreatments"];
  return (
    typeof item["url"] === "string" &&
    Array.isArray(tools) &&
    tools.every((tool) => typeof tool === "string") &&
    (treatments === undefined ||
      (typeof treatments === "object" &&
        treatments !== null &&
        !Array.isArray(treatments) &&
        Object.values(treatments).every(isSaidOfTool)))
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

export class SavedConnectionsFile {
  readonly #directory: string;
  readonly #file: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#file = join(directory, "mcp-connections.json");
  }

  async remember(id: string, url: string): Promise<void> {
    const state = await this.read();
    if (state[id]?.url === url) return;
    await this.write({ ...state, [id]: { url, disabledTools: [] } });
  }

  async read(): Promise<SavedConnections> {
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

  async write(connections: SavedConnections): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    try {
      await replaceFile(
        this.#file,
        JSON.stringify({ version: 1, connections }, null, 2),
      );
    } catch (error) {
      throw new Error("Connection settings could not be saved.", {
        cause: error,
      });
    }
  }
}
