import { afterEach, describe, expect, it } from "vitest";
import type { McpServerState } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  InMemoryMcpCredentials,
  ManagedMcpServers,
  type McpConnectionFactory,
  type McpServers,
} from "@zhiyin/mcp";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  calls,
  loopFrom,
  pluginStore,
  pluginView,
  stubDependencies,
  until,
  type TestApp,
} from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
      await folders.make("zhiyin-loop-connectors-"),
      connect,
      new InMemoryMcpCredentials(),
      {
        declared: async () => [
          {
            id: "research/tavily",
            name: "Tavily",
            url: "https://mcp.example.test/mcp",
            enabled: true,
          },
        ],
      },
    ),
    model: {
      ...deps.model,
      send: calls(["activate_plugin", { id: "research" }]),
    },
  });
  const taskId = await agent.createTask();
  return { agent, taskId };
}

/** Waits for what the window would show, however long a slow disk takes. */
function shows(
  agent: TestApp,
  predicate: (app: TestApp) => boolean,
): Promise<void> {
  return until(() => predicate(agent));
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

/** A shipped plugin that offers the conversation's browser, switched on. */
const browsing = {
  ...pluginView({ name: "browsing" }),
  appConnectors: [
    {
      id: "browsing/browser",
      connector: "browser",
      name: "Browser",
      description: "Opens web pages.",
      access: "Opens pages in the conversation's own browser.",
      dataDestination: "The sites it opens.",
      enabled: true,
    },
  ],
};

describe("a built-in connection whose tools follow the chosen model", () => {
  it("offers a conversation the tools of the model chosen since it was first listed", async () => {
    let seeing = false;
    let asked = 0;
    const offered: string[][] = [];
    const deps = stubDependencies(() => {});
    const agent = loopFrom({
      ...deps,
      plugins: pluginStore([browsing]),
      mcp: new ManagedMcpServers(
        await folders.make("zhiyin-loop-connectors-"),
        async () => {
          throw new Error("no user servers here");
        },
        new InMemoryMcpCredentials(),
        {
          builtIns: [
            {
              id: "browser",
              name: "Zhiyin's browser",
              scope: "conversation",
              // A screenshot only for a model that can see it, as the
              // browser offers it.
              open: async () => ({
                listTools: async () => [
                  { name: "navigate" },
                  ...(agent.settings.current()?.acceptsImages
                    ? [{ name: "screenshot" }]
                    : []),
                ],
                callTool: async () => ({ content: [] }),
                close: async () => {},
              }),
            },
          ],
        },
      ),
      model: {
        ...deps.model,
        settings: async () => ({
          ...(await deps.model.settings()),
          acceptsImages: seeing,
        }),
        send: async function* (request: ModelRequest) {
          asked += 1;
          if (asked === 1)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "call-1",
              name: "activate_plugin",
              argumentsDelta: JSON.stringify({ id: "browsing" }),
            };
          else {
            offered.push((request.tools ?? []).map((tool) => tool.name));
            yield { kind: "textDelta" as const, text: "Done." };
          }
          yield { kind: "done" as const };
        },
      },
    });
    await agent.settings.refresh();
    const taskId = await agent.createTask();
    await agent.start(taskId, "Open the page");
    expect(offered.at(-1)).toContain("mcp__browser__navigate");
    expect(offered.at(-1)).not.toContain("mcp__browser__screenshot");

    seeing = true;
    await agent.settings.refresh();
    await agent.start(taskId, "And show me it");

    expect(offered.at(-1)).toContain("mcp__browser__screenshot");
  });
});
