/**
 * A stand-in for the packaged Playwright server: it answers the two protocol
 * calls that matter and asks for a browser context only when a tool is
 * called — the behaviour the real one was measured to have.
 */
export function fakeAutomationServer(
  /** Tools it lists besides its usual four, as Playwright describes them. */
  more: readonly {
    name: string;
    description: string;
    inputSchema?: Readonly<Record<string, unknown>>;
  }[] = [],
  /**
   * What it answers each tool call with: the same words for every call, or
   * the content for each call by the tool called and its arguments.
   */
  said: string | ((name: string, args: unknown) => readonly unknown[]) = "done",
) {
  let contextGetter: (() => Promise<unknown>) | undefined;
  let closed = false;
  let calls = 0;
  let config: unknown;
  let lastArguments: unknown;
  const called: string[] = [];
  return {
    /** Each tool called, by name, in order. */
    called: () => called,
    getterCalls: () => calls,
    wasClosed: () => closed,
    config: () => config,
    lastArguments: () => lastArguments,
    createConnection: async (
      given?: unknown,
      getter?: () => Promise<unknown>,
    ) => {
      config = given;
      contextGetter = getter;
      return {
        connect: async (transport: {
          start(): Promise<void>;
          send(message: unknown): Promise<void>;
          onmessage?: (message: unknown) => void;
        }) => {
          transport.onmessage = async (message) => {
            const request = message as { id?: number; method?: string };
            if (request.id === undefined) return;
            const result =
              request.method === "initialize"
                ? {
                    protocolVersion: "2025-11-25",
                    capabilities: { tools: {} },
                    serverInfo: { name: "playwright", version: "1" },
                  }
                : request.method === "tools/list"
                  ? {
                      tools: [
                        {
                          name: "browser_navigate",
                          description: "Go to a page.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_run_code_unsafe",
                          description: "Run arbitrary Playwright code.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_cookie_list",
                          description: "List cookies.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_take_screenshot",
                          description: "Take a picture of the page.",
                          inputSchema: {
                            type: "object",
                            properties: {
                              filename: {
                                type: "string",
                                description: "Where to save the picture.",
                              },
                              fullPage: { type: "boolean" },
                              scale: {
                                type: "string",
                                enum: ["css", "device"],
                              },
                            },
                          },
                        },
                        ...more.map((tool) => ({
                          inputSchema: { type: "object" },
                          ...tool,
                        })),
                      ],
                    }
                  : await (async () => {
                      calls += 1;
                      called.push(
                        String(
                          (message as { params?: { name?: unknown } }).params
                            ?.name,
                        ),
                      );
                      lastArguments = (
                        message as { params?: { arguments?: unknown } }
                      ).params?.arguments;
                      await contextGetter?.();
                      return {
                        content:
                          typeof said === "string"
                            ? [{ type: "text", text: said }]
                            : said(called.at(-1)!, lastArguments),
                      };
                    })().catch((cause: unknown) => ({
                      failed:
                        cause instanceof Error ? cause.message : String(cause),
                    }));
            await transport
              .send(
                "failed" in (result as Record<string, unknown>)
                  ? {
                      jsonrpc: "2.0",
                      id: request.id,
                      error: {
                        code: -32603,
                        message: (result as { failed: string }).failed,
                      },
                    }
                  : { jsonrpc: "2.0", id: request.id, result },
              )
              // An answer to a client that has gone is dropped, as a server would.
              .catch(() => undefined);
          };
          await transport.start();
        },
        close: async () => {
          closed = true;
        },
      };
    },
  };
}
