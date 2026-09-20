import {
  ManagedMcpServers,
  type BuiltInMcpServer,
  type DeclaredMcpServer,
  type McpConnectionFactory,
  type McpCredentialStore,
} from "../src/index.js";

/**
 * A connection engine whose declarations a test controls, standing in for the
 * packages that declare connections in the product. Each change is followed by
 * a look at the connections, as the app refreshes after any package change.
 */
export type DeclaringServers = ManagedMcpServers & {
  declare(server: DeclaredMcpServer): Promise<void>;
  switchTo(id: string, enabled: boolean): Promise<void>;
  undeclare(id: string): Promise<void>;
  failDeclarations(failing: boolean): void;
};

export function managed(
  directory: string,
  connect: McpConnectionFactory,
  credentials: McpCredentialStore,
  builtIns: readonly BuiltInMcpServer[] = [],
): DeclaringServers {
  let declared: DeclaredMcpServer[] = [];
  let failing = false;
  const servers = new ManagedMcpServers(
    directory,
    connect,
    credentials,
    builtIns,
    async () => {
      if (failing) throw new Error("packages are unreadable");
      return declared.map((server) => ({ ...server }));
    },
  );
  const settle = async () => {
    await servers.manage();
  };
  return Object.assign(servers, {
    async declare(server: DeclaredMcpServer) {
      declared = [
        ...declared.filter((item) => item.id !== server.id),
        { ...server },
      ];
      await settle();
    },
    async switchTo(id: string, enabled: boolean) {
      declared = declared.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      );
      await settle();
    },
    async undeclare(id: string) {
      declared = declared.filter((item) => item.id !== id);
      await settle();
    },
    failDeclarations(next: boolean) {
      failing = next;
    },
  });
}
