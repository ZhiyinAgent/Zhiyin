import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
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
import type { ShellCommands } from "@zhiyin/tools";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  unreadablePackagesOf,
  documentsConnection,
  gitConnection,
  joinedConnections,
  needing,
  pythonConnection,
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
/** Jobs that do nothing but what a test gives them. */
function jobsWith(overrides: Partial<ShellCommands>): ShellCommands {
  return {
    onCommandEnded: () => {},
    onCommandsChanged: () => {},
    onJobChanges: () => {},
    runningCommands: () => [],
    commandOutput: async () => undefined,
    stopCommandForPerson: async () => {},
    stopCommands: async () => {},
    stopAllCommands: async () => {},
    ...overrides,
  };
}

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
    states: async () =>
      options.connections ?? [connection("browser", { builtIn: true })],
    check: async (id) => {
      asked.push(["mcp.check", id]);
      return connection(id, { status: "connected" });
    },
    retryFailed: note("mcp.retryFailed"),
    builtInIds: () => ["browser", "git"],
    listBuiltInsAgain: note("mcp.listBuiltInsAgain"),
    setToolEnabled: note("mcp.setToolEnabled"),
    setToolTreatment: note("mcp.setToolTreatment"),
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
      execute: async (name, _args, _signal, conversationId, answerTokens) => {
        asked.push(["tools.execute", name, conversationId]);
        if (answerTokens !== undefined)
          asked.push(["tools.answerTokens", name, answerTokens]);
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
  it("offers the built-in tools the conversation itself may call", async () => {
    const { members } = membersRecording();
    const { capabilities } = membersRecording({
      overrides: {
        tools: {
          ...members.tools,
          list: (conversationId) =>
            conversationId === "in-a-folder" ? [spec("read_file")] : [],
        },
      },
    });
    const inFolder = await capabilities.toolsFor("in-a-folder", {
      skills: false,
    });
    const without = await capabilities.toolsFor("without-a-folder", {
      skills: false,
    });

    if (!inFolder.ok || !without.ok) throw new Error("Not gathered.");
    expect(inFolder.value.tools.map((tool) => tool.name)).toContain(
      "read_file",
    );
    expect(without.value.tools.map((tool) => tool.name)).not.toContain(
      "read_file",
    );
  });

  it("offers the directory, every enabled plugin's skills and specialists, and no plugin's connections before any plugin is activated", async () => {
    const { capabilities, asked } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.skills.map((skill) => skill.id)).toEqual([
      "software-engineering/test-first",
      "deep-research/triangulate",
    ]);
    expect(gathered.value.specialists.map((item) => item.id)).toEqual([
      "software-engineering/code-reviewer",
    ]);
    expect(gathered.value.pluginDirectory).toEqual([
      {
        id: "software-engineering",
        name: "Software Engineering",
        purpose: "Build and review software.",
        includes: {
          skills: [
            {
              id: "skill:software-engineering/test-first",
              description: "Write the failing test first.",
            },
          ],
          specialists: ["Code reviewer"],
          connectors: [
            "GitHub — Repositories, issues, and pull requests.",
            "Browser — Opens pages to test them.",
          ],
          toolkits: ["toolkit:software-engineering/github"],
        },
      },
      {
        id: "deep-research",
        name: "Deep Research",
        purpose: "Find and verify sources.",
        includes: {
          skills: [
            {
              id: "skill:deep-research/triangulate",
              description: "Cross-check claims.",
            },
          ],
          specialists: [],
          connectors: ["Tavily — Searches the web."],
          toolkits: ["toolkit:deep-research/tavily"],
        },
      },
    ]);
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
  });

  it("adds exactly an activated plugin's connectors, and names who answers for each", async () => {
    const { capabilities, asked } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
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
    expect(gathered.value.tools.map((tool) => tool.name)).toEqual([
      "read_file",
      "mcp__software-engineering__github__search",
    ]);
    expect(gathered.value.ownerOf("read_file")).toBe("built-in");
    expect(
      gathered.value.ownerOf("mcp__software-engineering__github__search"),
    ).toBe("mcp");
    // Retired for the catalog (ADR 0017).
    expect(gathered.value.ownerOf("load_skill")).toBeUndefined();
    expect(gathered.value.ownerOf("inspect_plugin")).toBeUndefined();
    expect(gathered.value.ownerOf("something_nobody_offered")).toBeUndefined();
  });

  it("hands a specialist the tools it names as written, with the switched-on connections of its plugin those names may belong to", async () => {
    // As the 3D plugin writes it: its reviewer names its studio's tools by
    // their own names, and the app offers them routed through the connection.
    const studio = engineering({
      manifest: { ...engineering().manifest, name: "3d-rendering" },
      specialists: [
        {
          id: "3d-rendering/scene-reviewer",
          name: "Scene reviewer",
          description: "Reviews a scene.",
          instructions: "Look closer with blender_look.",
          access: "read",
          tools: ["blender_look", "read_file"],
          enabled: true,
        },
      ],
      mcpServers: [
        {
          ...engineering().mcpServers[0]!,
          id: "3d-rendering/models",
        },
        {
          ...engineering().mcpServers[0]!,
          id: "3d-rendering/switched-off",
          enabled: false,
        },
      ],
      appConnectors: [
        {
          id: "3d-rendering/studio",
          connector: "blender",
          name: "3D studio",
          description: "Builds scenes.",
          access: "The workspace folder.",
          dataDestination: "Nothing leaves this computer.",
          enabled: true,
        },
      ],
    });
    const { capabilities } = membersRecording({ views: [studio] });

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: false,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.specialists[0]).toMatchObject({
      tools: ["blender_look", "read_file"],
      connections: ["3d-rendering/models", "blender"],
    });
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
    expect(gathered.value.skills.map((skill) => skill.id)).toEqual([
      "deep-research/triangulate",
    ]);
    expect(gathered.value.specialists).toEqual([]);
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
    expect(gathered.value.skills.map((skill) => skill.id)).toEqual([
      "deep-research/triangulate",
    ]);
    expect(gathered.value.specialists).toEqual([]);
    // Listed still, as switched off, so the model can say it exists.
    expect(
      gathered.value.pluginDirectory.map((entry) => [
        entry.id,
        entry.switchedOff,
      ]),
    ).toEqual([
      ["software-engineering", true],
      ["deep-research", undefined],
    ]);
    expect(asked).toContainEqual([
      "mcp.availableTools",
      "conversation-1",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
  });

  it("refuses to open what a built-in plugin the person switched off brings, and says where it is switched on", async () => {
    const { capabilities } = membersRecording();
    await capabilities.setPluginEnabled("software-engineering", false);
    await capabilities.toolsFor("conversation-1", { skills: true });

    expect(
      await capabilities.catalogOpen(
        "conversation-1",
        "skill:software-engineering/test-first",
      ),
    ).toEqual({
      ok: false,
      reason:
        "That plugin is switched off. The person can switch it on in Plugins.",
    });
  });

  it("leaves out a plugin of the person's own that they switched off", async () => {
    const { capabilities } = membersRecording({
      views: [
        engineering(),
        {
          ...research(),
          provenance: { source: "personal", sourceId: "authored" },
          enabled: false,
        },
      ],
    });

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.pluginDirectory.map((entry) => entry.id)).toEqual([
      "software-engineering",
    ]);
  });

  it("lists every built-in plugin as switched off after onboarding with no choice, and offers nothing of them to find", async () => {
    const { capabilities } = membersRecording();

    await capabilities.applyInterests([]);
    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: true,
    });

    if (!gathered.ok) throw new Error(gathered.reason);
    expect(gathered.value.pluginDirectory).toEqual([
      expect.objectContaining({
        id: "software-engineering",
        name: "Software Engineering",
        switchedOff: true,
      }),
      expect.objectContaining({ id: "deep-research", switchedOff: true }),
    ]);
    expect(
      await capabilities.catalogFind("conversation-1", "failing test claims"),
    ).toEqual([]);
  });

  it("offers no skills when skills are unavailable", async () => {
    const { capabilities } = membersRecording();

    const gathered = await capabilities.toolsFor("conversation-1", {
      skills: false,
      activatedPlugins: ["software-engineering"],
    });

    if (!gathered.ok) throw new Error(gathered.reason);
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
    ]);
  });
});

describe("a plugin's contents", () => {
  it("lists one enabled plugin's components by name and purpose, and lays them out for a person", async () => {
    const { capabilities } = membersRecording();

    const contents = await capabilities.pluginContents("software-engineering");

    expect(contents).toEqual({
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
    });
    expect(capabilities.describePluginContents(contents!)).toEqual([
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
    ]);
  });

  it("has nothing for an unknown or disabled plugin", async () => {
    const { capabilities } = membersRecording();
    await capabilities.setPluginEnabled("deep-research", false);

    for (const id of ["missing", "deep-research"])
      expect(await capabilities.pluginContents(id)).toBeUndefined();
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
                sources: ["example.test"],
              },
            ],
          }),
          install: async () => {},
          executable: async () => undefined,
        },
      },
    });
    const browserNeeds =
      "Browser needs setting up: the person can install what it needs under Connectors on Software Engineering's page in Plugins.";

    const contents = await capabilities.pluginContents("software-engineering");

    expect(contents).toMatchObject({
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
    });
    expect(contents?.connectors[0]).not.toHaveProperty("notReady");
    expect(capabilities.describePluginContents(contents!)).toContainEqual({
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

    const contents = await capabilities.pluginContents("software-engineering");

    expect(
      JSON.stringify([
        contents,
        capabilities.describePluginContents(contents!),
      ]),
    ).not.toMatch(/notReady|note|Not ready/);
  });

  it("says each reason a connector cannot run, what the person does about it and where, never by a control's label", async () => {
    const where = "under Connectors on Software Engineering's page in Plugins";
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
      `GitHub needs setting up: the person can add its key or sign in ${where}.`,
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
      `GitHub could not connect: The server did not answer. The person can check it again ${where}.`,
      `Browser could not start: Chromium could not start. Once that is put right, the person can check it again ${where}.`,
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
      `Browser could not be set up: The download stopped. The person can try installing it again ${where}.`,
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

  it("tells a built-in tool how much of its answer the model is shown, so a page fits", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.execute(
      "conversation-3",
      "built-in",
      "read_file",
      {},
      { answerTokens: 25_000 },
    );

    expect(asked).toContainEqual(["tools.answerTokens", "read_file", 25_000]);
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

  it("refuses a call for a skill or a plugin, which offer no tools, and reaches no member", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: true,
      activatedPlugins: ["software-engineering"],
    });
    const id = { id: "software-engineering/test-first" };
    const before = asked.length;

    expect(
      await capabilities.inspect("conversation-1", "skill", "load_skill", id),
    ).toEqual({ ok: false, reason: "“load_skill” is not offered." });
    expect(
      await capabilities.execute(
        "conversation-1",
        "plugin",
        "inspect_plugin",
        id,
      ),
    ).toEqual({ ok: false, reason: "“inspect_plugin” is not offered." });
    expect(asked.slice(before)).toEqual([]);
  });

  describe("a skill that names other skills, opened", () => {
    /** Engineering's test-first skill, needing and working with the ones given. */
    function engineeringNaming(
      named: { needs?: string[]; worksWith?: string[] },
      checklist: { enabled?: boolean } = {},
    ): PluginView {
      return engineering({
        skills: [
          {
            id: "software-engineering/test-first",
            name: "test-first",
            description: "Write the failing test first.",
            instructions: "Start from a failing test.",
            enabled: true,
            ...named,
          },
          {
            id: "software-engineering/review-checklist",
            name: "review-checklist",
            description: "Review a change against the checklist.",
            instructions: "Go down the checklist.",
            enabled: checklist.enabled ?? true,
            worksWith: ["deep-research/triangulate"],
          },
          {
            id: "software-engineering/naming",
            name: "naming",
            description: "Name things well.",
            instructions: "Name it for what it is.",
            enabled: true,
          },
        ],
      });
    }

    async function opened(capabilities: ComposedCapabilities) {
      const opening = await capabilities.catalogOpen(
        "conversation-1",
        "skill:software-engineering/test-first",
      );
      if (!opening.ok) throw new Error(opening.reason);
      return opening.text;
    }

    it("comes with the skills it needs from its own plugin, each named, and names by id those it works with", async () => {
      const { capabilities } = membersRecording({
        views: [
          engineeringNaming({
            needs: ["software-engineering/review-checklist"],
            worksWith: ["software-engineering/naming"],
          }),
          research(),
        ],
      });

      expect(await opened(capabilities)).toBe(
        [
          "Start from a failing test.",
          "---",
          "skill:software-engineering/review-checklist, which this skill needs:",
          "Go down the checklist.",
          "---",
          // The one it works with, and the one the needed skill works with,
          // in another plugin.
          "Open as well each of these that applies to this work: skill:software-engineering/naming, skill:deep-research/triangulate.",
        ].join("\n\n"),
      );
    });

    it("names a skill it needs from another plugin, rather than bringing it", async () => {
      const { capabilities } = membersRecording({
        views: [
          engineeringNaming({ needs: ["deep-research/triangulate"] }),
          research(),
        ],
      });

      expect(await opened(capabilities)).toBe(
        [
          "Start from a failing test.",
          "---",
          "This skill also needs skill:deep-research/triangulate: open it now.",
        ].join("\n\n"),
      );
    });

    it("leaves out a skill switched off or not there, and one its plugin's switch turned off", async () => {
      const { capabilities } = membersRecording({
        views: [
          engineeringNaming(
            {
              needs: ["software-engineering/review-checklist"],
              worksWith: ["deep-research/triangulate", "elsewhere/missing"],
            },
            { enabled: false },
          ),
          { ...research(), enabled: false },
        ],
      });

      expect(await opened(capabilities)).toBe("Start from a failing test.");
    });
  });

  it("forgets what a deleted conversation was offered", async () => {
    const { capabilities, asked } = membersRecording();
    await capabilities.toolsFor("conversation-1", {
      skills: false,
      activatedPlugins: ["software-engineering"],
    });

    await capabilities.forgetConversation("conversation-1");
    await capabilities.execute("conversation-1", "mcp", "mcp__x__y", {});

    expect(asked).toContainEqual([
      "mcp.execute",
      "mcp__x__y",
      "conversation-1",
      ["software-engineering/github", "deep-research/tavily", "browser", "git"],
    ]);
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
        commands: jobsWith({
          stopCommands: async (conversationId) => {
            stopped.push(conversationId);
          },
          stopAllCommands: async () => {
            stopped.push("everyone");
          },
        }),
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
        commands: jobsWith({
          onCommandEnded: (listener) => {
            announce = listener;
          },
        }),
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
        commands: jobsWith({
          onJobChanges: (watcher) => {
            seen = watcher;
          },
        }),
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
        commands: jobsWith({
          runningCommands: (id) => (id === "conversation-1" ? [make] : []),
          commandOutput: async () => ({ stdout: "building", stderr: "" }),
          stopCommandForPerson: async (id, job) => void stopped.push([id, job]),
          onCommandsChanged: (watcher) => {
            changed = watcher;
          },
        }),
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

  it("shows no running commands where commands cannot carry on as jobs", async () => {
    const { capabilities } = membersRecording();

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

  it("lets go of a deleted conversation's CAD studio records with it", async () => {
    const forgotten: string[] = [];
    const { capabilities } = membersRecording({
      overrides: {
        cad: {
          forget: async (conversationId: string) =>
            void forgotten.push(conversationId),
        },
      },
    });

    await capabilities.stopConversation("conversation-1");
    await capabilities.forgetConversation("conversation-2");

    expect(forgotten).toEqual(["conversation-2"]);
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
                sources: ["example.test"],
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
                sources: ["example.test"],
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
                      sources: ["example.test"],
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

  describe("a connector that makes something with its programs", () => {
    /** The environment a connector makes, downloading as it goes. */
    const environment = {
      name: "build123d",
      version: "0.13.0",
      bytes: 200,
      estimated: true as const,
      sources: ["pypi.org"],
    };
    const uv = {
      name: "uv",
      version: "1",
      bytes: 10,
      sources: ["github.com"],
    };
    /** Members whose browser connector needs `one`, then makes what `setup` answers for. */
    const withSetup = (
      setup: CapabilityMembers["connectionSetups"],
      program: ToolchainState = { status: "missing", downloads: [uv] },
    ) =>
      membersRecording({
        connections: [connection("browser", { builtIn: true })],
        overrides: {
          connectionToolchains: { browser: ["one"] },
          ...(setup ? { connectionSetups: setup } : {}),
          toolchains: {
            state: async () => program,
            install: async () => {},
            executable: async () => undefined,
          },
        },
      });
    const browserOf = async (
      capabilities: ReturnType<typeof membersRecording>["capabilities"],
    ) =>
      (await capabilities.pluginStates())[0]?.components.find(
        (component) => component.id === "software-engineering/browser",
      );

    it("asks the person once for everything installing downloads: the programs, and what is made with them", async () => {
      const { capabilities } = withSetup({
        browser: {
          state: async () => ({ status: "missing", downloads: [environment] }),
          install: async () => {},
        },
      });

      expect(await browserOf(capabilities)).toMatchObject({
        status: "setup-required",
        toolchain: { status: "missing", downloads: [uv, environment] },
      });
    });

    it("needs setting up while what it makes is not made, though its programs are installed", async () => {
      const { capabilities } = withSetup(
        {
          browser: {
            state: async () => ({
              status: "missing",
              downloads: [environment],
            }),
            install: async () => {},
          },
        },
        { status: "ready" },
      );

      expect(await browserOf(capabilities)).toMatchObject({
        status: "setup-required",
        toolchain: { status: "missing", downloads: [environment] },
      });
    });

    it("is ready once its programs are installed and what it makes is made", async () => {
      const { capabilities } = withSetup(
        {
          browser: {
            state: async () => ({ status: "ready" }),
            install: async () => {},
          },
        },
        { status: "ready" },
      );

      expect(await browserOf(capabilities)).toMatchObject({
        toolchain: { status: "ready" },
      });
    });

    it("says which step the making is on, and why it failed", async () => {
      const stage = { name: "Installing the packages", step: 2, steps: 3 };
      const making = withSetup(
        {
          browser: {
            state: async () => ({ status: "installing", stage }),
            install: async () => {},
          },
        },
        { status: "ready" },
      );
      const failing = withSetup(
        {
          browser: {
            state: async () => ({ status: "failed", reason: "No disk." }),
            install: async () => {},
          },
        },
        { status: "ready" },
      );

      expect((await browserOf(making.capabilities))?.toolchain).toEqual({
        status: "installing",
        stage,
      });
      expect(await browserOf(failing.capabilities)).toMatchObject({
        toolchain: { status: "failed", reason: "No disk." },
        detail: "No disk.",
      });
    });

    it("installs the programs first, then makes what needs them, then looks at connections again", async () => {
      // The record every member writes to, which the setup writes to too.
      const record: { asked?: unknown[][] } = {};
      const { capabilities, asked } = membersRecording({
        overrides: {
          connectionToolchains: { browser: ["one"] },
          connectionSetups: {
            browser: {
              state: async () => ({
                status: "missing",
                downloads: [environment],
              }),
              install: async () => {
                record.asked?.push(["setup.install"]);
              },
            },
          },
        },
      });
      record.asked = asked;

      await capabilities.installToolchain("software-engineering/browser");

      expect(asked).toEqual([
        ["toolchains.install", "one"],
        ["setup.install"],
        ["mcp.retryFailed"],
      ]);
    });

    it("makes nothing once stopped while its programs install", async () => {
      const controller = new AbortController();
      const asked: string[] = [];
      const { capabilities } = membersRecording({
        overrides: {
          connectionToolchains: { browser: ["one"] },
          connectionSetups: {
            browser: {
              state: async () => ({ status: "missing", downloads: [] }),
              install: async (signal) => {
                asked.push("setup.install");
                signal?.throwIfAborted();
              },
            },
          },
          toolchains: {
            state: async () => ({ status: "ready" }),
            install: async () => {
              controller.abort();
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
      expect(asked).toEqual([]);
    });

    it("tells the model a connector whose made part is from an earlier release needs updating", async () => {
      const { capabilities } = withSetup(
        {
          browser: {
            state: async () => ({
              status: "missing",
              downloads: [{ ...environment, update: true }],
            }),
            install: async () => {},
          },
        },
        { status: "ready" },
      );

      const contents = await capabilities.pluginContents(
        "software-engineering",
      );

      expect(
        contents?.connectors.find(
          (connector) => connector.id === "software-engineering/browser",
        )?.notReady,
      ).toBe(
        "Browser needs updating: the person can update it under Connectors on Software Engineering's page in Plugins.",
      );
    });
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
    await capabilities.setConnectionToolTreatment(
      "deep-research/tavily",
      "search",
      "only-reads",
      "version-shown",
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
      [
        "mcp.setToolTreatment",
        "deep-research/tavily",
        "search",
        "only-reads",
        "version-shown",
      ],
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
        shipped: true,
      },
      {
        id: "deep-research/tavily",
        name: "Tavily",
        url: "https://mcp.tavily.com/mcp/",
        enabled: false,
        requestsPerMinute: 100,
        shipped: true,
      },
    ]);
  });

  it("says which connectors a package Zhiyin ships declares, and of no other package's", async () => {
    const shipped = research();
    const imported: PluginView = {
      ...shipped,
      provenance: { source: "personal", sourceId: "local-import" },
    };

    expect(
      (await declaredConnectionsOf(pluginsHolding([shipped], [])))[0],
    ).toMatchObject({ id: "deep-research/tavily", shipped: true });
    expect(
      (await declaredConnectionsOf(pluginsHolding([imported], [])))[0],
    ).not.toHaveProperty("shipped");
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

  it("passes on the minutes a connector's package gives its slow tools", async () => {
    const base = research();
    const declaring = {
      ...base,
      mcpServers: base.mcpServers.map((server) => ({
        ...server,
        toolMinutes: { tavily_research: 16 },
      })),
    };

    expect(
      await declaredConnectionsOf(pluginsHolding([declaring], [])),
    ).toEqual([
      expect.objectContaining({
        id: "deep-research/tavily",
        toolMinutes: { tavily_research: 16 },
      }),
    ]);
  });

  it("passes on what a built-in package says its connector's tools do, and nothing of the kind from any other package", async () => {
    const toolEffects = [
      {
        tools: ["tavily_search"],
        effects: {
          reads: "none",
          changes: "none",
          sends: "service",
          actsAsPerson: "none",
          runs: "none",
          lasting: false,
          brings: "outside",
        } as const,
      },
    ];
    const base = research();
    const shipped: PluginView = {
      ...base,
      mcpServers: base.mcpServers.map((server) => ({
        ...server,
        toolEffects,
      })),
    };
    const imported: PluginView = {
      ...shipped,
      provenance: { source: "personal", sourceId: "local-import" },
    };

    expect(await declaredConnectionsOf(pluginsHolding([shipped], []))).toEqual([
      expect.objectContaining({ id: "deep-research/tavily", toolEffects }),
    ]);
    expect(
      (await declaredConnectionsOf(pluginsHolding([imported], [])))[0],
    ).not.toHaveProperty("toolEffects");
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
          name: "笔记",
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
            name: "笔记",
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

describe.each([
  ["git", gitConnection],
  ["documents", documentsConnection],
  ["python", pythonConnection],
] as const)("the %s connection", (id, connection) => {
  it("gives each conversation an automation of its own, so each works in its own folder", async () => {
    const opened: string[] = [];
    const server = connection(
      (conversationId) => {
        opened.push(conversationId);
        return {
          inspect: async () => ({
            ok: true,
            action: conversationId,
            target: "folder",
            command: "call",
          }),
          describeResult: () => [],
          listTools: async () => [],
          callTool: async () => ({ content: [] }),
          close: async () => {},
        };
      },
      async () => [],
    );

    expect(server.id).toBe(id);
    expect(server.scope).toBe("conversation");
    expect(await server.inspect?.("call", {}, "first")).toMatchObject({
      action: "first",
    });
    expect(await server.inspect?.("call", {}, "second")).toMatchObject({
      action: "second",
    });
    expect(opened).toEqual(["first", "second"]);
  });
});

describe("the application connections, joined", () => {
  const nothing = () => {
    throw new Error("No automation is opened here.");
  };
  const setup = {
    state: async () => ({ status: "ready" as const }),
    install: async () => {},
  };

  it("keeps each connection with the programs it needs and what it makes with them, by its id", () => {
    const joined = joinedConnections([
      gitConnection(nothing, async () => []),
      needing(
        documentsConnection(nothing, async () => []),
        {
          programs: ["typst", "tectonic"],
        },
      ),
      needing(
        pythonConnection(nothing, async () => []),
        {
          programs: ["uv"],
          setup,
        },
      ),
    ]);

    expect(joined.builtIns.map((server) => server.id)).toEqual([
      "git",
      "documents",
      "python",
    ]);
    expect(joined.toolchains).toEqual({
      documents: ["typst", "tectonic"],
      python: ["uv"],
    });
    expect(joined.setups).toEqual({ python: setup });
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

  it("opens one connection for each conversation, so each works in its own folder", async () => {
    const opened: string[] = [];
    const server = gitConnection(
      (conversationId) => {
        opened.push(conversationId);
        return fakeAutomation().automation;
      },
      async () => [{ name: "git_status" }],
    );

    const first = await server.open("conversation-1");
    expect(await server.open("conversation-1")).toBe(first);
    expect(await server.open("conversation-2")).not.toBe(first);
    expect(opened).toEqual(["conversation-1", "conversation-2"]);
    expect(await server.describe?.()).toEqual([{ name: "git_status" }]);
  });

  it("inspects a call with its conversation's automation, and refuses one that names none", async () => {
    const { inspected, automation } = fakeAutomation();
    const server = gitConnection(
      () => automation,
      async () => [],
    );

    expect(await server.inspect?.("git_status", {}, "conversation-1")).toEqual({
      ok: true,
      action: "git_status",
      target: "repo",
      command: "git_status",
    });
    expect(await server.inspect?.("git_status", {})).toEqual({
      ok: false,
      reason: "A conversation is required.",
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
  const folders = new TemporaryFolders();
  afterEach(() => folders.removeAll());

  async function composed(views: readonly PluginView[]) {
    const folder = await folders.make("zhiyin-capabilities-");
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
