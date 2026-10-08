import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ServerResponse } from "node:http";
import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryMcpCredentials,
  ManagedMcpServers,
  McpRateRefusedError,
  McpUnauthorizedError,
  connectHttpMcpServer,
  type McpConnection,
  type McpConnectionTool,
  type McpConnectionFactory,
} from "../src/index.js";
import { managed } from "./declarations.js";

/**
 * Choices about connections are written by reading the whole settings file,
 * editing it and writing it back. Overlapping changes that each started from
 * the same bytes would lose all but the last.
 */
describe("ManagedMcpServers concurrent choices", () => {
  it("keeps every tool choice made at the same time", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    const ids = Array.from(
      { length: 8 },
      (_, index) => `notes/server-${index}`,
    );
    for (const id of ids)
      await servers.declare({
        id,
        name: id,
        url: `https://${index(id)}.example.test/mcp`,
        enabled: true,
      });

    await Promise.all(
      ids.map((id) => servers.setToolEnabled(id, "read", false)),
    );

    expect(
      (await servers.manage()).map((item) => item.tools?.[0]?.enabled),
    ).toEqual(ids.map(() => false));
  });
});

function index(id: string): string {
  return id.replace(/\W/g, "-");
}

describe("connections come only from declarations", () => {
  function engine(credentials = new InMemoryMcpCredentials()) {
    return mkdtemp(join(tmpdir(), "zhiyin-mcp-")).then((directory) =>
      managed(
        directory,
        async () => ({
          listTools: async () => [{ name: "search" }],
          callTool: async () => ({ content: [] }),
          close: async () => {},
        }),
        credentials,
      ),
    );
  }

  const search = {
    id: "research/search",
    name: "Search",
    url: "https://search.example/mcp",
    enabled: true,
  };

  it("forgets a connection's token and tool choices once nothing declares it", async () => {
    const credentials = new InMemoryMcpCredentials();
    const servers = await engine(credentials);
    await servers.declare(search);
    await servers.saveToken(search.id, "secret");
    await servers.setToolEnabled(search.id, "search", false);

    await servers.undeclare(search.id);
    expect(await credentials.get(search.id)).toBeUndefined();

    await servers.declare(search);
    expect((await servers.manage())[0]).toMatchObject({
      credential: { status: "none" },
      tools: [{ name: "search", enabled: true }],
    });
  });

  it("keeps every token when the declarations cannot be read", async () => {
    const credentials = new InMemoryMcpCredentials();
    const servers = await engine(credentials);
    await servers.declare(search);
    await servers.saveToken(search.id, "secret");

    servers.failDeclarations(true);
    await expect(servers.manage()).rejects.toThrow(
      "Connections could not be read.",
    );

    expect(await credentials.get(search.id)).toBe("secret");
  });

  it("retries forgetting a token the credential store could not delete", async () => {
    let locked = false;
    const tokens = new Map<string, string>();
    const servers = await engine({
      get: async (id) => tokens.get(id),
      set: async (id, token) => {
        tokens.set(id, token);
      },
      delete: async (id) => {
        if (locked) throw new Error("locked");
        tokens.delete(id);
      },
    });
    await servers.declare(search);
    await servers.saveToken(search.id, "secret");

    locked = true;
    await servers.undeclare(search.id);
    expect(tokens.get(search.id)).toBe("secret");

    locked = false;
    await servers.manage();
    expect(tokens.has(search.id)).toBe(false);
  });

  it("offers a package connector's tools under a name model APIs accept", async () => {
    const servers = await engine();
    await servers.declare(search);

    const [tool] = await servers.availableTools();

    expect(tool?.name).toBe("mcp__research__search__search");
    expect(tool?.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(await servers.execute(tool!.name, {})).toMatchObject({ ok: true });
  });

  it("marks as reading only the tools its declaration names, never on the server's own annotation", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [
          { name: "search" },
          { name: "publish" },
          // The server says this one only reads; nobody who declared it did.
          { name: "delete_index", annotations: { readOnlyHint: true } },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({ ...search, readOnlyTools: ["search"] });

    const access = Object.fromEntries(
      (await servers.availableTools()).map((tool) => [tool.name, tool.access]),
    );

    expect(access).toEqual({
      mcp__research__search__search: "read",
      mcp__research__search__publish: undefined,
      mcp__research__search__delete_index: undefined,
    });
  });

  it("does not open a withheld application connection for a conversation", async () => {
    const opened: string[] = [];
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => {
        throw new Error("no package servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          scope: "conversation",
          open: async (scope) => {
            opened.push(scope ?? "");
            return {
              listTools: async () => [{ name: "navigate" }],
              callTool: async () => ({ content: [] }),
              close: async () => {},
            };
          },
        },
      ],
    );

    expect(await servers.availableTools("first", ["browser"])).toEqual([]);
    expect(opened).toEqual([]);
  });
});

describe("ManagedMcpServers", () => {
  it("does not let remote result metadata claim built-in presentation", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [{ name: "browser_navigate" }],
        callTool: async () => ({
          content: [],
          details: [
            { kind: "text", label: "Trusted browser", text: "Invented result" },
          ],
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "remote",
      name: "Remote",
      url: "https://example.test/mcp",
      enabled: true,
    });
    expect(
      await servers.inspect("mcp__remote__browser_navigate", {}),
    ).toMatchObject({ action: "Remote · Browser navigate" });
    const result = await servers.execute("mcp__remote__browser_navigate", {});
    expect(result).not.toHaveProperty("details");
    await servers.shutdownAll();
  });
  it("vouches for the files a built-in connection says a call will change, and never for a remote one", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [
          {
            name: "compile_document",
            annotations: { destructiveHint: true },
          },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
      [
        {
          id: "documents",
          name: "Document compiler",
          open: async () => ({
            listTools: async () => [{ name: "compile_document" }],
            callTool: async () => ({ content: [] }),
            close: async () => {},
          }),
          inspect: async () => ({
            ok: true,
            action: "Compile a Typst document",
            target: "paper.typ",
            command: "typst paper.typ",
            access: "change",
            scope: "workspace",
            changes: [{ path: "paper.pdf", change: "updated" }],
          }),
        },
      ],
    );
    await servers.declare({
      id: "remote",
      name: "Remote",
      url: "https://example.test/mcp",
      enabled: true,
    });

    expect(
      await servers.inspect("mcp__documents__compile_document", {}),
    ).toMatchObject({
      ok: true,
      builtInConnection: true,
      changes: [{ path: "paper.pdf", change: "updated" }],
    });
    const remote = await servers.inspect("mcp__remote__compile_document", {});
    expect(remote).toMatchObject({ ok: true });
    expect(remote).not.toHaveProperty("builtInConnection");
    expect(remote).not.toHaveProperty("changes");
    await servers.shutdownAll();
  });

  it("uses trusted built-in presentation while preserving approval identity and result failure", async () => {
    let root = "workspace-a";
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => {
        throw new Error("No external connection");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Browser",
          open: async () => ({
            listTools: async () => [{ name: "navigate" }],
            callTool: async () => ({
              isError: true,
              content: [{ type: "text", text: "Navigation refused" }],
            }),
            close: async () => {},
          }),
          inspect: async () => ({
            ok: true,
            action: "Open page",
            target: "https://example.test",
            command: "navigate()",
            identity: root,
            invocation: {
              name: "Open page",
              arguments: [{ name: "Address", value: "https://example.test" }],
            },
          }),
          describeResult: (_name, _args, result) => [
            {
              kind: "text",
              label: "Browser error",
              text: result.ok ? "Unexpected success" : result.reason,
            },
          ],
        },
      ],
    );
    const inspected = await servers.inspect("mcp__browser__navigate", {});
    expect(inspected).toMatchObject({
      ok: true,
      action: "Open page",
      invocation: { name: "Open page" },
      // A built-in connection writes its own calls: it knows which of its
      // arguments run long and how they should read. Only a server that says
      // nothing is described from the outside.
      command: "navigate()",
      // Which connection this is stays the app's word, whatever page the
      // built-in names as the call's target.
      target: "https://example.test",
      connection: "Browser",
    });
    expect(
      await servers.execute(
        "mcp__browser__navigate",
        {},
        undefined,
        inspected.ok ? inspected.identity : undefined,
      ),
    ).toMatchObject({
      ok: false,
      details: [{ label: "Browser error", text: "Navigation refused" }],
    });
    root = "workspace-b";
    expect(
      await servers.execute(
        "mcp__browser__navigate",
        {},
        undefined,
        inspected.ok ? inspected.identity : undefined,
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("changed after approval"),
    });
    await servers.shutdownAll();
  });
  it("lets a built-in connection declare the files a successful call produced", async () => {
    let fails = false;
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => {
        throw new Error("No external connection");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "documents",
          name: "Document compiler",
          open: async () => ({
            listTools: async () => [{ name: "compile_document" }],
            callTool: async () =>
              fails
                ? { isError: true, content: [{ type: "text", text: "No." }] }
                : { content: [{ type: "text", text: "Wrote paper.pdf." }] },
            close: async () => {},
          }),
          produced: () => [
            { path: "paper.pdf", change: "created" as const, bytes: 9 },
          ],
        },
      ],
    );

    expect(
      await servers.execute("mcp__documents__compile_document", {}),
    ).toMatchObject({
      ok: true,
      produced: [{ path: "paper.pdf", change: "created", bytes: 9 }],
    });
    fails = true;
    expect(
      await servers.execute("mcp__documents__compile_document", {}),
    ).not.toHaveProperty("produced");
    await servers.shutdownAll();
  });
  it("connects the production HTTP adapter and receives protocol-shaped errors", async () => {
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
            : {
                isError: true,
                content: [{ type: "text", text: "Missing document" }],
              };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    try {
      const connection = await connectHttpMcpServer(
        {
          id: "fixture",
          name: "Fixture",
          enabled: true,
          url: `http://127.0.0.1:${address.port}/mcp`,
        },
        async () => undefined,
      );
      try {
        expect((await connection.listTools())[0]?.name).toBe("read");
        expect(await connection.callTool("read", {})).toMatchObject({
          isError: true,
        });
      } finally {
        await connection.close();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reads an HTTP 429 from the production adapter as a rate refusal, with the wait the server asks for", async () => {
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "tools/call") {
        response.writeHead(429, { "Retry-After": "3" });
        response.end("Too Many Requests");
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : { tools: [{ name: "read", inputSchema: { type: "object" } }] };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    try {
      const connection = await connectHttpMcpServer(
        {
          id: "fixture",
          name: "Fixture",
          enabled: true,
          url: `http://127.0.0.1:${address.port}/mcp`,
        },
        async () => undefined,
      );
      try {
        const refusal = await connection.callTool("read", {}).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(refusal).toBeInstanceOf(McpRateRefusedError);
        expect((refusal as McpRateRefusedError).retryAfterMs).toBe(3_000);
      } finally {
        await connection.close();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a connection changed after its action was approved", async () => {
    let executed = false;
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => {
          executed = true;
          return { content: [] };
        },
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    const definition = {
      id: "docs",
      name: "Documents",
      enabled: true,
      url: "https://first.example/mcp",
    };
    await servers.declare(definition);
    const approval = await servers.inspect("mcp__docs__read", {});
    if (!approval.ok) throw new Error("Missing inspection");
    await servers.declare({ ...definition, url: "https://second.example/mcp" });
    expect(
      (
        await servers.execute(
          "mcp__docs__read",
          {},
          undefined,
          approval.identity,
        )
      ).ok,
    ).toBe(false);
    expect(executed).toBe(false);
  });
  it("preserves tool execution failures without losing the connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "write" }],
        callTool: async () => ({
          isError: true,
          content: [{ type: "text", text: "The document is locked." }],
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Documents",
      url: "https://example.com/mcp",
      enabled: true,
    });
    expect(await servers.execute("mcp__docs__write", {})).toEqual({
      ok: false,
      reason: "The document is locked.",
    });
    expect((await servers.manage())[0]?.status).toBe("connected");
  });
  it("rejects malformed and unsupported result content", async () => {
    const results: unknown[] = [
      { content: "not an array" },
      { content: [{ type: "text", text: 42 }] },
      { content: [{ type: "audio", data: "AAAA", mimeType: "audio/wav" }] },
      { content: [], structuredContent: ["not", "an", "object"] },
      { content: [], isError: "yes" },
    ];
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => results.shift(),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Documents",
      url: "https://example.com/mcp",
      enabled: true,
    });

    for (let index = 0; index < 5; index += 1) {
      await expect(servers.execute("mcp__docs__read", {})).resolves.toEqual({
        ok: false,
        reason: "The server returned an invalid result.",
      });
    }
    expect((await servers.manage())[0]?.status).toBe("connected");
  });

  it("accepts text, image, and structured result content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => ({
          content: [
            { type: "text", text: "Forecast: clear" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
          ],
          structuredContent: { temperature: 21 },
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "weather",
      name: "Weather",
      url: "https://example.com/mcp",
      enabled: true,
    });

    await expect(servers.execute("mcp__weather__read", {})).resolves.toEqual({
      ok: true,
      value: {
        content: [
          { type: "text", text: "Forecast: clear" },
          { type: "text", text: "[image 1, shown separately]" },
        ],
        structuredContent: { temperature: 21 },
      },
      images: [{ mediaType: "image/png", data: "AAAA" }],
    });
  });

  it("accepts an embedded text resource returned for a repository file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const result = {
      content: [
        { type: "text", text: "successfully downloaded text file" },
        {
          type: "resource",
          resource: {
            uri: "repo://ZhiyinAgent/Zhiyin/contents/README.md",
            mimeType: "text/markdown",
            text: "# Zhiyin",
          },
        },
      ],
    } as const;
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "get_file_contents" }],
        callTool: async () => result,
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "github",
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      enabled: true,
    });

    await expect(
      servers.execute("mcp__github__get_file_contents", {}),
    ).resolves.toEqual({ ok: true, value: result });
  });

  it("distinguishes cancellation before dispatch from a late resolved remote result", async () => {
    let release!: (value: unknown) => void;
    let dispatched = 0;
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "write" }],
        callTool: async () => {
          dispatched += 1;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Documents",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const before = new AbortController();
    before.abort();
    await expect(
      servers.execute("mcp__docs__write", {}, before.signal),
    ).resolves.toEqual({ ok: false, reason: "The action was stopped." });
    expect(dispatched).toBe(0);

    const after = new AbortController();
    const running = servers.execute("mcp__docs__write", {}, after.signal);
    await vi.waitFor(() => expect(dispatched).toBe(1));
    after.abort();
    release({ content: [{ type: "text", text: "Written" }] });
    await expect(running).resolves.toEqual({
      ok: false,
      reason:
        "Stopped waiting. The remote action may already have taken effect.",
    });
  });

  it("preserves uncertainty when a dispatched remote call throws after cancellation", async () => {
    let reject!: (error: Error) => void;
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "write" }],
        callTool: () =>
          new Promise((_resolve, nextReject) => {
            reject = nextReject;
          }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Documents",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const controller = new AbortController();
    const running = servers.execute("mcp__docs__write", {}, controller.signal);
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    controller.abort();
    reject(new Error("connection lost"));

    await expect(running).resolves.toEqual({
      ok: false,
      reason:
        "Stopped waiting. The remote action may already have taken effect.",
    });
  });
  it("shortens an oversized result instead of throwing the whole answer away", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => ({
          content: [
            {
              type: "text",
              text: "The answer is at the top. " + "x".repeat(8_200_000),
            },
          ],
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Documents",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const result = await servers.execute("mcp__docs__read", {});

    // A page too long to send is still a page that was read.
    expect(result.ok).toBe(true);
    const encoded = JSON.stringify(result.value);
    expect(encoded.length).toBeLessThanOrEqual(8_000_000);
    expect(encoded).toContain("The answer is at the top.");
    // And it says so, rather than letting the end look like the end.
    expect(encoded).toContain("shortened");
  });

  it("takes a picture out of the text and carries it as a picture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const picture = "A".repeat(400_000);
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "capture" }],
        callTool: async () => ({
          content: [
            { type: "text", text: "Captured the page." },
            { type: "image", data: picture, mimeType: "image/png" },
          ],
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "camera",
      name: "Camera",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const result = await servers.execute("mcp__camera__capture", {});

    if (!result.ok) throw new Error(result.reason);
    // The picture travels as a picture...
    expect(result.images).toEqual([{ mediaType: "image/png", data: picture }]);
    // ...and not as half a megabyte of text the model cannot see.
    const encoded = JSON.stringify(result.value);
    expect(encoded).not.toContain(picture);
    expect(encoded).toContain("Captured the page.");
    expect(encoded.length).toBeLessThan(10_000);
  });

  it("carries only as many pictures as a turn can hold, and says so", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "capture" }],
        callTool: async () => ({
          content: [
            { type: "image", data: "AAAA", mimeType: "image/png" },
            { type: "image", data: "BBBB", mimeType: "image/png" },
            { type: "image", data: "CCCC", mimeType: "image/png" },
          ],
        }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "camera",
      name: "Camera",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const result = await servers.execute("mcp__camera__capture", {});

    if (!result.ok) throw new Error(result.reason);
    expect(result.images?.map((image) => image.data)).toEqual(["AAAA", "BBBB"]);
    expect(JSON.stringify(result.value)).toContain("not shown");
  });

  it("connects an enabled HTTP server and routes its discovered tools", async () => {
    const close = vi.fn(async () => {});
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "Forecast: clear" }],
    }));
    const connection: McpConnection = {
      listTools: async () => [
        {
          name: "weather",
          description: "Read the current forecast.",
          inputSchema: { type: "object" },
        },
      ],
      callTool,
      close,
    };
    const connect = vi.fn<McpConnectionFactory>(async () => connection);
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(directory, connect, new InMemoryMcpCredentials());

    await servers.declare({
      id: "local-weather",
      name: "Local weather",
      url: "http://127.0.0.1:3100/mcp",
      enabled: true,
    });

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "local-weather",
        status: "connected",
        toolCount: 1,
        tools: [
          {
            name: "weather",
            description: "Read the current forecast.",
            enabled: true,
          },
        ],
      }),
    ]);
    const [tool] = await servers.availableTools();
    expect(tool).toMatchObject({
      name: "mcp__local-weather__weather",
      description: "Read the current forecast.",
    });
    expect(await servers.inspect(tool!.name, { city: "Paris" })).toMatchObject({
      ok: true,
      action: "Local weather",
      target: "Local weather",
    });
    expect(await servers.execute(tool!.name, { city: "Paris" })).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "Forecast: clear" }] },
    });
    expect(callTool).toHaveBeenCalledWith("weather", { city: "Paris" });

    expect(await servers.availableTools(undefined, ["local-weather"])).toEqual(
      [],
    );
    await expect(
      servers.inspect(tool!.name, { city: "Paris" }, undefined, [
        "local-weather",
      ]),
    ).resolves.toEqual({
      ok: false,
      reason: "This MCP tool is no longer available.",
    });
    await expect(
      servers.execute(
        tool!.name,
        { city: "Paris" },
        undefined,
        undefined,
        undefined,
        ["local-weather"],
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "This MCP tool is no longer available.",
    });

    await servers.switchTo("local-weather", false);
    expect(close).toHaveBeenCalledOnce();
    expect(await servers.availableTools()).toEqual([]);
  });

  it("reports a failed server's state and tries again when asked or switched back on", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const connect = vi.fn(async () => {
      throw new Error("offline");
    });
    const servers = managed(directory, connect, new InMemoryMcpCredentials());

    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "docs",
        status: "failed",
        reason: "Could not connect to this MCP server.",
      }),
    ]);
    expect(connect).toHaveBeenCalledOnce();

    await servers.retryFailed();
    await servers.manage();
    expect(connect).toHaveBeenCalledTimes(2);

    await servers.switchTo("docs", false);
    await servers.switchTo("docs", true);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("says why a server could not be reached, not only that it could not", async () => {
    const causes: [unknown, string][] = [
      [
        new SdkError(SdkErrorCode.RequestTimeout, "Request timed out"),
        "The server did not answer in time.",
      ],
      [
        new SdkHttpError(SdkErrorCode.ClientHttpForbidden, "Forbidden", {
          status: 503,
        }),
        "The server answered with HTTP 503.",
      ],
      [
        Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ENOTFOUND" },
        }),
        "The server's address could not be found. Check the internet connection.",
      ],
    ];
    for (const [error, sentence] of causes) {
      const servers = managed(
        await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
        async () => {
          throw error;
        },
        new InMemoryMcpCredentials(),
      );
      await servers.declare({
        id: "docs",
        name: "Docs",
        url: "https://example.com/mcp",
        enabled: true,
      });

      expect(await servers.manage()).toEqual([
        expect.objectContaining({
          status: "failed",
          reason: `Could not connect to this MCP server. ${sentence}`,
        }),
      ]);
    }
  });

  it("names the connection that is down when one of its tools is called", async () => {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => {
        throw new SdkError(SdkErrorCode.RequestTimeout, "Request timed out");
      },
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const reason =
      "Docs is not connected. Could not connect to this MCP server. The server did not answer in time. The person can retry it from the plugin's page.";
    expect(await servers.inspect("mcp__docs__lookup", {})).toEqual({
      ok: false,
      reason,
    });
    expect(await servers.execute("mcp__docs__lookup", {})).toEqual({
      ok: false,
      reason,
    });
  });

  it("tries a server that failed again once a short wait has passed, and not before", async () => {
    let clock = 0;
    let reachable = false;
    const connect = vi.fn(async () => {
      if (!reachable) throw new Error("offline");
      return {
        listTools: async () => [
          { name: "lookup", inputSchema: { type: "object" } },
        ],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      };
    });
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      connect,
      new InMemoryMcpCredentials(),
      [],
      () => clock,
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });
    expect(connect).toHaveBeenCalledTimes(1);

    // A blip is not held against the server, but it is not hammered either.
    clock = 5_000;
    reachable = true;
    expect(await servers.availableTools()).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(1);

    clock = 60_000;
    expect(await servers.availableTools()).toEqual([
      expect.objectContaining({ name: "mcp__docs__lookup" }),
    ]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("never retries a refused token on its own", async () => {
    let clock = 0;
    const connect = vi.fn(async () => {
      throw new McpUnauthorizedError("refused");
    });
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      connect,
      new InMemoryMcpCredentials(),
      [],
      () => clock,
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    clock = 10 * 60_000;
    await servers.manage();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects on the next look after a connection is lost during a call, without repeating the call", async () => {
    const close = vi.fn(async () => {});
    let calls = 0;
    const connect = vi.fn(async () => ({
      listTools: async () => [
        { name: "lookup", inputSchema: { type: "object" } },
      ],
      callTool: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection closed");
        return { content: [{ type: "text", text: "found" }] };
      },
      close,
    }));
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      connect,
      new InMemoryMcpCredentials(),
      [],
      () => 0,
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    await expect(servers.execute("mcp__docs__lookup", {})).resolves.toEqual({
      ok: false,
      reason: "The MCP server could not complete this action.",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(calls).toBe(1);

    // No wait: the server answered a moment ago, so it is dialed again.
    await expect(servers.execute("mcp__docs__lookup", {})).resolves.toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "found" }] },
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(calls).toBe(2);
  });

  it("waits before reconnecting when the server is still down after a lost connection", async () => {
    let reachable = true;
    const connect = vi.fn(async () => {
      if (!reachable) throw new Error("offline");
      return {
        listTools: async () => [
          { name: "lookup", inputSchema: { type: "object" } },
        ],
        callTool: async () => {
          throw new Error("connection closed");
        },
        close: async () => {},
      };
    });
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      connect,
      new InMemoryMcpCredentials(),
      [],
      () => 0,
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    await servers.execute("mcp__docs__lookup", {});
    reachable = false;
    expect(await servers.availableTools()).toEqual([]);
    expect(await servers.availableTools()).toEqual([]);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(await servers.states()).toEqual([
      expect.objectContaining({ status: "failed", toolCount: 0 }),
    ]);
  });

  it("sends a saved token as a bearer credential and never writes it down", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer(async (request, response) => {
      seen.push(request.headers.authorization);
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : { tools: [{ name: "search", inputSchema: { type: "object" } }] };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      connectHttpMcpServer,
      new InMemoryMcpCredentials(),
    );
    try {
      await servers.declare({
        id: "search",
        name: "Search",
        url: `http://127.0.0.1:${address.port}/mcp`,
        enabled: false,
      });
      await servers.saveToken("search", "tvly-secret");
      await servers.switchTo("search", true);

      expect((await servers.manage())[0]).toMatchObject({
        status: "connected",
        credential: { status: "saved" },
      });
      expect(seen).toContain("Bearer tvly-secret");

      const saved = await readFile(
        join(directory, "mcp-connections.json"),
        "utf8",
      );
      expect(saved).not.toContain("tvly-secret");
      const inspection = await servers.inspect("mcp__search__search", {});
      expect(JSON.stringify(inspection)).not.toContain("tvly-secret");
    } finally {
      await servers.shutdownAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports a refused sign-in apart from an unreachable server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => {
        throw new McpUnauthorizedError("401");
      },
      new InMemoryMcpCredentials(),
    );

    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        status: "unauthorized",
        reason:
          "This server refused the access token. Save a current token to sign in again.",
        credential: { status: "none" },
      }),
    ]);
  });

  it("withdraws tools and asks for a new token when a call is refused", async () => {
    const close = vi.fn(async () => {});
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "search" }],
        callTool: async () => {
          throw new McpUnauthorizedError("401");
        },
        close,
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp",
      enabled: true,
    });
    await servers.saveToken("search", "expired");

    expect(await servers.execute("mcp__search__search", {})).toEqual({
      ok: false,
      reason:
        "This server refused the access token. Save a current token to sign in again.",
    });
    expect(close).toHaveBeenCalled();
    expect(await servers.availableTools()).toEqual([]);
    expect((await servers.manage())[0]).toMatchObject({
      status: "unauthorized",
      toolCount: 0,
    });
  });

  it("forgets a saved token when the endpoint changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const credentials = new InMemoryMcpCredentials();
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "search" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      credentials,
    );
    const definition = {
      id: "search",
      name: "Search",
      url: "https://first.example/mcp",
      enabled: true,
    };
    await servers.declare(definition);
    await servers.saveToken("search", "issued-for-first");

    await servers.declare({ ...definition, url: "https://second.example/mcp" });

    expect(await credentials.get("search")).toBeUndefined();
    expect((await servers.manage())[0]).toMatchObject({
      credential: { status: "none" },
    });
  });

  it("forgets a saved token when the server is removed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const credentials = new InMemoryMcpCredentials();
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "search" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      credentials,
    );
    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp",
      enabled: true,
    });
    await servers.saveToken("search", "revoke-me");

    await servers.undeclare("search");

    expect(await credentials.get("search")).toBeUndefined();
  });

  it("reconnects after a token is saved and after it is cleared", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const credentials = new InMemoryMcpCredentials();
    const tokens: (string | undefined)[] = [];
    const servers = managed(
      directory,
      async (_definition, token) => {
        tokens.push(await token());
        return {
          listTools: async () => [{ name: "search" }],
          callTool: async () => ({ content: [] }),
          close: async () => {},
        };
      },
      credentials,
    );
    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp",
      enabled: true,
    });
    expect(tokens).toEqual([undefined]);

    await servers.saveToken("search", "fresh");
    expect(tokens).toEqual([undefined, "fresh"]);
    expect((await servers.manage())[0]).toMatchObject({
      status: "connected",
      credential: { status: "saved" },
    });

    await servers.clearToken("search");
    expect(tokens).toEqual([undefined, "fresh", undefined]);
    expect((await servers.manage())[0]).toMatchObject({
      credential: { status: "none" },
    });
  });

  it("reports unreachable secure storage without claiming a token is absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "search" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      {
        get: async () => {
          throw new Error("locked");
        },
        set: async () => {
          throw new Error("locked");
        },
        delete: async () => {
          throw new Error("locked");
        },
      },
    );
    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp",
      enabled: true,
    });

    expect((await servers.manage())[0]).toMatchObject({
      credential: {
        status: "unavailable",
        reason: "Secure storage for access tokens is unavailable.",
      },
    });
    await expect(servers.saveToken("search", "x")).rejects.toThrow(
      "Secure storage for access tokens is unavailable.",
    );
  });

  it("refuses to connect to an endpoint that carries its own credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const connect = vi.fn(async () => ({
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    }));
    const servers = managed(directory, connect, new InMemoryMcpCredentials());

    await servers.declare({
      id: "search",
      name: "Search",
      url: "https://example.com/mcp?tavilyApiKey=tvly-secret",
      enabled: true,
    });

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        status: "failed",
        reason:
          "Use an endpoint without embedded credentials. Save the access token separately.",
      }),
    ]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("offers a built-in connection's tools without any saved definition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => ({
            listTools: async () => [
              { name: "navigate", description: "Go to a page." },
            ],
            callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
            close: async () => {},
          }),
        },
      ],
    );

    const [tool] = await servers.availableTools();
    expect(tool).toMatchObject({
      name: "mcp__browser__navigate",
      description: "Go to a page.",
    });
    expect(await servers.execute("mcp__browser__navigate", {})).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "ok" }] },
    });
    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "browser",
        name: "Zhiyin's browser",
        builtIn: true,
        status: "connected",
        toolCount: 1,
      }),
    ]);
  });

  it("keeps a built-in connection available and reports its actual tool error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const close = vi.fn(async () => {});
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => ({
            listTools: async () => [{ name: "evaluate" }],
            callTool: async () => {
              throw new Error("The page closed before the code could run.");
            },
            close,
          }),
        },
      ],
    );

    await servers.availableTools();
    await expect(
      servers.execute("mcp__browser__evaluate", {}),
    ).resolves.toEqual({
      ok: false,
      reason: "The page closed before the code could run.",
    });
    expect(close).not.toHaveBeenCalled();
    await expect(servers.availableTools()).resolves.toHaveLength(1);
  });

  it("routes a conversation-scoped built-in only through that conversation's connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const opened: string[] = [];
    const closed: string[] = [];
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          scope: "conversation",
          open: async (scope) => {
            if (!scope) throw new Error("missing conversation scope");
            opened.push(scope);
            return {
              listTools: async () => [{ name: "navigate" }],
              callTool: async () => ({
                content: [{ type: "text", text: scope }],
              }),
              close: async () => {
                closed.push(scope);
              },
            };
          },
        },
      ],
    );

    await servers.availableTools("first");
    await servers.availableTools("second");

    expect(opened).toEqual(["first", "second"]);
    expect(
      await servers.execute(
        "mcp__browser__navigate",
        {},
        undefined,
        undefined,
        "first",
      ),
    ).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "first" }] },
    });
    expect(
      await servers.execute(
        "mcp__browser__navigate",
        {},
        undefined,
        undefined,
        "second",
      ),
    ).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "second" }] },
    });
    await servers.shutdownScope("first");
    expect(closed).toEqual(["first"]);
    await servers.availableTools("first");
    expect(opened).toEqual(["first", "second", "first"]);
  });

  it("refuses to declare, configure, or credential a built-in connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [],
        callTool: async () => ({}),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => ({
            listTools: async () => [{ name: "navigate" }],
            callTool: async () => ({}),
            close: async () => {},
          }),
        },
      ],
    );

    // It ships with the application: no package declares it, there is no
    // endpoint to point elsewhere, and no account to sign in to.
    await expect(servers.saveToken("browser", "secret")).rejects.toThrow(
      "built in",
    );
    await expect(
      servers.setToolEnabled("browser", "navigate", false),
    ).rejects.toThrow("built in");
    await expect(
      servers.declare({
        id: "browser",
        name: "Mine",
        url: "https://example.com/mcp",
        enabled: true,
      }),
    ).rejects.toThrow("built in");
  });

  it("reports a built-in that cannot start, without losing the others", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [{ name: "read" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => {
            throw new Error("No supported browser could be started.");
          },
        },
      ],
    );
    await servers.declare({
      id: "docs",
      name: "Docs",
      url: "https://example.com/mcp",
      enabled: true,
    });

    const states = await servers.manage();
    expect(states).toContainEqual(
      expect.objectContaining({ id: "browser", status: "failed" }),
    );
    expect(states).toContainEqual(
      expect.objectContaining({ id: "docs", status: "connected" }),
    );
    // The user's own server still works.
    expect((await servers.availableTools()).map((tool) => tool.name)).toEqual([
      "mcp__docs__read",
    ]);
  });

  it("retries an unscoped built-in that failed once fixed, and asks again next time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    let missing = true;
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "git",
          name: "Git",
          open: async () => {
            if (missing) throw new Error("git.exe was not found.");
            return {
              listTools: async () => [{ name: "git_status" }],
              callTool: async () => ({ content: [] }),
              close: async () => {},
            };
          },
        },
      ],
    );

    expect(await servers.manage()).toContainEqual(
      expect.objectContaining({
        id: "git",
        status: "failed",
        reason: "git.exe was not found.",
      }),
    );

    // Installing git is the fix, and the next check should notice it.
    missing = false;
    expect(await servers.manage()).toContainEqual(
      expect.objectContaining({ id: "git", status: "connected", toolCount: 1 }),
    );
  });

  it("reports a conversation-scoped built-in's tools and readiness without opening a conversation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    const opened: (string | undefined)[] = [];
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          scope: "conversation",
          open: async (scope) => {
            opened.push(scope);
            throw new Error("no conversation is open in this test");
          },
          describe: async () => [
            { name: "navigate", description: "Go to a page." },
          ],
        },
      ],
    );

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "browser",
        builtIn: true,
        status: "connected",
        toolCount: 1,
        tools: [
          { name: "navigate", description: "Go to a page.", enabled: true },
        ],
      }),
    ]);
    // Its general state is known without any conversation's own connection.
    expect(opened).toEqual([]);
  });

  it("reports why a conversation-scoped built-in cannot work here, and asks again next time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    let refusal: string | undefined = "No supported browser could be started.";
    const servers = managed(
      directory,
      async () => {
        throw new Error("no user servers here");
      },
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          scope: "conversation",
          open: async () => {
            throw new Error("no conversation is open in this test");
          },
          describe: async () => {
            if (refusal) throw new Error(refusal);
            return [{ name: "navigate" }];
          },
        },
      ],
    );

    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "browser",
        status: "failed",
        reason: "No supported browser could be started.",
        toolCount: 0,
      }),
    ]);
    // Installing a browser is the fix, and the page should notice it.
    refusal = undefined;
    expect(await servers.manage()).toEqual([
      expect.objectContaining({
        id: "browser",
        status: "connected",
        toolCount: 1,
      }),
    ]);
  });

  it("closes built-in connections when the application shuts down", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zhiyin-mcp-"));
    let closed = false;
    const servers = managed(
      directory,
      async () => ({
        listTools: async () => [],
        callTool: async () => ({}),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
      [
        {
          id: "browser",
          name: "Zhiyin's browser",
          open: async () => ({
            listTools: async () => [{ name: "navigate" }],
            callTool: async () => ({}),
            close: async () => {
              closed = true;
            },
          }),
        },
      ],
    );
    await servers.availableTools();

    await servers.shutdownAll();

    expect(closed).toBe(true);
  });
});

/**
 * A connector is dialed when something needs it — a conversation that may use
 * it, or a person checking it — never just because the app looked at the
 * list. Each look would otherwise reach every service a person has set up.
 */
describe("connectors connect when they are used", () => {
  const search = {
    id: "research/search",
    name: "Search",
    url: "https://search.example/mcp",
    enabled: true,
  };
  const github = {
    id: "engineering/github",
    name: "GitHub",
    url: "https://github.example/mcp",
    enabled: true,
  };

  async function lazy(
    tools: Record<string, McpConnection["listTools"]> = {},
    now?: () => number,
  ) {
    const dialed: string[] = [];
    const servers = new ManagedMcpServers(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async (definition) => {
        dialed.push(definition.id);
        return {
          listTools: tools[definition.id] ?? (async () => [{ name: "lookup" }]),
          callTool: async () => ({ content: [] }),
          close: async () => {},
        };
      },
      new InMemoryMcpCredentials(),
      [],
      async () => [search, github],
      ...(now ? [now] : []),
    );
    return { servers, dialed };
  }

  it("names each connector a conversation waits for, and none it already reached", async () => {
    const { servers } = await lazy();
    const named: string[] = [];

    await servers.availableTools("c-1", [github.id], (name) =>
      named.push(name),
    );
    await servers.availableTools("c-1", [], (name) => named.push(name));

    expect(named).toEqual(["Search", "GitHub"]);
  });

  it("reports a connector nobody has used yet as unchecked, without reaching it", async () => {
    const { servers, dialed } = await lazy();

    expect(await servers.states()).toEqual([
      expect.objectContaining({
        id: search.id,
        status: "unchecked",
        tools: [],
      }),
      expect.objectContaining({
        id: github.id,
        status: "unchecked",
        tools: [],
      }),
    ]);
    expect(dialed).toEqual([]);
  });

  it("reaches only the connectors a conversation may use", async () => {
    const { servers, dialed } = await lazy();

    const tools = await servers.availableTools("first", [github.id]);

    expect(tools.map((tool) => tool.name)).toEqual([
      "mcp__research__search__lookup",
    ]);
    expect(dialed).toEqual([search.id]);
    expect(await servers.states()).toEqual([
      expect.objectContaining({ id: search.id, status: "connected" }),
      expect.objectContaining({ id: github.id, status: "unchecked" }),
    ]);
  });

  it("checks one connector when asked, even one that failed a moment ago", async () => {
    let reachable = false;
    let clock = 1_000;
    const { servers, dialed } = await lazy(
      {
        [search.id]: async () => {
          if (!reachable) throw new Error("offline");
          return [{ name: "lookup" }];
        },
      },
      () => clock,
    );

    expect(await servers.check(search.id)).toMatchObject({
      id: search.id,
      status: "failed",
      checkedAt: 1_000,
    });
    reachable = true;
    clock = 2_000;
    expect(await servers.check(search.id)).toMatchObject({
      id: search.id,
      status: "connected",
      checkedAt: 2_000,
      tools: [{ name: "lookup", enabled: true }],
    });
    expect(dialed).toEqual([search.id, search.id]);
  });
});

/**
 * A remote tool publishes the shape of its input. A call that does not fit it
 * would be refused by the server after a person approved it, so the model is
 * told what is wrong before anyone is asked.
 */
describe("a connector call is checked against the tool's input schema", () => {
  const schema = {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "integer", minimum: 1 },
    },
    required: ["query"],
    additionalProperties: false,
  };

  async function withTool(inputSchema: Record<string, unknown>) {
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [{ name: "search", inputSchema }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "research/search",
      name: "Search",
      url: "https://search.example/mcp",
      enabled: true,
    });
    return servers;
  }

  const tool = "mcp__research__search__search";

  it("refuses a call missing a required argument as one the model can fix", async () => {
    const servers = await withTool(schema);

    expect(await servers.inspect(tool, { max_results: 3 })).toEqual({
      ok: false,
      correctable: true,
      reason:
        "The arguments do not match what search expects: the input must have required property 'query'.",
    });
  });

  it("names every mismatch, not only the first", async () => {
    const servers = await withTool(schema);

    const inspection = await servers.inspect(tool, {
      query: "tides",
      max_results: 0,
      depth: "deep",
    });

    expect(inspection).toMatchObject({ ok: false, correctable: true });
    expect(!inspection.ok && inspection.reason).toContain(
      "must NOT have additional properties",
    );
    expect(!inspection.ok && inspection.reason).toContain(
      "max_results must be >= 1",
    );
  });

  it("asks about a call that fits the schema", async () => {
    const servers = await withTool(schema);

    expect(
      await servers.inspect(tool, { query: "tides", max_results: 3 }),
    ).toMatchObject({ ok: true });
  });

  it("does not refuse a call because the server's own schema cannot be read", async () => {
    const servers = await withTool({
      type: "object",
      properties: { query: { type: "strng" } },
      required: ["query"],
    });

    expect(await servers.inspect(tool, {})).toMatchObject({ ok: true });
  });
});

describe("a connector's tools follow what the server says it offers", () => {
  it("offers the new tools once a connected server says its list changed", async () => {
    let announce: ((tools: readonly McpConnectionTool[]) => void) | undefined;
    const servers = managed(
      await mkdtemp(join(tmpdir(), "zhiyin-mcp-")),
      async () => ({
        listTools: async () => [{ name: "search" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
        onToolsChanged: (listener) => {
          announce = listener;
        },
      }),
      new InMemoryMcpCredentials(),
    );
    await servers.declare({
      id: "research/search",
      name: "Search",
      url: "https://search.example/mcp",
      enabled: true,
    });

    announce?.([{ name: "search" }, { name: "extract" }]);

    expect((await servers.availableTools()).map((tool) => tool.name)).toEqual([
      "mcp__research__search__search",
      "mcp__research__search__extract",
    ]);
  });

  it("hears a tool-list change through the production HTTP adapter", async () => {
    let listed = 0;
    let stream: ServerResponse | undefined;
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        response.flushHeaders();
        stream = response;
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? {
                tools: (++listed > 1 ? ["read", "write"] : ["read"]).map(
                  (name) => ({ name, inputSchema: { type: "object" } }),
                ),
              }
            : {};
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    try {
      const connection = await connectHttpMcpServer(
        {
          id: "fixture",
          name: "Fixture",
          enabled: true,
          url: `http://127.0.0.1:${address.port}/mcp`,
        },
        async () => undefined,
      );
      try {
        const changed = new Promise<readonly McpConnectionTool[]>((resolve) =>
          connection.onToolsChanged?.(resolve),
        );
        expect((await connection.listTools()).map((tool) => tool.name)).toEqual(
          ["read"],
        );
        await vi.waitFor(() => expect(stream).toBeDefined());
        stream!.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`,
        );

        expect((await changed).map((tool) => tool.name)).toEqual([
          "read",
          "write",
        ]);
      } finally {
        await connection.close();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
