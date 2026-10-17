import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CommandFileChanges,
  McpCredentialState,
  McpServerState,
  OfferedConnection,
  ToolchainState,
  ToolSpec,
} from "@zhiyin/contract";
import {
  InMemoryMcpCredentials,
  ManagedMcpServers,
  type McpServers,
} from "@zhiyin/mcp";
import type { DamagedPlugin, PluginView, Plugins } from "@zhiyin/plugins";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  unreadablePackagesOf,
  gitConnection,
  sceneConnection,
  type CapabilityMembers,
} from "../src/index.js";

const spec = (name: string): ToolSpec => ({
  name,
  description: `The ${name} tool.`,
  inputSchema: { type: "object" },
});

function engineering(overrides: Partial<PluginView> = {}): PluginView {
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "software-engineering",
      version: "1.0.0",
      description: "Build and review software.",
      author: { name: "Zhiyin" },
      displayName: "Software Engineering",
      category: "Development",
      defaultPrompts: ["Review this project."],
      accessSummary: "Uses approved project files.",
      dataDestination: "No additional service.",
    },
    provenance: { source: "built-in", sourceId: "shipped" },
    enabled: true,
    editing: "override",
    skills: [
      {
        id: "software-engineering/test-first",
        name: "test-first",
        description: "Write the failing test first.",
        instructions: "Start from a failing test.",
        enabled: true,
      },
    ],
    specialists: [
      {
        id: "software-engineering/code-reviewer",
        name: "Code reviewer",
        description: "Reviews a change.",
        instructions: "Review behavior and regressions.",
        enabled: true,
      },
    ],
    mcpServers: [
      {
        id: "software-engineering/github",
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
        id: "software-engineering/browser",
        connector: "browser",
        name: "Browser",
        description: "Opens pages to test them.",
        access: "An app-owned browser window.",
        dataDestination: "The sites it opens.",
        enabled: true,
      },
    ],
    ...overrides,
  };
}

function research(): PluginView {
  return {
    ...engineering(),
    manifest: {
      ...engineering().manifest,
      name: "deep-research",
      displayName: "Deep Research",
      description: "Find and verify sources.",
    },
    skills: [
      {
        id: "deep-research/triangulate",
        name: "triangulate",
        description: "Cross-check claims.",
        instructions: "Find three sources.",
        enabled: true,
      },
    ],
    specialists: [],
    mcpServers: [
      {
        id: "deep-research/tavily",
        name: "Tavily",
        description: "Searches the web.",
        type: "streamable-http",
        url: "https://mcp.tavily.com/mcp/",
        access: "Needs an API key.",
        dataDestination: "mcp.tavily.com",
        requestsPerMinute: 100,
        setup: {
          url: "https://app.tavily.com/home",
          keyName: "API key",
        },
        enabled: true,
      },
    ],
    appConnectors: [],
  };
}

/** A plugin list held in memory, applying switches the way the real one does. */
function pluginsHolding(
  initial: readonly PluginView[],
  asked: unknown[][],
  damaged: readonly DamagedPlugin[] = [],
): Plugins {
  let views = [...initial];
  const refuse = async (): Promise<never> => {
    throw new Error("not used here");
  };
  return {
    list: async () => views,
    damaged: async () => damaged,
    builtInNames: async () =>
      views
        .filter((view) => view.provenance.source === "built-in")
        .map((view) => view.manifest.name),
    setEnabled: async (name, enabled) => {
      asked.push(["plugins.setEnabled", name, enabled]);
      views = views.map((view) =>
        view.manifest.name === name ? { ...view, enabled } : view,
      );
    },
    setComponentEnabled: async (id, enabled) => {
      asked.push(["plugins.setComponentEnabled", id, enabled]);
      const flip = <T extends { id: string; enabled: boolean }>(item: T) =>
        item.id === id ? { ...item, enabled } : item;
      views = views.map((view) => ({
        ...view,
        skills: view.skills.map(flip),
        specialists: view.specialists.map(flip),
        mcpServers: view.mcpServers.map(flip),
        appConnectors: view.appConnectors.map(flip),
      }));
    },
    overrideComponent: async (id, content) => {
      asked.push(["plugins.overrideComponent", id, content]);
    },
    resetComponent: async (id) => {
      asked.push(["plugins.resetComponent", id]);
    },
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: async (name) => {
      asked.push(["plugins.remove", name]);
    },
    create: refuse,
    saveContents: refuse,
  };
}

function connection(
  id: string,
  overrides: Partial<McpServerState> = {},
): McpServerState {
  return {
    id,
    name: id,
    url: "",
    enabled: true,
    status: "connected",
    toolCount: 1,
    credential: { status: "none" },
    ...overrides,
  } as McpServerState;
}

/**
 * Members that answer plainly and write down what was asked of them, so a test
 * can see which member a request reached and with what.
 */
function membersRecording(
  options: {
    readonly views?: readonly PluginView[];
    readonly overrides?: Partial<CapabilityMembers>;
    readonly connections?: readonly McpServerState[];
  } = {},
) {
  const asked: unknown[][] = [];
  const note =
    (...name: unknown[]) =>
    async (...args: unknown[]) => {
      asked.push([...name, ...args]);
    };
  const mcp: McpServers = {
    manage: async () => {
      asked.push(["mcp.manage"]);
      return options.connections ?? [connection("browser", { builtIn: true })];
    },
    states: async () =>
      options.connections ?? [connection("browser", { builtIn: true })],
    check: async (id) => {
      asked.push(["mcp.check", id]);
      return connection(id, { status: "connected" });
    },
    retryFailed: note("mcp.retryFailed"),
    builtInIds: () => ["browser", "git"],
    setToolEnabled: note("mcp.setToolEnabled"),
    test: async () => ({ ok: true, tools: [] }),
    saveToken: note("mcp.saveToken"),
    clearToken: note("mcp.clearToken"),
    signIn: async () => ({ status: "failed", reason: "stub" }),
    availableTools: async (scope, excluded) => {
      asked.push(["mcp.availableTools", scope, excluded]);
      return [spec("mcp__software-engineering__github__search")];
    },
    inspect: async (name, _args, scope, excluded) => {
      asked.push(["mcp.inspect", name, scope, excluded]);
      return {
        ok: true,
        action: `Connection ${name}`,
        target: scope ?? "no conversation",
        command: name,
      };
    },
    execute: async (name, _args, options = {}) => {
      const { expectedIdentity: identity, scope, excludedServerIds } = options;
      asked.push(["mcp.execute", name, scope, excludedServerIds]);
      return { ok: true, value: { name, identity, scope } };
    },
    shutdownScope: note("mcp.shutdownScope"),
    shutdownAll: note("mcp.shutdownAll"),
  };
  const members: CapabilityMembers = {
    tools: {
      list: () => [spec("read_file")],
      inspect: async (name) => ({
        ok: true,
        action: `Built-in ${name}`,
        target: "notes.md",
        command: name,
      }),
      execute: async (name, _args, _signal, conversationId) => {
        asked.push(["tools.execute", name, conversationId]);
        return { ok: true, value: `built-in ${name}` };
      },
    },
    mcp,
    browsers: {
      browser: () => {
        throw new Error("This group never drives a browser.");
      },
      close: note("browsers.close"),
      forget: note("browsers.forget"),
      closeAll: note("browsers.closeAll"),
    },
    plugins: pluginsHolding(
      options.views ?? [engineering(), research()],
      asked,
    ),
    toolchains: {
      state: async () => ({ status: "ready", version: "1" }),
      install: note("toolchains.install"),
      executable: async () => undefined,
    },
    connectionToolchains: {},
    ...options.overrides,
  };
  return { asked, capabilities: new ComposedCapabilities(members), members };
}

const everythingButGithubAndBrowser = ["deep-research/tavily", "git"];

describe("tools offered to a conversation", () => {
  it("offers the directory, not a plugin's components, before any plugin is activated", async () => {
    const { capabilities, asked } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.tools.map((tool) => tool.name)).toEqual([
      "read_file",
      "mcp__software-engineering__github__search",
      "inspect_plugin",
    ]);
    expect(gathered.value.skills).toEqual([]);
    expect(gathered.value.specialists).toEqual([]);
    expect(gathered.value.pluginDirectory).toEqual([
      {
        id: "software-engineering",
        name: "Software Engineering",
        purpose: "Build and review software.",
        includes: {
          skills: ["test-first"],
          specialists: ["Code reviewer"],
          connectors: [
            "GitHub — Repositories, issues, and pull requests.",
            "Browser — Opens pages to test them.",
          ],
        },
        activated: false,
      },
      {
        id: "deep-research",
        name: "Deep Research",
        purpose: "Find and verify sources.",
        includes: {
          skills: ["triangulate"],
          specialists: [],
          connectors: ["Tavily — Searches the web."],
        },
        activated: false,
      },
    ]);
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
  });

  it("adds exactly an activated plugin's skills, specialists and connectors, and names who answers for each", async () => {
    const { capabilities, asked } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.skills.map((skill) => skill.id)).toEqual([
      "software-engineering/test-first",
    ]);
    expect(gathered.value.specialists).toEqual([
      expect.objectContaining({
        id: "software-engineering/code-reviewer",
        provenance: { source: "plugin", pluginId: "software-engineering" },
      }),
    ]);
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      everythingButGithubAndBrowser,
    ]);
    expect(gathered.value.ownerOf("read_file")).toBe("built-in");
    expect(
      gathered.value.ownerOf("mcp__software-engineering__github__search"),
    ).toBe("mcp");
    expect(gathered.value.ownerOf("load_skill")).toBe("skill");
    expect(gathered.value.ownerOf("inspect_plugin")).toBe("plugin");
    expect(gathered.value.ownerOf("something_nobody_offered")).toBeUndefined();
  });

  it("offers nothing of a component a person switched off, even in an activated plugin", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.setComponentEnabled(
      "software-engineering/test-first",
      false,
    );
    await capabilities.setComponentEnabled(
      "software-engineering/code-reviewer",
      false,
    );
    await capabilities.setComponentEnabled(
      "software-engineering/browser",
      false,
    );

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.skills).toEqual([]);
    expect(gathered.value.specialists).toEqual([]);
    expect(gathered.value.ownerOf("load_skill")).toBeUndefined();
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      ["deep-research/tavily", "browser", "git"],
    ]);
  });

  it("withdraws everything of a plugin that is switched off, even once activated", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.setPluginEnabled("software-engineering", false);

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.skills).toEqual([]);
    expect(gathered.value.specialists).toEqual([]);
    expect(gathered.value.pluginDirectory.map((entry) => entry.id)).toEqual([
      "deep-research",
    ]);
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
  });

  it("offers no skill loading when skills are unavailable", async () => {
    const { capabilities } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: false,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.ownerOf("load_skill")).toBeUndefined();
    expect(gathered.value.skills).toEqual([]);
  });

  it("refuses a connection tool that reuses a built-in tool's name", async () => {
    const { members } = membersRecording();
    const capabilities = new ComposedCapabilities({
      ...members,
      mcp: { ...members.mcp, availableTools: async () => [spec("read_file")] },
    });

    expect(
      await capabilities.toolsFor("conversation-1", { skills: true }),
    ).toEqual({
      ok: false,
      reason: "The tool “read_file” is registered more than once.",
    });
  });

  it("still offers built-in tools, and withholds every connection, when plugins cannot be listed", async () => {
    const { members, asked } = membersRecording();
    const capabilities = new ComposedCapabilities({
      ...members,
      plugins: {
        ...members.plugins,
        list: async () => {
          throw new Error("unreadable");
        },
      },
    });

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.tools.map((tool) => tool.name)).toEqual([
      "read_file",
    ]);
    expect(asked.filter((entry) => entry[0] === "mcp.availableTools")).toEqual(
      [],
    );
  });

  it("still offers built-in tools when connections cannot be listed", async () => {
    const { members } = membersRecording();
    const capabilities = new ComposedCapabilities({
      ...members,
      mcp: {
        ...members.mcp,
        availableTools: async () => {
          throw new Error("unreachable");
        },
      },
    });

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.tools.map((tool) => tool.name)).toEqual([
      "read_file",
      "inspect_plugin",
    ]);
  });
});

describe("inspecting a plugin", () => {
  it("lists one enabled plugin's components by name and purpose without activating it", async () => {
    const { capabilities } = membersRecording();

    await expect(
      capabilities.inspect("conversation-1", "plugin", "inspect_plugin", {
        id: "software-engineering",
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "Inspect Software Engineering",
      target: "Software Engineering",
      access: "read",
      detail:
        "Shows this plugin's skills, specialists, and connectors without activating it.",
      presentation: {
        title: "Inspect Software Engineering",
        description:
          "See what the Software Engineering plugin includes before using it.",
      },
      invocation: {
        name: "Inspect plugin",
        arguments: [{ name: "Plugin", value: "Software Engineering" }],
      },
    });

    const contents = await capabilities.execute(
      "conversation-1",
      "plugin",
      "inspect_plugin",
      { id: "software-engineering" },
    );

    expect(contents).toEqual({
      ok: true,
      value: {
        skills: [
          {
            id: "software-engineering/test-first",
            name: "test-first",
            description: "Write the failing test first.",
          },
        ],
        specialists: [
          {
            id: "software-engineering/code-reviewer",
            name: "Code reviewer",
            description: "Reviews a change.",
          },
        ],
        connectors: [
          {
            id: "software-engineering/github",
            name: "GitHub",
            description: "Repositories, issues, and pull requests.",
          },
          {
            id: "software-engineering/browser",
            name: "Browser",
            description: "Opens pages to test them.",
          },
        ],
      },
      details: [
        {
          kind: "list",
          label: "Skills",
          items: ["test-first — Write the failing test first."],
        },
        {
          kind: "list",
          label: "Specialists",
          items: ["Code reviewer — Reviews a change."],
        },
        {
          kind: "list",
          label: "Connectors",
          items: [
            "GitHub — Repositories, issues, and pull requests.",
            "Browser — Opens pages to test them.",
          ],
        },
      ],
    });
    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });
    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.skills).toEqual([]);
  });

  it("refuses to inspect an unknown or disabled plugin", async () => {
    const { capabilities } = membersRecording();
    await capabilities.setPluginEnabled("deep-research", false);

    for (const id of ["missing", "deep-research"])
      expect(
        await capabilities.execute(
          "conversation-1",
          "plugin",
          "inspect_plugin",
          { id },
        ),
      ).toEqual({ ok: false, reason: `“${id}” is not an enabled plugin.` });
  });

  it("says which connector cannot run yet and what the person does about it", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("software-engineering/github"),
        connection("browser", { builtIn: true }),
      ],
      overrides: {
        connectionToolchains: { browser: ["chromium"] },
        toolchains: {
          state: async () => ({
            status: "missing",
            downloads: [
              {
                name: "Chromium",
                version: "1",
                bytes: 10,
                source: "example.test",
              },
            ],
          }),
          install: async () => {},
          executable: async () => undefined,
        },
      },
    });
    const browserNeeds =
      "Browser needs setting up: on the Plugins page, open Software Engineering and, under Connectors, select Set up, then Install.";

    const answer = await capabilities.execute(
      "conversation-1",
      "plugin",
      "inspect_plugin",
      { id: "software-engineering" },
    );

    expect(answer).toMatchObject({
      ok: true,
      value: {
        connectors: [
          {
            id: "software-engineering/github",
            name: "GitHub",
            description: "Repositories, issues, and pull requests.",
          },
          {
            id: "software-engineering/browser",
            name: "Browser",
            description: "Opens pages to test them.",
            notReady: browserNeeds,
          },
        ],
        note: "A connector that is not ready adds no tools to this conversation. Tell the person what it needs.",
      },
    });
    if (!answer.ok) throw new Error(answer.reason);
    expect(
      (answer.value as { connectors: object[] }).connectors[0],
    ).not.toHaveProperty("notReady");
    expect(answer.details).toContainEqual({
      kind: "list",
      label: "Not ready yet",
      items: [browserNeeds],
    });
  });

  it("says nothing more about a plugin whose connectors are all ready", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("software-engineering/github"),
        connection("browser", { builtIn: true }),
      ],
      overrides: { connectionToolchains: { browser: ["chromium"] } },
    });

    const answer = await capabilities.execute(
      "conversation-1",
      "plugin",
      "inspect_plugin",
      { id: "software-engineering" },
    );

    expect(JSON.stringify(answer)).not.toMatch(/notReady|note|Not ready/);
  });

  it("puts each reason a connector cannot run in the words of the Plugins page", async () => {
    const where =
      "the Plugins page, open Software Engineering and, under Connectors,";
    const needs = async (
      github: Partial<McpServerState>,
      browser: Partial<McpServerState>,
      toolchain?: ToolchainState,
    ) => {
      const { capabilities } = membersRecording({
        connections: [
          connection("software-engineering/github", github),
          connection("browser", { builtIn: true, ...browser }),
        ],
        overrides: {
          connectionToolchains: { browser: ["chromium"] },
          ...(toolchain
            ? {
                toolchains: {
                  state: async () => toolchain,
                  install: async () => {},
                  executable: async () => undefined,
                },
              }
            : {}),
        },
      });
      const contents = await capabilities.pluginContents(
        "software-engineering",
      );
      return contents?.connectors.map((connector) => connector.notReady);
    };

    expect(await needs({ status: "unauthorized" }, {})).toEqual([
      `GitHub needs setting up: on ${where} select Set up.`,
      undefined,
    ]);
    expect(
      await needs(
        { status: "failed", reason: "The server did not answer" },
        {
          status: "disconnected",
          reason: "Chromium could not start.",
        },
      ),
    ).toEqual([
      `GitHub could not connect: The server did not answer. On ${where} select Check again.`,
      `Browser could not start: Chromium could not start. Once that is put right, on ${where} select Check again.`,
    ]);
    expect(await needs({}, {}, { status: "installing" })).toEqual([
      undefined,
      "Browser is being installed and can be used once that has finished.",
    ]);
    expect(
      await needs(
        {},
        {},
        { status: "failed", reason: "The download stopped." },
      ),
    ).toEqual([
      undefined,
      `Browser could not be set up: The download stopped. On ${where} select Try again, then Install.`,
    ]);
    // Not reached yet is not a problem: a first use says.
    expect(
      await needs({ status: "unchecked" }, { status: "disconnected" }),
    ).toEqual([undefined, undefined]);
  });
});

describe("a call handed back", () => {
  it("tells a built-in tool which conversation it answers, so it reads only what that one kept", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.execute("conversation-3", "built-in", "read_file", {});

    expect(asked).toContainEqual([
      "tools.execute",
      "read_file",
      "conversation-3",
    ]);
  });

  it("reaches a connection in the conversation's own scope, withholding what its turn did not activate", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.toolsFor("conversation-7", {
      skills: false,
      activatedPlugins: ["software-engineering"],
    });

    const inspection = await capabilities.inspect(
      "conversation-7",
      "mcp",
      "mcp__software-engineering__github__search",
      {},
    );
    const result = await capabilities.execute(
      "conversation-7",
      "mcp",
      "mcp__software-engineering__github__search",
      {},
      { identity: "server-identity" },
    );

    expect(inspection).toMatchObject({ ok: true, target: "conversation-7" });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "mcp__software-engineering__github__search",
        identity: "server-identity",
        scope: "conversation-7",
      },
    });
    expect(asked).toContainEqual([
      "mcp.execute",
      "mcp__software-engineering__github__search",
      "conversation-7",
      everythingButGithubAndBrowser,
    ]);
  });

  it("withholds every connection from a conversation whose turn activated nothing", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.toolsFor("conversation-8", {
      skills: false,
      activatedPlugins: ["software-engineering"],
    });

    await capabilities.execute("other-conversation", "mcp", "mcp__x__y", {});

    expect(asked).toContainEqual([
      "mcp.execute",
      "mcp__x__y",
      "other-conversation",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
  });

  it("reaches the built-in tools for a built-in call", async () => {
    const { capabilities } = membersRecording();

    expect(
      await capabilities.execute("conversation-1", "built-in", "read_file", {}),
    ).toEqual({ ok: true, value: "built-in read_file" });
  });

  it("reads an offered skill's instructions as the whole of the result", async () => {
    const { capabilities } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    expect(
      await capabilities.execute("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: true,
      value: "Start from a failing test.",
      details: [
        {
          kind: "text",
          label: "Instructions",
          text: "Start from a failing test.",
        },
      ],
    });
  });

  it("refuses to load a skill this conversation was not offered", async () => {
    const { capabilities } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    const unoffered = { id: "deep-research/triangulate" };
    expect(
      await capabilities.inspect(
        "conversation-1",
        "skill",
        "load_skill",
        unoffered,
      ),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "No skill with the id “deep-research/triangulate” is available here. Available: software-engineering/test-first.",
    });
    expect(
      await capabilities.execute(
        "conversation-1",
        "skill",
        "load_skill",
        unoffered,
      ),
    ).toEqual({
      ok: false,
      reason:
        "No skill with the id “deep-research/triangulate” is available here. Available: software-engineering/test-first.",
    });
    expect(
      await capabilities.execute("conversation-2", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: false,
      reason:
        "No skill with the id “software-engineering/test-first” is available here. No skills are available in this conversation.",
    });
  });

  it("refuses to load an offered skill whose plugin was switched off since", async () => {
    const { capabilities } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    await capabilities.setPluginEnabled("software-engineering", false);

    expect(
      await capabilities.execute("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: false,
      reason: "The Software Engineering plugin is turned off.",
    });
  });

  it("refuses skill loading that does not name exactly one skill", async () => {
    const { capabilities } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    expect(
      await capabilities.inspect("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
        also: "this",
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "Pass exactly one argument, “id”, naming a skill. Available: software-engineering/test-first.",
    });
    expect(
      await capabilities.inspect("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: true,
      action: "Read skill instructions",
      target: "software-engineering/test-first",
      command: 'load_skill({"id":"software-engineering/test-first"})',
      access: "read",
    });
  });

  it("forgets what a deleted conversation was offered", async () => {
    const { capabilities } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    await capabilities.forgetConversation("conversation-1");

    expect(
      await capabilities.execute("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: false,
      reason:
        "No skill with the id “software-engineering/test-first” is available here. No skills are available in this conversation.",
    });
  });

  it("cannot take a person's answer when the built-in tools do not accept one", async () => {
    const { members } = membersRecording();
    const without = new ComposedCapabilities(members);
    const withAnswers = new ComposedCapabilities({
      ...members,
      tools: {
        ...members.tools,
        completeUserInput: async (name) => ({
          ok: true,
          value: `${name} done`,
        }),
      },
    });

    expect(without.completeUserInput).toBeUndefined();
    expect(
      await withAnswers.completeUserInput?.("ask_user", {}, { answers: [] }),
    ).toEqual({ ok: true, value: "ask_user done" });
  });

  it("leaves a stopped conversation's browser and connections open", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.stopConversation("conversation-1");

    expect(asked).toEqual([]);
  });

  it("lets go of a deleted conversation's browser and connections", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.forgetConversation("conversation-1");

    expect(asked).toEqual([
      ["browsers.forget", "conversation-1"],
      ["mcp.shutdownScope", "conversation-1"],
    ]);
  });

  it("stops a conversation's running commands when it is stopped or forgotten, and every one at shutdown", async () => {
    const stopped: string[] = [];
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          list: () => [],
          inspect: async () => ({ ok: false, reason: "Unused." }),
          execute: async () => ({ ok: false, reason: "Unused." }),
          stopCommands: async (conversationId) => {
            stopped.push(conversationId);
          },
          stopAllCommands: async () => {
            stopped.push("everyone");
          },
        },
      },
    });

    await capabilities.stopConversation("conversation-1");
    await capabilities.forgetConversation("conversation-2");
    await capabilities.shutdown();

    expect(stopped).toEqual(["conversation-1", "conversation-2", "everyone"]);
  });

  it("passes on a command that ended by itself to whoever listens", () => {
    let announce:
      | ((conversationId: string, notice: string, wakes: boolean) => void)
      | undefined;
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          list: () => [],
          inspect: async () => ({ ok: false, reason: "Unused." }),
          execute: async () => ({ ok: false, reason: "Unused." }),
          onCommandEnded: (listener) => {
            announce = listener;
          },
        },
      },
    });
    const heard: string[][] = [];

    capabilities.onCommandEnded((conversationId, notice, wakes) =>
      heard.push([conversationId, notice, String(wakes)]),
    );
    announce?.(
      "conversation-1",
      "Job J1 (make) finished with exit code 0.",
      true,
    );

    expect(heard).toEqual([
      ["conversation-1", "Job J1 (make) finished with exit code 0.", "true"],
    ]);
  });

  it("passes on what changed in the folder while a job ran, once it ended", () => {
    let seen:
      | ((
          conversationId: string,
          job: string,
          changes: CommandFileChanges,
        ) => void)
      | undefined;
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          list: () => [],
          inspect: async () => ({ ok: false, reason: "Unused." }),
          execute: async () => ({ ok: false, reason: "Unused." }),
          onJobChanges: (watcher) => {
            seen = watcher;
          },
        },
      },
    });
    const heard: unknown[] = [];
    const changes: CommandFileChanges = {
      status: "checked",
      job: "J1",
      files: [{ path: "late.txt", change: "created" }],
    };

    capabilities.onJobChanges((conversationId, job, found) =>
      heard.push([conversationId, job, found]),
    );
    seen?.("conversation-1", "J1", changes);

    expect(heard).toEqual([["conversation-1", "J1", changes]]);
  });

  it("shows a conversation's running commands, and stops one for the person", async () => {
    const make = {
      id: "J1",
      command: "make",
      explanation: "Builds the project.",
      startedAt: 1_000,
    };
    const stopped: string[][] = [];
    let changed: ((conversationId: string) => void) | undefined;
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          list: () => [],
          inspect: async () => ({ ok: false, reason: "Unused." }),
          execute: async () => ({ ok: false, reason: "Unused." }),
          runningCommands: (id) => (id === "conversation-1" ? [make] : []),
          commandOutput: async () => ({ stdout: "building", stderr: "" }),
          stopCommandForPerson: async (id, job) => void stopped.push([id, job]),
          onCommandsChanged: (watcher) => {
            changed = watcher;
          },
        },
      },
    });
    const heard: string[] = [];
    capabilities.onCommandsChanged((id) => heard.push(id));

    expect(capabilities.runningCommands("conversation-1")).toEqual([make]);
    expect(capabilities.runningCommands("conversation-2")).toEqual([]);
    expect(await capabilities.commandOutput("conversation-1", "J1")).toEqual({
      stdout: "building",
      stderr: "",
    });
    await capabilities.stopCommandForPerson("conversation-1", "J1");
    changed?.("conversation-1");

    expect(stopped).toEqual([["conversation-1", "J1"]]);
    expect(heard).toEqual(["conversation-1"]);
  });

  it("shows no running commands when its tools keep none", async () => {
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          list: () => [],
          inspect: async () => ({ ok: false, reason: "Unused." }),
          execute: async () => ({ ok: false, reason: "Unused." }),
        },
      },
    });

    expect(capabilities.runningCommands("conversation-1")).toEqual([]);
    expect(
      await capabilities.commandOutput("conversation-1", "J1"),
    ).toBeUndefined();
  });

  it("keeps a stopped conversation's Blender open, lets it go when the conversation is deleted, and closes every one at shutdown", async () => {
    const asked: unknown[][] = [];
    const note =
      (name: string) =>
      async (...args: unknown[]) => {
        asked.push([name, ...args]);
      };
    const { capabilities } = membersRecording({
      overrides: {
        scenes: {
          close: note("scenes.close"),
          forget: note("scenes.forget"),
          closeAll: note("scenes.closeAll"),
        },
      },
    });

    await capabilities.stopConversation("conversation-1");
    await capabilities.forgetConversation("conversation-2");
    await capabilities.shutdown();

    expect(asked).toEqual([
      ["scenes.forget", "conversation-2"],
      ["scenes.closeAll"],
    ]);
  });

  it("closes a conversation left alone's browser and Blender, and keeps everything else it holds", async () => {
    const { capabilities, asked } = membersRecording({
      overrides: {
        scenes: {
          close: async (...args: unknown[]) => {
            asked.push(["scenes.close", ...args]);
          },
          forget: async () => {},
          closeAll: async () => {},
        },
      },
    });

    await capabilities.restConversation("conversation-1");

    expect(asked).toEqual([
      ["browsers.close", "conversation-1"],
      ["scenes.close", "conversation-1"],
    ]);
  });

  it("closes every browser and every connection at shutdown", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.shutdown();

    expect(asked).toEqual([["browsers.closeAll"], ["mcp.shutdownAll"]]);
  });
});

describe("what a person has set up", () => {
  it("presents each plugin from the readiness of its actual components", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("browser", { builtIn: true }),
        connection("software-engineering/github", {
          status: "unauthorized",
          reason: "The server refused the access token.",
          credential: { status: "saved" },
        }),
        connection("deep-research/tavily"),
      ],
    });
    await capabilities.setComponentEnabled(
      "software-engineering/code-reviewer",
      false,
    );

    const [engineeringState, researchState] = await capabilities.pluginStates();

    expect(engineeringState).toMatchObject({
      id: "software-engineering",
      name: "Software Engineering",
      status: "partial",
      source: "built-in",
      editing: "override",
      defaultPrompts: ["Review this project."],
      accessSummary: "Uses approved project files.",
      components: [
        {
          id: "software-engineering/test-first",
          kind: "skill",
          enabled: true,
          status: "ready",
          editing: "override",
        },
        {
          id: "software-engineering/code-reviewer",
          kind: "specialist",
          enabled: false,
          status: "off",
        },
        {
          id: "software-engineering/github",
          kind: "connection",
          status: "setup-required",
          editing: "none",
          detail: "The server refused the access token.",
        },
        {
          id: "software-engineering/browser",
          kind: "connection",
          status: "ready",
          editing: "none",
          appConnector: true,
        },
      ],
    });
    expect(researchState).toMatchObject({ status: "ready" });
  });

  it("shows an installed plugin that could not be opened as needing attention, with why", async () => {
    const asked: unknown[][] = [];
    const { capabilities } = membersRecording({
      overrides: {
        plugins: pluginsHolding([engineering(), research()], asked, [
          {
            name: "notes",
            version: "1.0.0",
            editing: "override",
            reason:
              "Installed plugin “notes” is damaged and cannot be opened safely.",
          },
        ]),
      },
    });

    const states = await capabilities.pluginStates();

    expect(states.map((state) => [state.id, state.status])).toEqual([
      ["software-engineering", "ready"],
      ["deep-research", "ready"],
      ["notes", "failed"],
    ]);
    expect(states[2]).toMatchObject({
      name: "notes",
      version: "1.0.0",
      source: "personal",
      editing: "override",
      components: [],
      description:
        "Installed plugin “notes” is damaged and cannot be opened safely. Remove it, then install it again.",
    });
  });

  it("looks at what a person has set up without reaching any connector", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.connections();
    await capabilities.pluginStates();

    expect(asked).toEqual([]);
  });

  it("presents a connector nobody has checked as unchecked, not as ready", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("browser", { builtIn: true }),
        connection("deep-research/tavily", {
          status: "unchecked",
          credential: { status: "saved" },
        }),
      ],
    });

    const [, researchState] = await capabilities.pluginStates();

    expect(
      researchState?.components.find(
        (component) => component.id === "deep-research/tavily",
      ),
    ).toMatchObject({ status: "unchecked" });
  });

  it("presents an unchecked connector that needs a key nobody has saved as needing setup", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("browser", { builtIn: true }),
        connection("deep-research/tavily", { status: "unchecked" }),
      ],
    });

    const [, researchState] = await capabilities.pluginStates();

    expect(
      researchState?.components.find(
        (component) => component.id === "deep-research/tavily",
      ),
    ).toMatchObject({ status: "setup-required" });
    expect(researchState?.status).not.toBe("ready");
  });

  it("presents an unchecked connector signed in instead of given a key as unchecked, and one whose key cannot be read as failed", async () => {
    const statusWith = async (credential: McpCredentialState) => {
      const { capabilities } = membersRecording({
        connections: [
          connection("deep-research/tavily", {
            status: "unchecked",
            credential,
          }),
        ],
      });
      const [, researchState] = await capabilities.pluginStates();
      return researchState?.components.find(
        (component) => component.id === "deep-research/tavily",
      )?.status;
    };

    expect(await statusWith({ status: "signed-in" })).toBe("unchecked");
    expect(
      await statusWith({
        status: "unavailable",
        reason: "Windows' secure storage is unavailable.",
      }),
    ).toBe("failed");
  });

  it("tells the window what key a connector needs and where its package says it is made", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("deep-research/tavily", { status: "unchecked" }),
      ],
    });

    const [engineeringState, researchState] = await capabilities.pluginStates();

    expect(
      researchState?.components.find(
        (component) => component.id === "deep-research/tavily",
      )?.setup,
    ).toEqual({ url: "https://app.tavily.com/home", keyName: "API key" });
    expect(
      engineeringState?.components.find(
        (component) => component.id === "software-engineering/github",
      ),
    ).not.toHaveProperty("setup");
  });

  it("checks one connector when a person asks, and only that one", async () => {
    const { capabilities, asked } = membersRecording();

    expect(
      await capabilities.checkConnection("deep-research/tavily"),
    ).toMatchObject({ id: "deep-research/tavily", status: "connected" });
    expect(asked).toEqual([["mcp.check", "deep-research/tavily"]]);
  });

  it("does not call an anonymous refusal a rejected token", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("browser", { builtIn: true }),
        connection("software-engineering/github", {
          status: "unauthorized",
          reason: "This server refused the access token.",
        }),
      ],
    });

    const [engineeringState] = await capabilities.pluginStates();

    expect(
      engineeringState?.components.find(
        (component) => component.id === "software-engineering/github",
      ),
    ).toMatchObject({
      status: "setup-required",
      detail: "This connector needs an access token before it can be used.",
    });
  });

  it("asks for a sign-in, not a token, where the service has its own", async () => {
    const { capabilities } = membersRecording({
      connections: [
        connection("browser", { builtIn: true }),
        connection("software-engineering/github", {
          status: "unauthorized",
          signIn: true,
        }),
      ],
    });

    const [engineeringState] = await capabilities.pluginStates();

    expect(
      engineeringState?.components.find(
        (component) => component.id === "software-engineering/github",
      ),
    ).toMatchObject({
      status: "setup-required",
      detail: "Sign in to use this connector.",
    });
  });

  it("reports an application connector this build does not have as unavailable, and one missing its program as needing setup", async () => {
    const { capabilities } = membersRecording({
      connections: [],
      overrides: {
        connectionToolchains: { browser: ["chromium"] },
        toolchains: {
          state: async () => ({
            status: "missing",
            downloads: [
              {
                name: "Chromium",
                version: "1",
                bytes: 10,
                source: "example.test",
              },
            ],
          }),
          install: async () => {},
          executable: async () => undefined,
        },
      },
    });

    const [first] = await capabilities.pluginStates();
    expect(
      first?.components.find(
        (component) => component.id === "software-engineering/browser",
      ),
    ).toMatchObject({
      status: "unavailable",
      detail: "This connector is not available in this build.",
    });

    const { capabilities: withBrowser } = membersRecording({
      connections: [connection("browser", { builtIn: true })],
      overrides: {
        connectionToolchains: { browser: ["chromium"] },
        toolchains: {
          state: async () => ({
            status: "missing",
            downloads: [
              {
                name: "Chromium",
                version: "1",
                bytes: 10,
                source: "example.test",
              },
            ],
          }),
          install: async () => {},
          executable: async () => undefined,
        },
      },
    });
    const [again] = await withBrowser.pluginStates();
    expect(
      again?.components.find(
        (component) => component.id === "software-engineering/browser",
      ),
    ).toMatchObject({
      status: "setup-required",
      toolchain: { status: "missing" },
    });
  });

  it("says how much of a connector's programs has arrived while they install", async () => {
    const { capabilities } = membersRecording({
      connections: [connection("browser", { builtIn: true })],
      overrides: {
        connectionToolchains: { browser: ["one", "two"] },
        toolchains: {
          state: async (program) =>
            program === "one"
              ? { status: "installing", received: 30, bytes: 100 }
              : {
                  status: "missing",
                  downloads: [
                    {
                      name: "Two",
                      version: "1",
                      bytes: 50,
                      source: "example.test",
                    },
                  ],
                },
          install: async () => {},
          executable: async () => undefined,
        },
      },
    });

    const [engineering] = await capabilities.pluginStates();

    expect(
      engineering?.components.find(
        (component) => component.id === "software-engineering/browser",
      )?.toolchain,
    ).toEqual({ status: "installing", received: 30, bytes: 150 });
  });

  it("stops installing a connector's programs when asked to", async () => {
    const controller = new AbortController();
    const stopping: [string, AbortSignal | undefined][] = [];
    const { capabilities } = membersRecording({
      overrides: {
        connectionToolchains: { browser: ["one", "two"] },
        toolchains: {
          state: async () => ({ status: "ready" }),
          // Stopped while the first program downloads.
          install: async (program, signal) => {
            stopping.push([program, signal]);
            controller.abort();
            signal?.throwIfAborted();
          },
          executable: async () => undefined,
        },
      },
    });

    await expect(
      capabilities.installToolchain(
        "software-engineering/browser",
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(stopping).toEqual([["one", controller.signal]]);
  });

  it("installs every program an application connector needs, then looks at connections again", async () => {
    const { capabilities, asked } = membersRecording({
      overrides: { connectionToolchains: { browser: ["one", "two"] } },
    });

    await capabilities.installToolchain("software-engineering/browser");

    expect(asked).toEqual([
      ["toolchains.install", "one"],
      ["toolchains.install", "two"],
      ["mcp.retryFailed"],
    ]);
    await expect(
      capabilities.installToolchain("software-engineering/github"),
    ).rejects.toThrow("does not need anything installed");
  });

  it("keeps each change in the member it belongs to", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.setComponentEnabled("deep-research/tavily", false);
    await capabilities.overrideComponent("deep-research/triangulate", {
      description: "Mine.",
      instructions: "My way.",
    });
    await capabilities.resetComponent("deep-research/triangulate");
    await capabilities.removePlugin("deep-research");
    await capabilities.saveConnectionToken("deep-research/tavily", "secret");
    await capabilities.setConnectionToolEnabled(
      "deep-research/tavily",
      "search",
      false,
    );
    await capabilities.retryConnections();

    expect(asked).toEqual([
      ["plugins.setComponentEnabled", "deep-research/tavily", false],
      [
        "plugins.overrideComponent",
        "deep-research/triangulate",
        { description: "Mine.", instructions: "My way." },
      ],
      ["plugins.resetComponent", "deep-research/triangulate"],
      ["plugins.remove", "deep-research"],
      ["mcp.saveToken", "deep-research/tavily", "secret"],
      ["mcp.setToolEnabled", "deep-research/tavily", "search", false],
      ["mcp.retryFailed"],
    ]);
  });

  it("declares every package connector to the connection feature with its request rate, off when its plugin or itself is off", async () => {
    const asked: unknown[][] = [];
    const plugins = pluginsHolding([engineering(), research()], asked);
    await plugins.setEnabled("deep-research", false);
    await plugins.setComponentEnabled("software-engineering/github", false);

    expect(await declaredConnectionsOf(plugins)).toEqual([
      {
        id: "software-engineering/github",
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        enabled: false,
      },
      {
        id: "deep-research/tavily",
        name: "Tavily",
        url: "https://mcp.tavily.com/mcp/",
        enabled: false,
        requestsPerMinute: 100,
      },
    ]);
  });

  it("passes on which of a connector's tools its package says only read", async () => {
    const base = research();
    const declaring = {
      ...base,
      mcpServers: base.mcpServers.map((server) => ({
        ...server,
        readOnlyTools: ["tavily_search"],
      })),
    };

    expect(
      await declaredConnectionsOf(pluginsHolding([declaring], [])),
    ).toEqual([
      expect.objectContaining({
        id: "deep-research/tavily",
        readOnlyTools: ["tavily_search"],
      }),
    ]);
  });

  it("names the installed packages that cannot be read, so their connectors keep what is saved", async () => {
    const damaged: DamagedPlugin = {
      name: "deep-research",
      version: "1.0.0",
      editing: "override",
      reason: "Its manifest is not valid JSON.",
    };

    expect(
      await unreadablePackagesOf(pluginsHolding([], [], [damaged])),
    ).toEqual(["deep-research"]);
  });

  it("reads a skill's content with what it replaced, and an app-made plugin's whole content", async () => {
    const overridden = engineering({
      skills: [
        {
          ...engineering().skills[0]!,
          instructions: "My instructions.",
          override: {
            shippedChanged: true,
            shipped: {
              name: "test-first",
              description: "Write the failing test first.",
              instructions: "Start from a failing test.",
            },
          },
        },
      ],
    });
    const authored: PluginView = {
      ...research(),
      manifest: { ...research().manifest, name: "my-tools" },
      provenance: { source: "personal", sourceId: "authored" },
      editing: "authored",
      skills: [
        {
          id: "my-tools/notes",
          name: "notes",
          description: "Take notes.",
          instructions: "Write it down.",
          enabled: true,
        },
      ],
      mcpServers: [],
    };
    const { capabilities } = membersRecording({
      views: [overridden, authored],
    });

    expect(
      await capabilities.componentContent("software-engineering/test-first"),
    ).toEqual({
      id: "software-engineering/test-first",
      kind: "skill",
      name: "test-first",
      description: "Write the failing test first.",
      instructions: "My instructions.",
      editing: "override",
      shipped: {
        name: "test-first",
        description: "Write the failing test first.",
        instructions: "Start from a failing test.",
      },
      shippedChanged: true,
    });
    expect(
      await capabilities.editablePluginContents("software-engineering"),
    ).toBeUndefined();
    expect(await capabilities.editablePluginContents("my-tools")).toMatchObject(
      {
        skills: [
          {
            id: "notes",
            description: "Take notes.",
            instructions: "Write it down.",
          },
        ],
      },
    );
  });

  it("reports the shell tool's availability from the tool registry", () => {
    const { members } = membersRecording({
      overrides: {
        tools: {
          list: () => [spec("read_file")],
          inspect: async (name) => ({
            ok: true,
            action: `Built-in ${name}`,
            target: "notes.md",
            command: name,
          }),
          execute: async (name) => ({ ok: true, value: `built-in ${name}` }),
          shellAvailability: () => ({
            available: false,
            reason: "No shell was found.",
            installUrl: "https://git-scm.com/download/win",
          }),
          recheckShell: () => ({ available: true }),
        },
      },
    });
    const capabilities = new ComposedCapabilities(members);

    expect(capabilities.shellAvailability()).toEqual({
      available: false,
      reason: "No shell was found.",
      installUrl: "https://git-scm.com/download/win",
    });
    expect(capabilities.recheckShell()).toEqual({ available: true });
  });

  it("offers the built-in plugins as interests and switches them to match", async () => {
    const { capabilities, asked } = membersRecording();

    expect(await capabilities.interests()).toEqual([
      "software-engineering",
      "deep-research",
    ]);
    await capabilities.applyInterests(["deep-research"]);

    expect(asked).toEqual([
      ["plugins.setEnabled", "software-engineering", false],
      ["plugins.setEnabled", "deep-research", true],
    ]);
  });
});

describe("the browser as a built-in connection", () => {
  function automationsOpened() {
    const opened: string[] = [];
    const server = browserConnection(
      (conversationId) => {
        opened.push(conversationId);
        return { conversationId } as unknown as OfferedConnection;
      },
      async () => [{ name: "browser_navigate" }],
    );
    return { opened, server };
  }

  it("gives each conversation one automation and reuses it", async () => {
    const { opened, server } = automationsOpened();

    const first = await server.open("conversation-1");
    const again = await server.open("conversation-1");
    await server.open("conversation-2");

    expect(again).toBe(first);
    expect(opened).toEqual(["conversation-1", "conversation-2"]);
  });

  it("describes the browser without opening any conversation", async () => {
    const { opened, server } = automationsOpened();

    expect(await server.describe?.()).toEqual([{ name: "browser_navigate" }]);
    expect(opened).toEqual([]);
  });

  it("refuses to open or inspect the browser without a conversation", async () => {
    const { server } = automationsOpened();

    await expect(server.open()).rejects.toThrow("A conversation is required.");
    expect(await server.inspect?.("browser_navigate", {})).toEqual({
      ok: false,
      reason: "A conversation is required.",
    });
  });

  it("starts a new automation for a conversation that was forgotten", async () => {
    const { opened, server } = automationsOpened();

    await server.open("conversation-1");
    await server.forget?.("conversation-1");
    await server.open("conversation-1");

    expect(opened).toEqual(["conversation-1", "conversation-1"]);
  });
});

describe("the 3D studio as a built-in connection", () => {
  function automationsOpened() {
    const opened: string[] = [];
    const server = sceneConnection(
      (conversationId) => {
        opened.push(conversationId);
        return {
          produced: () => [
            { path: `${conversationId}.png`, change: "created", bytes: 1 },
          ],
        } as unknown as OfferedConnection;
      },
      async () => [
        {
          name: "blender_render",
          description: "Render.",
          inputSchema: { type: "object" },
        },
      ],
    );
    return { opened, server };
  }

  it("gives each conversation its own studio and reuses it", async () => {
    const { opened, server } = automationsOpened();

    const first = await server.open("conversation-1");
    const again = await server.open("conversation-1");
    await server.open("conversation-2");

    expect(again).toBe(first);
    expect(opened).toEqual(["conversation-1", "conversation-2"]);
  });

  it("describes the studio without starting Blender for any conversation", async () => {
    const { opened, server } = automationsOpened();

    expect((await server.describe?.())?.map((tool) => tool.name)).toEqual([
      "blender_render",
    ]);
    expect(opened).toEqual([]);
  });

  it("refuses to open or inspect the studio without a conversation", async () => {
    const { server } = automationsOpened();

    await expect(server.open()).rejects.toThrow("A conversation is required.");
    expect(await server.inspect?.("blender_render", {})).toEqual({
      ok: false,
      reason: "A conversation is required.",
    });
  });

  it("reports the files a call made from that conversation's own studio", () => {
    const { server } = automationsOpened();

    expect(
      server.produced?.("blender_render", {}, {}, "conversation-1"),
    ).toEqual([{ path: "conversation-1.png", change: "created", bytes: 1 }]);
    expect(server.produced?.("blender_render", {}, {})).toEqual([]);
  });

  it("starts a new studio for a conversation that was forgotten", async () => {
    const { opened, server } = automationsOpened();

    await server.open("conversation-1");
    await server.forget?.("conversation-1");
    await server.open("conversation-1");

    expect(opened).toEqual(["conversation-1", "conversation-1"]);
  });
});

describe("git as a built-in connection", () => {
  function fakeAutomation() {
    const inspected: string[] = [];
    const automation: OfferedConnection = {
      inspect: async (name) => {
        inspected.push(name);
        return { ok: true, action: name, target: "repo", command: name };
      },
      describeResult: () => [],
      listTools: async () => [{ name: "git_status" }],
      callTool: async () => ({ content: [] }),
      close: async () => {},
    };
    return { inspected, automation };
  }

  it("shares one connection across every conversation, unlike the browser", async () => {
    const { automation } = fakeAutomation();
    const server = gitConnection(automation);

    expect(await server.open()).toBe(automation);
    expect(await server.open("any-conversation")).toBe(automation);
  });

  it("routes inspection straight to the automation, needing no conversation", async () => {
    const { inspected, automation } = fakeAutomation();
    const server = gitConnection(automation);

    expect(await server.inspect?.("git_status", {})).toEqual({
      ok: true,
      action: "git_status",
      target: "repo",
      command: "git_status",
    });
    expect(inspected).toEqual(["git_status"]);
  });
});

/**
 * The rules above are checked against a stand-in for the connection feature,
 * which shows what this group asks of it. Here the connection feature itself
 * keeps them, with only the far end of each connection stood in for, so a
 * rule this group states holds where the calls are actually made.
 */
describe("connections, kept by the connection feature itself", () => {
  const folders: string[] = [];
  afterEach(async () => {
    for (const folder of folders.splice(0))
      await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  });

  async function composed(views: readonly PluginView[]) {
    const folder = await mkdtemp(join(tmpdir(), "zhiyin-capabilities-"));
    folders.push(folder);
    const asked: unknown[][] = [];
    const plugins = pluginsHolding(views, asked);
    const dialled: string[] = [];
    const called: string[] = [];
    const mcp = new ManagedMcpServers(
      folder,
      async (definition) => {
        dialled.push(definition.id);
        return {
          listTools: async () => [
            { name: "search", inputSchema: { type: "object" } },
          ],
          callTool: async (name) => {
            called.push(`${definition.id} ${name}`);
            return { content: [{ type: "text", text: "Found." }] };
          },
          close: async () => {},
        };
      },
      new InMemoryMcpCredentials(),
      { declared: () => declaredConnectionsOf(plugins) },
    );
    const { capabilities } = membersRecording({ overrides: { mcp, plugins } });
    return { capabilities, plugins, dialled, called, mcp };
  }

  const github = "mcp__software-engineering__github__search";
  const tavily = "mcp__deep-research__tavily__search";

  async function offered(
    capabilities: ComposedCapabilities,
    activatedPlugins: readonly string[],
  ) {
    const gathering = await capabilities.toolsFor("conversation-1", {
      skills: false,
      activatedPlugins,
    });
    if (!gathering.ok) throw new Error(gathering.reason);
    return gathering.value.tools.map((tool) => tool.name);
  }

  it("lets a conversation reach only the connectors of the plugins it activated", async () => {
    const { capabilities, dialled, called, mcp } = await composed([
      engineering(),
      research(),
    ]);
    try {
      const names = await offered(capabilities, ["software-engineering"]);

      expect(names).toContain(github);
      expect(names).not.toContain(tavily);
      expect(
        await capabilities.inspect("conversation-1", "mcp", tavily, {}),
      ).toMatchObject({ ok: false });
      expect(
        await capabilities.execute("conversation-1", "mcp", tavily, {}),
      ).toMatchObject({ ok: false });
      expect(
        await capabilities.execute("conversation-1", "mcp", github, {}),
      ).toMatchObject({ ok: true });
      expect(called).toEqual(["software-engineering/github search"]);
      expect(dialled).not.toContain("deep-research/tavily");
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("offers a connector switched off to no one, even in a conversation that activated its plugin", async () => {
    const { capabilities, plugins, called, mcp } = await composed([
      engineering(),
    ]);
    try {
      expect(await offered(capabilities, ["software-engineering"])).toContain(
        github,
      );

      await plugins.setComponentEnabled("software-engineering/github", false);

      expect(
        await offered(capabilities, ["software-engineering"]),
      ).not.toContain(github);
      expect(
        await capabilities.execute("conversation-1", "mcp", github, {}),
      ).toMatchObject({ ok: false });
      expect(called).toEqual([]);
    } finally {
      await mcp.shutdownAll();
    }
  });

  it("withdraws every connector of a plugin switched off after its conversation activated it", async () => {
    const { capabilities, plugins, called, mcp } = await composed([
      engineering(),
    ]);
    try {
      expect(await offered(capabilities, ["software-engineering"])).toContain(
        github,
      );

      await plugins.setEnabled("software-engineering", false);

      expect(
        await offered(capabilities, ["software-engineering"]),
      ).not.toContain(github);
      expect(
        await capabilities.execute("conversation-1", "mcp", github, {}),
      ).toMatchObject({ ok: false });
      expect(called).toEqual([]);
    } finally {
      await mcp.shutdownAll();
    }
  });
});
