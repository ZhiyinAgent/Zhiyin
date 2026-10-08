import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerState } from "@zhiyin/contract";
import {
  InMemoryMcpCredentials,
  ManagedMcpServers,
  type McpConnectionFactory,
  type McpServers,
} from "@zhiyin/mcp";
import {
  calls,
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
  type TestApp,
} from "./support.js";

/** A shipped plugin with one remote connector, switched on. */
const research = {
  ...pluginView({ name: "research" }),
  mcpServers: [
    {
      id: "research/tavily",
      name: "Tavily",
      description: "Searches the web.",
      type: "streamable-http" as const,
      url: "https://mcp.example.test/mcp",
      access: "Reads public web pages.",
      dataDestination: "Tavily",
      enabled: true,
    },
  ],
};

/** A conversation whose model activates the plugin, then answers. */
async function activatingResearch(connect: McpConnectionFactory) {
  const deps = stubDependencies(() => {});
  const agent = loopFrom({
    ...deps,
    plugins: pluginStore([research]),
    mcp: new ManagedMcpServers(
      await mkdtemp(join(tmpdir(), "zhiyin-loop-connectors-")),
      connect,
      new InMemoryMcpCredentials(),
      [],
      async () => [
        {
          id: "research/tavily",
          name: "Tavily",
          url: "https://mcp.example.test/mcp",
          enabled: true,
        },
      ],
    ),
    model: {
      ...deps.model,
      send: calls(["activate_plugin", { id: "research" }]),
    },
  });
  const taskId = await agent.createTask();
  return { agent, taskId };
}

/** Waits for what the window would show, as long as a slow disk needs. */
async function shows(agent: TestApp, predicate: (app: TestApp) => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate(agent)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The window never showed it.");
}

const tavily = (agent: TestApp) =>
  agent.snapshot().mcpServers.find((server) => server.id === "research/tavily");

describe("a connector a conversation reaches", () => {
  it("names the connector on the turn while the turn waits for it", async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const { agent, taskId } = await activatingResearch(async () => {
      await answered;
      return {
        listTools: async () => [{ name: "search" }],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      };
    });

    const running = agent.start(taskId, "Search for something");
    await shows(agent, (app) => {
      const phase = app.snapshot().tasks[0]?.phase;
      return (
        phase?.kind === "working" && phase.note === "Connecting to Tavily…"
      );
    });
    answer();
    await running;

    expect(agent.snapshot().tasks[0]?.phase.kind).toBe("completed");
  });

  it("shows on the plugin page how the connector answered, with no other action", async () => {
    const { agent, taskId } = await activatingResearch(async () => {
      throw new Error("refused");
    });

    await agent.start(taskId, "Search for something");

    expect(tavily(agent)).toMatchObject({ status: "failed" });
  });

  it("shows a connector that connected as connected", async () => {
    const { agent, taskId } = await activatingResearch(async () => ({
      listTools: async () => [{ name: "search" }],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    }));

    await agent.start(taskId, "Search for something");

    expect(tavily(agent)).toMatchObject({ status: "connected", toolCount: 1 });
  });
});

/** A connector whose service has the standard sign-in, as last seen. */
const trackerState = (signedIn: boolean): McpServerState => ({
  id: "research/tavily",
  name: "Tavily",
  url: "https://mcp.example.test/mcp",
  enabled: true,
  status: signedIn ? "connected" : "unauthorized",
  toolCount: signedIn ? 1 : 0,
  tools: signedIn ? [{ name: "search", enabled: true }] : [],
  credential: { status: signedIn ? "signed-in" : "none" },
  signIn: true,
});

function signingInTo(signIn: McpServers["signIn"]) {
  let signedIn = false;
  const deps = stubDependencies(() => {});
  const agent = loopFrom({
    ...deps,
    plugins: pluginStore([research]),
    mcp: {
      ...deps.mcp,
      states: async () => [trackerState(signedIn)],
      manage: async () => [trackerState(signedIn)],
      signIn: async (id, signal) => {
        const outcome = await signIn(id, signal);
        signedIn = outcome.status === "signed-in";
        return outcome;
      },
    },
  });
  return agent;
}

describe("signing in to a connector", () => {
  it("shows the connector signed in once the person has signed in", async () => {
    const agent = signingInTo(async () => ({ status: "signed-in" }));

    expect(await agent.connections.signIn("research/tavily")).toEqual({
      status: "signed-in",
    });
    expect(tavily(agent)).toMatchObject({
      status: "connected",
      credential: { status: "signed-in" },
    });
  });

  it("ends a sign-in still waiting in the browser when the person cancels it", async () => {
    const agent = signingInTo(
      (_id, signal) =>
        new Promise((resolve) =>
          signal?.addEventListener("abort", () =>
            resolve({ status: "cancelled" }),
          ),
        ),
    );

    const signingIn = agent.connections.signIn("research/tavily");
    await agent.connections.cancelSignIn("research/tavily");

    expect(await signingIn).toEqual({ status: "cancelled" });
  });
});
