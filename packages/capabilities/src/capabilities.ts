import type {
  ActionDetail,
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  PluginDirectoryEntry,
  PluginState,
  ShellAvailability,
  SpecialistDefinition,
  ToolCallInspection,
  ToolchainState,
  ToolInvocationResult,
  ToolOwner,
  ToolSpec,
  UserInputResponse,
} from "@zhiyin/contract";
import type {
  AutomationTool,
  BrowserAutomation,
  ConversationBrowsers,
} from "@zhiyin/interactive-browser";
import type { GitAutomation } from "@zhiyin/git-connector";
import type { CompilerAutomation } from "@zhiyin/document-compiler";
import type { SandboxAutomation } from "@zhiyin/python-sandbox";
import type {
  BuiltInMcpServer,
  DeclaredMcpServer,
  McpServers,
} from "@zhiyin/mcp";
import type { Plugins, PluginView } from "@zhiyin/plugins";
import type { Toolchains } from "@zhiyin/toolchains";
import type { ToolRegistry } from "@zhiyin/tools";
import {
  activePlugins,
  activeSpecialists,
  authoredContentsOf,
  componentContentOf,
  declaredConnections,
  inspectPluginTool,
  pluginContentsDetails,
  pluginContentsOf,
  pluginDirectoryFrom,
  pluginStatesFrom,
  singleIdArg,
  withheldConnectionIds,
  type AppConnectionFact,
  type PluginContents,
} from "./plugin-directory.js";

/** A skill as the model is told about it. */
export type Skill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

/**
 * Which external program an application connection needs, by connection id.
 * A connection absent here needs none.
 */
export type ConnectionToolchains = Readonly<Record<string, readonly string[]>>;

export type CapabilityMembers = {
  readonly tools: ToolRegistry;
  readonly mcp: McpServers;
  readonly plugins: Plugins;
  readonly toolchains: Toolchains;
  readonly connectionToolchains: ConnectionToolchains;
  /**
   * The browsers conversations drive. This group never opens one — it reaches
   * them only to let go of what a conversation holds, so stopping, deleting and
   * shutting down each have one place to ask.
   */
  readonly browsers: ConversationBrowsers;
};

/** What one conversation's turn may call. */
export type ConversationTools = {
  /** Every tool the model is offered, in the order it is offered. */
  readonly tools: readonly ToolSpec[];
  /** The skills of activated plugins, which the model is told about by name. */
  readonly skills: readonly Skill[];
  /** Specialists of activated plugins a turn may delegate to. */
  readonly specialists: readonly SpecialistDefinition[];
  /**
   * Every enabled plugin's compact identity, in place of its full skills,
   * specialists, and connectors until it is activated.
   */
  readonly pluginDirectory: readonly PluginDirectoryEntry[];
  /** Who answers for a name; nothing for a name nobody offered. */
  readonly ownerOf: (name: string) => ToolOwner | undefined;
};

export type ToolGathering =
  | { readonly ok: true; readonly value: ConversationTools }
  | { readonly ok: false; readonly reason: string };

export interface Capabilities {
  /**
   * Gathers the tools a conversation may call. A source that cannot answer
   * offers nothing rather than failing the turn; two sources claiming one
   * name fail it, because a call could then reach the wrong implementation.
   */
  toolsFor(
    conversationId: string,
    options: {
      readonly skills: boolean;
      /** Plugin ids activated in this conversation so far. */
      readonly activatedPlugins?: readonly string[];
    },
  ): Promise<ToolGathering>;
  /** A built-in tool's own description, when there is such a tool. */
  builtInTool(name: string): ToolSpec | undefined;
  /** One enabled plugin's components by name and purpose, or nothing for an unknown or disabled id. */
  pluginContents(id: string): Promise<PluginContents | undefined>;
  /** The same components arranged for a readable action result. */
  describePluginContents(contents: PluginContents): readonly ActionDetail[];
  /** An app-made plugin's whole content, or nothing for any other plugin. */
  editablePluginContents(
    id: string,
  ): Promise<AuthoredPluginContents | undefined>;
  /** A skill's or specialist's full content, or nothing for an unknown id. */
  componentContent(id: string): Promise<ComponentContent | undefined>;
  inspect(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection>;
  execute(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
    signal?: AbortSignal,
    identity?: string,
  ): Promise<ToolInvocationResult>;
  /** Present only when the built-in tools can accept a person's answer. */
  readonly completeUserInput:
    | ((
        name: string,
        args: unknown,
        response: UserInputResponse,
      ) => Promise<ToolInvocationResult>)
    | undefined;
  /**
   * Closes this conversation's browser and its connections, and leaves every
   * other conversation's open. The conversation itself remains, so its next
   * turn starts a fresh browser.
   */
  closeConversation(conversationId: string): Promise<void>;
  /**
   * Lets go of everything a conversation held, for one that is gone. Nothing is
   * kept for it, because nothing will ask for it again.
   */
  forgetConversation(conversationId: string): Promise<void>;
  shutdown(): Promise<void>;

  /** What a person may say they are here to do: the built-in plugins. */
  interests(): Promise<readonly string[]>;
  /** Switches the built-in plugins on or off to match a person's interests. */
  applyInterests(interests: readonly string[]): Promise<void>;

  /** Installed packages joined to the current state of what they contain. */
  pluginStates(
    connections?: readonly McpServerState[],
  ): Promise<readonly PluginState[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  setComponentEnabled(id: string, enabled: boolean): Promise<void>;
  overrideComponent(id: string, content: ComponentContentDraft): Promise<void>;
  resetComponent(id: string): Promise<void>;
  /** Validates and stores a copy from a local directory. Refused for a built-in name. */
  installPlugin(sourceDirectory: string): Promise<void>;
  /** Replaces the active version with a newer one, keeping the previous for rollback. */
  updatePlugin(id: string, sourceDirectory: string): Promise<void>;
  /** Restores the version an update replaced. */
  rollbackPlugin(id: string): Promise<void>;
  removePlugin(id: string): Promise<void>;
  /** Creates an empty plugin, ready for skills, specialists, and connectors. */
  createPlugin(displayName: string, description: string): Promise<void>;
  /** Replaces an app-made plugin's skills, specialists, and connectors. */
  savePluginContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void>;
  /** Installs the program an application connector needs. */
  installToolchain(componentId: string): Promise<void>;

  connections(): Promise<readonly McpServerState[]>;
  /** Tries failed connections again on the next look. */
  retryConnections(): Promise<void>;
  setConnectionToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void>;
  /** A dry run against an endpoint and (optional) token, saving nothing. */
  testConnection(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;
  saveConnectionToken(id: string, token: string): Promise<void>;
  clearConnectionToken(id: string): Promise<void>;

  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): ShellAvailability;
  /** Re-detects the shell without restarting, so a fixed prerequisite is picked up. */
  recheckShell(): ShellAvailability;
}

/** Says what was wrong with the call and what would have been right. */
function unofferedSkill(
  args: unknown,
  offered: ReadonlySet<string> | undefined,
): string {
  const available = offered?.size
    ? `Available: ${[...offered].join(", ")}.`
    : "No skills are available in this conversation.";
  const id = singleIdArg(args);
  return id
    ? `No skill with the id “${id}” is available here. ${available}`
    : `Pass exactly one argument, “id”, naming a skill. ${available}`;
}

const loadSkillTool: ToolSpec = {
  name: "load_skill",
  description: "Load the instructions of an offered skill by its id.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
};

/** Only reached by a `ToolRegistry` that does not report shell state at all. */
const unknownShellAvailability: ShellAvailability = {
  available: false,
  reason: "Shell availability could not be checked here.",
  installUrl: "https://git-scm.com/download/win",
};

/**
 * The packages' connectors, for the connection feature to connect. Wired in
 * the composition root, where the connection feature is constructed before
 * this group exists.
 */
export async function declaredConnectionsOf(
  plugins: Plugins,
): Promise<readonly DeclaredMcpServer[]> {
  return declaredConnections(await plugins.list());
}

export class ComposedCapabilities implements Capabilities {
  readonly #members: CapabilityMembers;
  /**
   * What each conversation's turn was last offered. Only an offered skill can
   * be loaded, and only an activated plugin's connections can be reached.
   */
  readonly #offered = new Map<
    string,
    {
      readonly skills: ReadonlySet<string>;
      readonly plugins: ReadonlySet<string>;
    }
  >();

  constructor(members: CapabilityMembers) {
    this.#members = members;
  }

  async toolsFor(
    conversationId: string,
    options: {
      readonly skills: boolean;
      readonly activatedPlugins?: readonly string[];
    },
  ): Promise<ToolGathering> {
    const { tools, mcp, plugins } = this.#members;
    const activated = new Set(options.activatedPlugins ?? []);
    const views = await plugins.list().catch(() => undefined);
    const active = views ? activePlugins(views, activated) : [];
    const skills: Skill[] = options.skills
      ? active.flatMap((view) =>
          view.skills
            .filter((skill) => skill.enabled)
            .map(({ id, name, description }) => ({ id, name, description })),
        )
      : [];
    this.#offered.set(conversationId, {
      skills: new Set(skills.map((skill) => skill.id)),
      plugins: new Set(active.map((view) => view.manifest.name)),
    });
    const builtIn = tools.list();
    // Without the plugin list nothing can be shown to belong to an activated
    // plugin, so every connection is withheld.
    const withheld = views
      ? withheldConnectionIds(views, activated, mcp.builtInIds())
      : undefined;
    const connected = withheld
      ? await mcp.availableTools(conversationId, withheld).catch(() => [])
      : [];
    const specialists = views ? activeSpecialists(views, activated) : [];
    const pluginDirectory = views ? pluginDirectoryFrom(views, activated) : [];
    const owners = new Map<string, ToolOwner>();
    if (skills.length) owners.set(loadSkillTool.name, "skill");
    if (pluginDirectory.length) owners.set(inspectPluginTool.name, "plugin");
    for (const tool of builtIn) {
      if (owners.has(tool.name))
        return {
          ok: false,
          reason: `The tool “${tool.name}” is registered more than once.`,
        };
      owners.set(tool.name, "built-in");
    }
    for (const tool of connected) {
      if (owners.has(tool.name))
        return {
          ok: false,
          reason: `The tool “${tool.name}” is registered more than once.`,
        };
      owners.set(tool.name, "mcp");
    }
    return {
      ok: true,
      value: {
        tools: [
          ...builtIn,
          ...connected,
          ...(skills.length ? [loadSkillTool] : []),
          ...(pluginDirectory.length ? [inspectPluginTool] : []),
        ],
        skills,
        specialists,
        pluginDirectory,
        ownerOf: (name) => owners.get(name),
      },
    };
  }

  builtInTool(name: string): ToolSpec | undefined {
    return this.#members.tools.list().find((tool) => tool.name === name);
  }

  async pluginContents(id: string): Promise<PluginContents | undefined> {
    const view = await this.#view(id);
    return view?.enabled ? pluginContentsOf(view) : undefined;
  }

  describePluginContents(contents: PluginContents): readonly ActionDetail[] {
    return pluginContentsDetails(contents);
  }

  async editablePluginContents(
    id: string,
  ): Promise<AuthoredPluginContents | undefined> {
    const view = await this.#view(id);
    return view ? authoredContentsOf(view) : undefined;
  }

  async componentContent(id: string): Promise<ComponentContent | undefined> {
    return componentContentOf(await this.#members.plugins.list(), id);
  }

  async inspect(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection> {
    if (owner === "skill") {
      const id = singleIdArg(args);
      const offered = this.#offered.get(conversationId)?.skills;
      if (id && offered?.has(id))
        return {
          ok: true,
          action: "Read skill instructions",
          target: id,
          command: `load_skill(${JSON.stringify(args)})`,
        };
      // A wrong id is the model's to fix once it is told what is on offer.
      return {
        ok: false,
        reason: unofferedSkill(args, offered),
        ...(offered?.size ? { correctable: true } : {}),
      };
    }
    if (owner === "plugin") {
      const id = singleIdArg(args);
      const view = id ? await this.#view(id) : undefined;
      if (!view?.enabled)
        return { ok: false, reason: "Choose one enabled plugin by id." };
      const pluginName = view.manifest.displayName;
      return {
        ok: true,
        action: `Inspect ${pluginName}`,
        target: pluginName,
        command: `inspect_plugin(${JSON.stringify(args)})`,
        detail:
          "Shows this plugin's skills, specialists, and connectors without activating it.",
        presentation: {
          title: `Inspect ${pluginName}`,
          description: `See what the ${pluginName} plugin includes before using it.`,
        },
        invocation: {
          name: "Inspect plugin",
          arguments: [{ name: "Plugin", value: pluginName }],
        },
      };
    }
    if (owner === "built-in")
      return this.#members.tools.inspect(name, args, conversationId);
    return this.#members.mcp.inspect(
      name,
      args,
      conversationId,
      await this.#withheldFor(conversationId),
    );
  }

  async execute(
    conversationId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
    signal?: AbortSignal,
    identity?: string,
  ): Promise<ToolInvocationResult> {
    if (owner === "built-in")
      return this.#members.tools.execute(name, args, signal, conversationId);
    if (owner === "mcp")
      return this.#members.mcp.execute(
        name,
        args,
        signal,
        identity,
        conversationId,
        await this.#withheldFor(conversationId),
      );
    if (owner === "plugin") {
      const id = singleIdArg(args);
      if (!id) return { ok: false, reason: "Choose one enabled plugin by id." };
      const contents = await this.pluginContents(id);
      return contents
        ? {
            ok: true,
            value: contents,
            details: pluginContentsDetails(contents),
          }
        : { ok: false, reason: `“${id}” is not an enabled plugin.` };
    }
    const id = singleIdArg(args);
    const offered = this.#offered.get(conversationId)?.skills;
    if (!id || !offered?.has(id))
      return { ok: false, reason: unofferedSkill(args, offered) };
    // Checked again at the moment of loading: the plugin or the skill may
    // have been switched off since the turn began.
    const views = await this.#members.plugins.list();
    const owning = views.find((view) =>
      view.skills.some((skill) => skill.id === id),
    );
    const skill = owning?.skills.find((item) => item.id === id);
    if (!owning || !skill)
      return { ok: false, reason: "The skill no longer exists." };
    if (!owning.enabled)
      return {
        ok: false,
        reason: `The ${owning.manifest.displayName} plugin is turned off.`,
      };
    if (!skill.enabled)
      return { ok: false, reason: "That skill is turned off." };
    // The instructions are the whole of what was read. Anything else — the
    // call, the wrapper around it — is machinery.
    return {
      ok: true,
      value: skill.instructions,
      details: [
        { kind: "text", label: "Instructions", text: skill.instructions },
      ],
    };
  }

  get completeUserInput(): Capabilities["completeUserInput"] {
    const { tools } = this.#members;
    const complete = tools.completeUserInput;
    return complete
      ? (name, args, response) => complete.call(tools, name, args, response)
      : undefined;
  }

  async closeConversation(conversationId: string): Promise<void> {
    const { browsers, mcp } = this.#members;
    await Promise.all([
      browsers.close(conversationId),
      mcp.shutdownScope(conversationId),
    ]);
  }

  async forgetConversation(conversationId: string): Promise<void> {
    const { browsers, mcp } = this.#members;
    this.#offered.delete(conversationId);
    await Promise.all([
      browsers.forget(conversationId),
      mcp.shutdownScope(conversationId),
    ]);
  }

  async shutdown(): Promise<void> {
    const { browsers, mcp } = this.#members;
    await Promise.all([browsers.closeAll(), mcp.shutdownAll()]);
  }

  interests(): Promise<readonly string[]> {
    return this.#members.plugins.builtInNames();
  }

  /**
   * Doing this again with the same interests changes nothing, which is what
   * lets an interrupted profile be finished on the next launch.
   */
  async applyInterests(interests: readonly string[]): Promise<void> {
    const { plugins } = this.#members;
    for (const name of await plugins.builtInNames())
      await plugins.setEnabled(name, interests.includes(name));
  }

  async pluginStates(
    knownConnections?: readonly McpServerState[],
  ): Promise<readonly PluginState[]> {
    const views = await this.#members.plugins.list();
    const connections = knownConnections ?? (await this.#members.mcp.manage());
    const facts = new Map<string, AppConnectionFact>();
    for (const state of connections.filter((item) => item.builtIn)) {
      const toolchain = await this.#toolchainOf(state.id);
      facts.set(state.id, { state, ...(toolchain ? { toolchain } : {}) });
    }
    return pluginStatesFrom(views, connections, facts);
  }

  setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    return this.#members.plugins.setEnabled(id, enabled);
  }

  setComponentEnabled(id: string, enabled: boolean): Promise<void> {
    return this.#members.plugins.setComponentEnabled(id, enabled);
  }

  overrideComponent(id: string, content: ComponentContentDraft): Promise<void> {
    return this.#members.plugins.overrideComponent(id, content);
  }

  resetComponent(id: string): Promise<void> {
    return this.#members.plugins.resetComponent(id);
  }

  installPlugin(sourceDirectory: string): Promise<void> {
    return this.#members.plugins.install(sourceDirectory);
  }

  updatePlugin(id: string, sourceDirectory: string): Promise<void> {
    return this.#members.plugins.update(id, sourceDirectory);
  }

  rollbackPlugin(id: string): Promise<void> {
    return this.#members.plugins.rollback(id);
  }

  removePlugin(id: string): Promise<void> {
    return this.#members.plugins.remove(id);
  }

  createPlugin(displayName: string, description: string): Promise<void> {
    return this.#members.plugins.create(displayName, description);
  }

  savePluginContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void> {
    return this.#members.plugins.saveContents(id, contents);
  }

  async installToolchain(componentId: string): Promise<void> {
    const connector = (await this.#members.plugins.list())
      .flatMap((view) => view.appConnectors)
      .find((item) => item.id === componentId);
    const programs = connector
      ? (this.#members.connectionToolchains[connector.connector] ?? [])
      : [];
    if (!programs.length)
      throw new Error("This connector does not need anything installed.");
    for (const program of programs)
      await this.#members.toolchains.install(program);
    await this.#members.mcp.retryFailed();
  }

  connections(): Promise<readonly McpServerState[]> {
    return this.#members.mcp.manage();
  }

  retryConnections(): Promise<void> {
    return this.#members.mcp.retryFailed();
  }

  setConnectionToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    return this.#members.mcp.setToolEnabled(id, toolName, enabled);
  }

  testConnection(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> {
    return this.#members.mcp.test(server, token);
  }

  saveConnectionToken(id: string, token: string): Promise<void> {
    return this.#members.mcp.saveToken(id, token);
  }

  clearConnectionToken(id: string): Promise<void> {
    return this.#members.mcp.clearToken(id);
  }

  shellAvailability(): ShellAvailability {
    return (
      this.#members.tools.shellAvailability?.() ?? unknownShellAvailability
    );
  }

  recheckShell(): ShellAvailability {
    return this.#members.tools.recheckShell?.() ?? this.shellAvailability();
  }

  async #view(id: string): Promise<PluginView | undefined> {
    return (await this.#members.plugins.list()).find(
      (view) => view.manifest.name === id,
    );
  }

  /**
   * The connections a conversation may not reach right now: all but those of
   * the plugins its turn activated. Without the plugin list, every
   * connection is withheld.
   */
  async #withheldFor(conversationId: string): Promise<readonly string[]> {
    const { mcp, plugins } = this.#members;
    const views = await plugins.list().catch(() => undefined);
    if (!views)
      return [
        ...mcp.builtInIds(),
        ...(await mcp.manage().catch(() => [])).map((item) => item.id),
      ];
    return withheldConnectionIds(
      views,
      this.#offered.get(conversationId)?.plugins ?? new Set(),
      mcp.builtInIds(),
    );
  }

  /**
   * What a connection still needs, as one answer: everything that would be
   * downloaded, not only the first missing program, so a person agrees to the
   * whole of it.
   */
  async #toolchainOf(
    connectionId: string,
  ): Promise<ToolchainState | undefined> {
    const programs = this.#members.connectionToolchains[connectionId];
    if (!programs?.length) return undefined;
    const states = await Promise.all(
      programs.map((program) => this.#members.toolchains.state(program)),
    );
    const failed = states.find((state) => state.status === "failed");
    if (failed) return failed;
    if (states.some((state) => state.status === "installing"))
      return { status: "installing" };
    const downloads = states.flatMap((state) =>
      state.status === "missing" ? state.downloads : [],
    );
    return downloads.length
      ? { status: "missing", downloads }
      : { status: "ready" };
  }
}

/**
 * The app's own browser, offered to the model as a built-in connection. Each
 * conversation gets its own automation, opened on first use and kept until the
 * conversation is forgotten, so no conversation drives another's page. Its
 * general state — what it offers, and whether it can work here — is described
 * without opening any conversation's browser.
 */
export function browserConnection(
  openAutomation: (conversationId: string) => BrowserAutomation,
  describe: () => Promise<readonly AutomationTool[]>,
): BuiltInMcpServer {
  const automations = new Map<string, BrowserAutomation>();
  const automationFor = (conversationId: string): BrowserAutomation => {
    const existing = automations.get(conversationId);
    if (existing) return existing;
    const created = openAutomation(conversationId);
    automations.set(conversationId, created);
    return created;
  };
  return {
    id: "browser",
    name: "Zhiyin’s browser",
    scope: "conversation",
    describe,
    open: async (conversationId) => {
      if (!conversationId) throw new Error("A conversation is required.");
      return automationFor(conversationId);
    },
    inspect: async (name, args, conversationId) => {
      if (!conversationId)
        return { ok: false, reason: "A conversation is required." };
      return automationFor(conversationId).inspect(name, args);
    },
    describeResult: (name, args, result, conversationId) =>
      conversationId
        ? automationFor(conversationId).describeResult(name, args, result)
        : [],
    forget: async (conversationId) => {
      automations.delete(conversationId);
    },
  };
}

/**
 * The document compiler, offered to the model as a built-in connection. Like
 * git, one connection serves every conversation.
 */
export function documentsConnection(
  automation: CompilerAutomation,
): BuiltInMcpServer {
  return {
    id: "documents",
    name: "Document compiler",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
  };
}

/**
 * The Python sandbox, offered to the model as a built-in connection. One
 * environment serves every conversation, as one installed program would.
 */
export function pythonConnection(
  automation: SandboxAutomation,
): BuiltInMcpServer {
  return {
    id: "python",
    name: "Python sandbox",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
  };
}

/**
 * Local git, offered to the model as a built-in connection. One connection
 * shared by every conversation — unlike the browser, nothing about it is
 * per-conversation state — so there is no scope to key automations by, and
 * no `forget`.
 */
export function gitConnection(automation: GitAutomation): BuiltInMcpServer {
  return {
    id: "git",
    name: "Git",
    open: async () => automation,
    inspect: (name, args) => automation.inspect(name, args),
    describeResult: (name, args, result) =>
      automation.describeResult(name, args, result),
  };
}
