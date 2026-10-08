/**
 * What each conversation-scoped built-in says it offers, asked once, apart
 * from any one conversation's connection to it.
 */

import type {
  BuiltInMcpServer,
  McpConnectionTool,
} from "./connection-types.js";
import type { Failure } from "./connection-problems.js";

export class BuiltInDescriptions {
  readonly #descriptions = new Map<string, readonly McpConnectionTool[]>();
  readonly #describing = new Map<string, Promise<void>>();
  /** Not kept once it works: the fix, such as installing a browser, is outside. */
  readonly #failures = new Map<string, string>();

  /** Asks each conversation-scoped built-in that can describe itself. */
  async describe(builtIns: readonly BuiltInMcpServer[]): Promise<void> {
    await Promise.all(
      builtIns.map(async (server) => {
        const describe = server.describe;
        if (server.scope !== "conversation" || !describe) return;
        if (this.#descriptions.has(server.id)) return;
        const pending = this.#describing.get(server.id);
        if (pending) return pending;
        const describing = (async () => {
          try {
            this.#descriptions.set(server.id, await describe());
            this.#failures.delete(server.id);
          } catch (error) {
            this.#failures.set(
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

  health(id: string): {
    tools: readonly McpConnectionTool[] | undefined;
    failure: Failure | undefined;
  } {
    const reason = this.#failures.get(id);
    return {
      tools: this.#descriptions.get(id),
      failure: reason ? { status: "failed", reason } : undefined,
    };
  }

  /** Forgets what was said, so the next look asks again. */
  clear(): void {
    this.#descriptions.clear();
  }
}
