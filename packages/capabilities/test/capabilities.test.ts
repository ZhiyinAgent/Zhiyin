import { describe, expect, it } from "vitest";
import type { McpServerState, ToolSpec } from "@zhiyin/contract";
import type { BrowserAutomation } from "@zhiyin/interactive-browser";
import type { GitAutomation } from "@zhiyin/git-connector";
import type { McpServers } from "@zhiyin/mcp";
import type { PluginView, Plugins } from "@zhiyin/plugins";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  gitConnection,
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
): Plugins {
  let views = [...initial];
  const refuse = async (): Promise<never> => {
    throw new Error("not used here");
  };
  return {
    list: async () => views,
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
  };
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
    manage: async () =>
      options.connections ?? [connection("browser", { builtIn: true })],
    retryFailed: note("mcp.retryFailed"),
    builtInIds: () => ["browser", "git"],
    setToolEnabled: note("mcp.setToolEnabled"),
    test: async () => ({ ok: true, tools: [] }),
    saveToken: note("mcp.saveToken"),
    clearToken: note("mcp.clearToken"),
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
    execute: async (name, _args, _signal, identity, scope, excluded) => {
      asked.push(["mcp.execute", name, scope, excluded]);
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
      execute: async (name) => ({ ok: true, value: `built-in ${name}` }),
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
        activated: false,
      },
      {
        id: "deep-research",
        name: "Deep Research",
        purpose: "Find and verify sources.",
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
});

describe("a call handed back", () => {
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
      undefined,
      "server-identity",
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
    ).toEqual({ ok: false, reason: "Choose one offered skill by id." });
    expect(
      await capabilities.execute(
        "conversation-1",
        "skill",
        "load_skill",
        unoffered,
      ),
    ).toEqual({ ok: false, reason: "Choose one offered skill by id." });
    expect(
      await capabilities.execute("conversation-2", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({ ok: false, reason: "Choose one offered skill by id." });
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
    ).toEqual({ ok: false, reason: "Choose one offered skill by id." });
    expect(
      await capabilities.inspect("conversation-1", "skill", "load_skill", {
        id: "software-engineering/test-first",
      }),
    ).toEqual({
      ok: true,
      action: "Read skill instructions",
      target: "software-engineering/test-first",
      command: 'load_skill({"id":"software-engineering/test-first"})',
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
    ).toEqual({ ok: false, reason: "Choose one offered skill by id." });
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

  it("closes one conversation's browser and connections without closing the others", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.closeConversation("conversation-1");

    expect(asked).toEqual([
      ["browsers.close", "conversation-1"],
      ["mcp.shutdownScope", "conversation-1"],
    ]);
  });

  it("lets go of a deleted conversation's browser and connections", async () => {
    const { capabilities, asked } = membersRecording();

    await capabilities.forgetConversation("conversation-1");

    expect(asked).toEqual([
      ["browsers.forget", "conversation-1"],
      ["mcp.shutdownScope", "conversation-1"],
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

  it("declares every package connector to the connection feature, off when its plugin or itself is off", async () => {
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
      },
    ]);
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
        return { conversationId } as unknown as BrowserAutomation;
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

describe("git as a built-in connection", () => {
  function fakeAutomation() {
    const inspected: string[] = [];
    const automation: GitAutomation = {
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
