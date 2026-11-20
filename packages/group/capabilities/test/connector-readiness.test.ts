import { afterEach, describe, expect, it } from "vitest";
import type { McpServerState, ToolchainState } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { fakeMcp } from "@zhiyin/mcp/testing";
import { describeBrowserAutomation } from "@zhiyin/interactive-browser";
import { InMemoryMcpCredentials, ManagedMcpServers } from "@zhiyin/mcp";
import { pluginStore } from "@zhiyin/plugins/testing";
import type { PluginView } from "@zhiyin/plugins";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
} from "../src/index.js";
import { fakeMembers } from "./fakes.js";

/**
 * What the plugin directory says each connector needs, read from the
 * connection feature itself: a connector's declaration, its saved key, its
 * own switch, and what a built-in found of this computer. The far end of a
 * connection is stood in for, and never reached by a look.
 */

const noBrowser =
  "No supported browser is installed. Tried Microsoft Edge and Google Chrome.";

function engineering(enabled = true): PluginView {
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "engineering",
      version: "1.0.0",
      description: "Build and review software.",
      author: { name: "Zhiyin" },
      displayName: "Engineering",
      category: "Development",
      defaultPrompts: [],
    },
    provenance: { source: "built-in", sourceId: "shipped" },
    enabled,
    editing: "override",
    skills: [],
    specialists: [],
    mcpServers: [
      {
        id: "engineering/github",
        name: "GitHub",
        description: "Repositories, issues, and pull requests.",
        type: "streamable-http",
        url: "https://api.githubcopilot.com/mcp/",
        access: "Needs a GitHub token.",
        dataDestination: "api.githubcopilot.com",
        enabled: true,
      },
    ],
    appConnectors: [
      {
        id: "engineering/browser",
        connector: "browser",
        name: "Browser",
        description: "Opens pages to test them.",
        access: "An app-owned browser window.",
        dataDestination: "The sites it opens.",
        enabled: true,
      },
    ],
  };
}

function research(enabled = true): PluginView {
  return {
    ...engineering(enabled),
    manifest: {
      ...engineering().manifest,
      name: "research",
      displayName: "Research",
      description: "Find and verify sources.",
    },
    mcpServers: [
      {
        id: "research/tavily",
        name: "Tavily",
        description: "Searches the web.",
        type: "streamable-http",
        url: "https://mcp.tavily.com/mcp/",
        access: "Needs an API key.",
        dataDestination: "mcp.tavily.com",
        setup: {
          url: "https://app.tavily.com/home",
          keyName: "API key",
          advice: "Sign in, then copy your API key from the dashboard.",
        },
        enabled: true,
      },
    ],
    appConnectors: [],
  };
}

describe("what the directory says each connector needs", () => {
  const folders = new TemporaryFolders();
  afterEach(() => folders.removeAll());

  async function composed(
    views: readonly PluginView[],
    browser: "installed" | "missing" = "installed",
  ) {
    const plugins = pluginStore(views);
    const dialled: string[] = [];
    const mcp = new ManagedMcpServers(
      await folders.make("zhiyin-readiness-"),
      async (definition) => {
        dialled.push(definition.id);
        return {
          listTools: async () => [],
          callTool: async () => ({ content: [] }),
          close: async () => {},
        };
      },
      new InMemoryMcpCredentials(),
      {
        declared: () => declaredConnectionsOf(plugins),
        builtIns: [
          browserConnection(
            () => {
              throw new Error("No conversation's browser is opened here.");
            },
            () =>
              describeBrowserAutomation(
                {
                  available: async () =>
                    browser === "installed"
                      ? { available: true, browserName: "Microsoft Edge" }
                      : { available: false, reason: noBrowser },
                  launch: async () => {
                    throw new Error("Nothing is launched by a look.");
                  },
                },
                { workspacePreview: true },
              ),
          ),
        ],
      },
    );
    const capabilities = new ComposedCapabilities({
      ...fakeMembers(),
      mcp,
      plugins,
    });
    const directory = async () => {
      const gathered = await capabilities.toolsFor("conversation-1", {
        skills: false,
      });
      if (!gathered.ok) throw new Error(gathered.reason);
      return gathered.value.pluginDirectory;
    };
    return { capabilities, plugins, mcp, dialled, directory };
  }

  it("marks Tavily as needing a key while none is saved, without reaching it", async () => {
    const { directory, dialled, mcp } = await composed([research()]);
    try {
      expect(await directory()).toEqual([
        {
          id: "research",
          name: "Research",
          purpose: "Find and verify sources.",
          includes: {
            skills: [],
            specialists: [],
            connectors: ["Tavily — Searches the web."],
            toolkits: ["toolkit:research/tavily"],
          },
          needs: { "research/tavily": "key" },
        },
      ]);
      expect(dialled).toEqual([]);
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("marks Research as switched off and Tavily as needing a key, so both are said at once", async () => {
    const { directory, mcp } = await composed([research(false)]);
    try {
      expect(await directory()).toEqual([
        expect.objectContaining({
          id: "research",
          needs: { "research/tavily": "key" },
          switchedOff: true,
        }),
      ]);
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("marks nothing on a connector whose key is saved, its plugin switched off or not", async () => {
    const { directory, plugins, mcp } = await composed([research()]);
    try {
      await mcp.saveToken("research/tavily", "tvly-key");
      expect((await directory())[0]?.needs).toBeUndefined();

      await plugins.setEnabled("research", false);

      expect(await directory()).toEqual([
        expect.objectContaining({ id: "research", switchedOff: true }),
      ]);
      expect((await directory())[0]?.needs).toBeUndefined();
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("lists a connector the person switched off on its own, marked as switched off", async () => {
    const githubOff = engineering();
    const { directory, mcp } = await composed([
      {
        ...githubOff,
        mcpServers: githubOff.mcpServers.map((server) => ({
          ...server,
          enabled: false,
        })),
      },
    ]);
    try {
      expect(await directory()).toEqual([
        expect.objectContaining({
          includes: expect.objectContaining({
            connectors: [
              "GitHub — Repositories, issues, and pull requests.",
              "Browser — Opens pages to test them.",
            ],
          }),
          needs: { "engineering/github": "switched-off" },
        }),
      ]);
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("marks the browser as needing a program installed when neither Edge nor Chrome is on this computer", async () => {
    const { directory, mcp } = await composed([engineering()], "missing");
    try {
      expect((await directory())[0]?.needs).toEqual({
        "engineering/browser": "install",
      });
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("marks nothing on a browser that can start, and on a connector not reached yet that needs no key", async () => {
    const { directory, mcp } = await composed([engineering()]);
    try {
      expect((await directory())[0]?.needs).toBeUndefined();
    } finally {
      await mcp.shutdownAll();
    }
  });
});

describe("the card that asks the person to set a connector up", () => {
  const folders = new TemporaryFolders();
  afterEach(() => folders.removeAll());

  async function capabilitiesOver(views: readonly PluginView[]) {
    const plugins = pluginStore(views);
    const mcp = new ManagedMcpServers(
      await folders.make("zhiyin-setup-card-"),
      async () => ({
        listTools: async () => [],
        callTool: async () => ({ content: [] }),
        close: async () => {},
      }),
      new InMemoryMcpCredentials(),
      { declared: () => declaredConnectionsOf(plugins) },
    );
    return {
      mcp,
      plugins,
      capabilities: new ComposedCapabilities({
        ...fakeMembers(),
        mcp,
        plugins,
      }),
    };
  }

  it("names the connector, its key as its package states it, and the plugin whose page it is set up on", async () => {
    const { capabilities, mcp } = await capabilitiesOver([research(false)]);
    try {
      expect(await capabilities.connectorSetup("research/tavily")).toEqual({
        plugin: { id: "research", name: "Research", switchedOff: true },
        connector: {
          id: "research/tavily",
          name: "Tavily",
          needs: "key",
          setup: {
            url: "https://app.tavily.com/home",
            keyName: "API key",
            advice: "Sign in, then copy your API key from the dashboard.",
          },
        },
      });
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("asks only for the plugin to be switched on when it is given the plugin's id", async () => {
    const { capabilities, mcp } = await capabilitiesOver([research(false)]);
    try {
      expect(await capabilities.connectorSetup("research")).toEqual({
        plugin: { id: "research", name: "Research", switchedOff: true },
      });
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("has nothing to show for a connector that is ready, a plugin switched on, or an id nothing has", async () => {
    const { capabilities, mcp } = await capabilitiesOver([research()]);
    try {
      await mcp.saveToken("research/tavily", "tvly-key");

      expect(await capabilities.connectorSetup("research/tavily")).toBe(
        undefined,
      );
      expect(await capabilities.connectorSetup("research")).toBe(undefined);
      expect(await capabilities.connectorSetup("research/nothing")).toBe(
        undefined,
      );
    } finally {
      await mcp.shutdownAll();
    }
  });
});

describe("each need, from what a connection last answered", () => {
  /** A connection's last answer, as the connection feature reports it. */
  function last(
    id: string,
    overrides: Partial<McpServerState> = {},
  ): McpServerState {
    return {
      id,
      name: id,
      url: "",
      enabled: true,
      status: "unchecked",
      toolCount: 0,
      tools: [],
      credential: { status: "none" },
      ...overrides,
    } as McpServerState;
  }

  async function needs(
    views: readonly PluginView[],
    states: readonly McpServerState[],
    program: ToolchainState = { status: "ready" },
  ) {
    const capabilities = new ComposedCapabilities({
      ...fakeMembers(),
      mcp: { ...fakeMcp(), states: async () => states },
      plugins: pluginStore(views),
      connectionToolchains: { browser: ["chromium"] },
      toolchains: {
        state: async () => program,
        install: async () => {},
        executable: async () => undefined,
      },
    });
    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: false,
    });
    if (!gathered.ok) throw new Error(gathered.reason);
    return gathered.value.pluginDirectory.map((entry) => entry.needs);
  }

  const github = "engineering/github";
  const browser = (overrides: Partial<McpServerState> = {}) =>
    last("browser", { builtIn: true, status: "connected", ...overrides });

  it("asks for a sign-in from a service that refused and offers one, and for a key from one that does not", async () => {
    expect(
      await needs(
        [engineering()],
        [last(github, { status: "unauthorized", signIn: true }), browser()],
      ),
    ).toEqual([{ [github]: "sign-in" }]);
    expect(
      await needs(
        [engineering()],
        [last(github, { status: "unauthorized" }), browser()],
      ),
    ).toEqual([{ [github]: "key" }]);
  });

  it("says a connector that failed, or whose key cannot be read, could not start; not one of a plugin switched off", async () => {
    expect(
      await needs(
        [engineering()],
        [last(github, { status: "failed", reason: "Timed out." }), browser()],
      ),
    ).toEqual([{ [github]: "could-not-start" }]);
    expect(
      await needs(
        [engineering()],
        [
          last(github, {
            credential: {
              status: "unavailable",
              reason: "Secure storage for access tokens is unavailable.",
            },
          }),
          browser(),
        ],
      ),
    ).toEqual([{ [github]: "could-not-start" }]);
    expect(
      await needs(
        [engineering(false)],
        [last(github, { status: "failed", reason: "Timed out." }), browser()],
      ),
    ).toEqual([undefined]);
  });

  it("asks for an install when an application connector's program is missing or failed to install, and for nothing while it installs", async () => {
    const states = [last(github), browser({ status: "disconnected" })];
    expect(
      await needs([engineering()], states, {
        status: "missing",
        downloads: [
          { name: "Chromium", version: "1", bytes: 1, sources: ["example"] },
        ],
      }),
    ).toEqual([{ "engineering/browser": "install" }]);
    expect(
      await needs([engineering()], states, {
        status: "failed",
        reason: "The download was cut off.",
      }),
    ).toEqual([{ "engineering/browser": "install" }]);
    expect(
      await needs([engineering()], states, { status: "installing" }),
    ).toEqual([undefined]);
  });
});
