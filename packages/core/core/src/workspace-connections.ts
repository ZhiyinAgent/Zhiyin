import type {
  ConnectionToolTreatment,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
} from "@zhiyin/contract";
import type { ConnectionManagement } from "@zhiyin/capabilities";

/** Connection tokens and tool choices, refreshing the workspace's connection snapshot after each change. */
export class WorkspaceConnections {
  readonly #capabilities: ConnectionManagement;
  readonly #refresh: () => Promise<void>;
  /** The sign-ins waiting in the person's browser, each one's way to stop it. */
  readonly #signingIn = new Map<string, AbortController>();

  constructor(options: {
    readonly capabilities: ConnectionManagement;
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

  async setToolTreatment(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    shown: string,
  ): Promise<void> {
    try {
      await this.#capabilities.setConnectionToolTreatment(
        id,
        toolName,
        treatment,
        shown,
      );
    } finally {
      // Refused too, the window shows the tool as it is now.
      await this.#refresh();
    }
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

  async signIn(id: string): Promise<McpSignInOutcome> {
    if (this.#signingIn.has(id))
      return {
        status: "failed",
        reason: "A sign-in to this service is already waiting in your browser.",
      };
    const controller = new AbortController();
    this.#signingIn.set(id, controller);
    try {
      return await this.#capabilities.signInToConnection(id, controller.signal);
    } finally {
      this.#signingIn.delete(id);
      await this.#refresh();
    }
  }

  async cancelSignIn(id: string): Promise<void> {
    this.#signingIn.get(id)?.abort();
  }

  /** Reaches one connection now; the snapshot then shows how it answered. */
  async check(id: string): Promise<McpServerState> {
    const state = await this.#capabilities.checkConnection(id);
    await this.#refresh();
    return state;
  }

  /** Re-checks every connection now, trying failed ones again. */
  async refresh(): Promise<void> {
    await this.#capabilities.retryConnections();
    await this.#refresh();
  }
}
