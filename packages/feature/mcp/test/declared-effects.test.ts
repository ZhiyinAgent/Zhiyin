import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { InMemoryMcpCredentials } from "../src/index.js";
import { managed } from "./declarations.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const remote = (
  sends: "service" | "chosen",
  actsAsPerson: "none" | "once" | "for-good",
) =>
  ({
    reads: "none",
    changes: "none",
    sends,
    actsAsPerson,
    runs: "none",
    lasting: false,
    brings: "outside",
  }) as const;

async function connected(toolEffects?: unknown) {
  const servers = managed(
    await folders.make("zhiyin-mcp-"),
    async () => ({
      listTools: async () => [
        { name: "search" },
        { name: "extract" },
        { name: "comment" },
        { name: "merge" },
        { name: "unknown" },
      ],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    }),
    new InMemoryMcpCredentials(),
  );
  await servers.declare({
    id: "engineering/service",
    name: "Service",
    url: "https://service.example/mcp",
    enabled: true,
    ...(toolEffects ? { toolEffects } : {}),
  } as Parameters<typeof servers.declare>[0]);
  return servers;
}

const declared = [
  { tools: ["search"], effects: remote("service", "none") },
  {
    tools: ["extract"],
    effects: remote("chosen", "none"),
    destination: "{urls}",
  },
  {
    tools: ["comment"],
    effects: remote("service", "once"),
    destination: "{owner}/{repo}",
  },
  { tools: ["merge"], effects: remote("service", "for-good") },
];

describe("the tools a declaration of what they do offers a read-only specialist", () => {
  it("are those that change nothing and act as no one, unless the declaration says why not", async () => {
    const servers = await connected([
      ...declared.filter((group) => !group.tools.includes("search")),
      {
        tools: ["search"],
        effects: remote("service", "none"),
        notReadOnly: "It reads the person's own library.",
      },
    ]);
    const plain = await connected(declared);

    const access = async (from: typeof servers) =>
      Object.fromEntries(
        (await from.availableTools()).map((tool) => [tool.name, tool.access]),
      );

    expect(await access(plain)).toEqual({
      mcp__engineering__service__search: "read",
      mcp__engineering__service__extract: "read",
      mcp__engineering__service__comment: undefined,
      mcp__engineering__service__merge: undefined,
      mcp__engineering__service__unknown: undefined,
    });
    expect(await access(servers)).toMatchObject({
      mcp__engineering__service__search: undefined,
      mcp__engineering__service__extract: "read",
    });
  });
});

describe("a call to a connection whose declaration says what its tools do", () => {
  it("carries what the declaration says the tool does, as said by a connection Zhiyin ships", async () => {
    const servers = await connected(declared);

    const inspected = await servers.inspect(
      "mcp__engineering__service__search",
      {
        query: "rate limits",
      },
    );

    expect(inspected).toMatchObject({
      ok: true,
      effectsDeclaredByZhiyin: true,
    });
    expect(inspected.ok && inspected.effects).toEqual(
      remote("service", "none"),
    );
  });

  it("names where an action lands from the call's own arguments", async () => {
    const servers = await connected(declared);

    const inspected = await servers.inspect(
      "mcp__engineering__service__comment",
      { owner: "octo", repo: "hello", body: "Thanks!" },
    );

    expect(inspected.ok && inspected.effects).toEqual({
      ...remote("service", "once"),
      destination: "octo/hello",
    });
  });

  it("sends the call to the server, and leaves the place it acts on to its effects", async () => {
    const servers = await connected(declared);

    const inspected = await servers.inspect(
      "mcp__engineering__service__comment",
      { owner: "octo", repo: "hello", body: "Thanks!" },
    );

    expect(inspected.ok && inspected.destinations).toEqual([
      "https://service.example/mcp",
    ]);
    expect(inspected.ok && inspected.effects?.destination).toBe("octo/hello");
  });

  it("names the one address a call sends to, and none for a call that sends to several", async () => {
    const servers = await connected(declared);

    const one = await servers.inspect("mcp__engineering__service__extract", {
      urls: ["https://example.com/a"],
    });
    const several = await servers.inspect(
      "mcp__engineering__service__extract",
      { urls: ["https://example.com/a", "https://example.com/b"] },
    );

    expect(one.ok && one.effects).toEqual({
      ...remote("chosen", "none"),
      destination: "https://example.com/a",
    });
    expect(several.ok && several.effects).toEqual(remote("chosen", "none"));
  });

  it("keeps an action as the person that does not name where it lands as what it is, with no place", async () => {
    const servers = await connected(declared);

    const inspected = await servers.inspect(
      "mcp__engineering__service__comment",
      { owner: "octo", body: "Thanks!" },
    );

    expect(inspected.ok && inspected.effects).toEqual(
      remote("service", "once"),
    );
  });

  it("says nothing of a tool the declaration does not name, so it is asked about as before", async () => {
    const servers = await connected(declared);

    const inspected = await servers.inspect(
      "mcp__engineering__service__unknown",
      {},
    );

    expect(inspected).toMatchObject({ ok: true });
    expect(inspected).not.toHaveProperty("effects");
    expect(inspected).not.toHaveProperty("effectsDeclaredByZhiyin");
  });

  it("says nothing of any tool of a connection whose declaration says nothing of them", async () => {
    const servers = await connected();

    for (const tool of ["search", "comment", "merge"]) {
      const inspected = await servers.inspect(
        `mcp__engineering__service__${tool}`,
        { owner: "octo", repo: "hello" },
      );
      expect(inspected).toMatchObject({ ok: true });
      expect(inspected).not.toHaveProperty("effects");
      expect(inspected).not.toHaveProperty("effectsDeclaredByZhiyin");
    }
  });

  it("forgets what a declaration said once it no longer says it", async () => {
    const servers = await connected(declared);
    await servers.declare({
      id: "engineering/service",
      name: "Service",
      url: "https://service.example/mcp",
      enabled: true,
    });

    const inspected = await servers.inspect(
      "mcp__engineering__service__search",
      {},
    );

    expect(inspected).not.toHaveProperty("effects");
    expect(inspected).not.toHaveProperty("effectsDeclaredByZhiyin");
  });
});
