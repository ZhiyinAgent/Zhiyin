import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
} from "@zhiyin/contract";
import type { Capabilities } from "@zhiyin/capabilities";

type ConnectionCapabilities = Pick<
  Capabilities,
  | "retryConnections"
  | "setConnectionToolEnabled"
  | "testConnection"
  | "saveConnectionToken"
  | "clearConnectionToken"
>;

/** Connection tokens and tool choices, refreshing the workspace's connection snapshot after each change. */
export class WorkspaceConnections {
  readonly #capabilities: ConnectionCapabilities;
  readonly #refresh: () => Promise<void>;

  constructor(options: {
    readonly capabilities: ConnectionCapabilities;
    readonly refresh: () => Promise<void>;
  }) {
    this.#capabilities = options.capabilities;
    this.#refresh = options.refresh;
  }

  async setToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    await this.#capabilities.setConnectionToolEnabled(id, toolName, enabled);
    await this.#refresh();
  }

  /** A dry run, saving nothing; the snapshot never needs refreshing for it. */
  test(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> {
    return this.#capabilities.testConnection(server, token);
  }

  async saveToken(id: string, token: string): Promise<void> {
    await this.#capabilities.saveConnectionToken(id, token);
    await this.#refresh();
  }

  async clearToken(id: string): Promise<void> {
    await this.#capabilities.clearConnectionToken(id);
    await this.#refresh();
  }

  /** Re-checks every connection now, trying failed ones again. */
  async refresh(): Promise<void> {
    await this.#capabilities.retryConnections();
    await this.#refresh();
  }
}
