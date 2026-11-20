import type {
  CatalogEntry,
  CatalogEntryKind,
  CommandFileChanges,
  CommandOutput,
  RunningCommand,
  ActionDetail,
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  KnowledgeSource,
  McpConnectionTestOutcome,
  ConnectionToolTreatment,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
  PluginState,
  SetupSuggestion,
  ShellAvailability,
  ToolCallInspection,
  ToolchainState,
  ToolInvocationResult,
  ToolOwner,
  ToolSpec,
} from "@zhiyin/contract";
import { catalogIndex, type CatalogIndex } from "@zhiyin/catalog-search";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";
import type { DeclaredMcpServer, McpServers } from "@zhiyin/mcp";
import type { Plugins, PluginView } from "@zhiyin/plugins";
import type { Toolchains } from "@zhiyin/toolchains";
import type { ConversationScenes } from "@zhiyin/blender-studio";
import type { ShellCommands, ToolRegistry } from "@zhiyin/tools";
import {
  activePlugins,
  authoredContentsOf,
  componentContentOf,
  damagedPluginState,
  declaredConnections,
  enabledSpecialists,
  pluginContentsDetails,
  pluginContentsOf,
  pluginDirectoryFrom,
  pluginStatesFrom,
  setupSuggestionFor,
  withheldConnectionIds,
  type AppConnectionFact,
  type ConnectorFacts,
  type PluginContents,
} from "./plugin-directory.js";
import {
  catalogEntries,
  catalogSignature,
  enabledToolkits,
  toolkitIdsOf,
  type DescribedTools,
} from "./catalog.js";
import { openEntry } from "./catalog-opening.js";
import type {
  CapabilityLifecycle,
  CapabilityOverview,
  CapabilityTools,
  CatalogOpening,
  CommandWatch,
  ConnectionManagement,
  ExecuteOptions,
  PluginManagement,
  Skill,
  ToolGathering,
} from "./roles.js";

/**
 * Which external program an application connection needs, by connection id.
 * A connection absent here needs none.
 */
export type ConnectionToolchains = Readonly<Record<string, readonly string[]>>;

/**
 * What a connection makes with its programs once they are installed, such as
 * an environment uv makes, as part of installing it: told in the same terms as
 * a program, so a person agrees to it with them, and made only when the
 * connector is installed.
 */
export type ConnectionSetup = {
  /** Ready, missing with what making it downloads, under way, or failed. */
  state(): Promise<ToolchainState>;
  /** Makes it, rejecting when it cannot; the signal stops it. */
  install(signal?: AbortSignal): Promise<void>;
};

/** What each application connection makes once its programs are there, by connection id. */
export type ConnectionSetups = Readonly<Record<string, ConnectionSetup>>;

export type CapabilityMembers = {
  readonly tools: ToolRegistry;
  /** The jobs a conversation's commands carry on as, where they can. */
  readonly commands?: ShellCommands;
  readonly mcp: McpServers;
  readonly plugins: Plugins;
  readonly toolchains: Toolchains;
  readonly connectionToolchains: ConnectionToolchains;
  /** What a connection makes with its programs, as it is installed. */
  readonly connectionSetups?: ConnectionSetups;
  /**
   * The browsers conversations drive. This group never opens one — it reaches
   * them only to let go of what a conversation holds, so stopping, leaving a
   * conversation alone, deleting and shutting down each have one place to ask.
   */
  readonly browsers: ConversationBrowsers;
  /** Each conversation's Blender, let go of the same way as its browser. */
  readonly scenes?: Pick<ConversationScenes, "close" | "forget" | "closeAll">;
  /** Each conversation's CAD studio records, let go of when it is deleted. */
  readonly cad?: { readonly forget: (conversationId: string) => Promise<void> };
  /**
   * What features know beyond their tools, for the catalog: toolkits' words,
   * reference pages and functions, and known API changes (ADR 0017, 0024).
   */
  readonly knowledge?: readonly KnowledgeSource[];
};

/** The answer to a call for an owner that offers no tools: a skill or a plugin. */
function notOffered(name: string): string {
  return `“${name}” is not offered.`;
}

/** A tool as a core tool: without the toolkit a small plugin's tool may name. */
function asCore(tool: ToolSpec): ToolSpec {
  if (!tool.toolkit) return tool;
  const core: { -readonly [K in keyof ToolSpec]: ToolSpec[K] } = { ...tool };
  delete core.toolkit;
  return core;
}

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

/**
 * The installed packages that cannot be read right now, whose connectors keep
 * their saved keys and choices until they open again.
 */
export async function unreadablePackagesOf(
  plugins: Plugins,
): Promise<readonly string[]> {
  return (await plugins.damaged()).map((plugin) => plugin.name);
}

export class ComposedCapabilities
  implements
    CapabilityTools,
    CapabilityOverview,
    PluginManagement,
    ConnectionManagement,
    CommandWatch,
    CapabilityLifecycle
{
  readonly #members: CapabilityMembers;
  /**
   * The plugins each conversation's turn was last offered as active: only
   * their connections can be reached.
   */
  readonly #offered = new Map<string, ReadonlySet<string>>();
  /**
   * The catalog's index, kept until the entries it was built from change, as
   * when a plugin is switched off or a source's pages are built: building one
   * of thousands of entries costs far more than telling whether they changed.
   */
  #index: { readonly built: string; readonly index: CatalogIndex } | undefined;

  constructor(members: CapabilityMembers) {
    this.#members = members;
  }

  async toolsFor(
    conversationId: string,
    options: {
      readonly skills: boolean;
      readonly activatedPlugins?: readonly string[];
      readonly onConnecting?: (connectionName: string) => void;
    },
  ): Promise<ToolGathering> {
    const { tools, mcp, plugins } = this.#members;
    const activated = new Set(options.activatedPlugins ?? []);
    const views = await plugins.list().catch(() => undefined);
    const active = views ? activePlugins(views, activated) : [];
    const skills: Skill[] = options.skills
      ? (views ?? [])
          .filter((view) => view.enabled)
          .flatMap((view) =>
            view.skills
              .filter((skill) => skill.enabled)
              .map(({ id, name, description }) => ({ id, name, description })),
          )
      : [];
    this.#offered.set(
      conversationId,
      new Set(active.map((view) => view.manifest.name)),
    );
    const described = views ? await this.#described() : new Map();
    // Read once each built-in has said whether it can work here, so a
    // browser missing from this computer is known without reaching it.
    const facts = views
      ? await this.#facts().catch(() => undefined)
      : undefined;
    const { toolkits, refused } = enabledToolkits(views ?? [], described);
    if (refused) return { ok: false, reason: refused };
    const builtIn = tools.list(conversationId);
    // Without the plugin list nothing can be shown to belong to an activated
    // plugin, so every connection is withheld.
    const withheld = views
      ? withheldConnectionIds(views, activated, mcp.builtInIds())
      : undefined;
    const connected = withheld
      ? await mcp
          .availableTools(conversationId, withheld, options.onConnecting)
          .catch(() => [])
      : [];
    const loaded = new Set(
      toolkits.flatMap((toolkit) => toolkit.tools.map((tool) => tool.name)),
    );
    // A toolkit's tools load when it is opened; every other connection tool
    // of an active plugin is core, a tag a small plugin's tool carries
    // included.
    const core = connected.filter((tool) => !loaded.has(tool.name)).map(asCore);
    const owners = new Map<string, ToolOwner>();
    const claimed = [
      ...builtIn.map((tool) => [tool.name, "built-in"] as const),
      ...[...core, ...toolkits.flatMap((toolkit) => toolkit.tools)].map(
        (tool) => [tool.name, "mcp"] as const,
      ),
    ];
    for (const [name, owner] of claimed) {
      if (owners.has(name))
        return {
          ok: false,
          reason: `The tool “${name}” is registered more than once.`,
        };
      owners.set(name, owner);
    }
    return {
      ok: true,
      value: {
        tools: [...builtIn, ...core],
        skills,
        specialists: views ? enabledSpecialists(views) : [],
        pluginDirectory: views
          ? pluginDirectoryFrom(
              views,
              (view) => toolkitIdsOf(view, described),
              facts,
            )
          : [],
        toolkits,
        ownerOf: (name) => owners.get(name),
      },
    };
  }

  async catalogFind(
    _conversationId: string,
    query: string,
    kind?: CatalogEntryKind,
  ): Promise<readonly CatalogEntry[]> {
    const views = await this.#members.plugins.list();
    const { toolkits, refused } = enabledToolkits(
      views,
      await this.#described(),
    );
    if (refused) throw new Error(refused);
    const entries = await catalogEntries(
      views,
      toolkits,
      this.#members.knowledge ?? [],
    );
    const built = catalogSignature(entries);
    if (this.#index?.built !== built)
      this.#index = { built, index: catalogIndex(entries) };
    return this.#index.index
      .find(query, kind ? { kind } : {})
      .map((match) => match.entry);
  }

  async catalogOpen(
    conversationId: string,
    id: string,
  ): Promise<CatalogOpening> {
    const { mcp, plugins } = this.#members;
    const views = await plugins.list().catch(() => undefined);
    if (!views)
      return { ok: false, reason: "The plugins cannot be read right now." };
    return openEntry(id, {
      views,
      described: await this.#described(),
      knowledge: this.#members.knowledge ?? [],
      // Every other connection is withheld, so only this one is reached.
      reach: async (server) =>
        mcp.availableTools(
          conversationId,
          [
            ...views.flatMap((view) => view.mcpServers.map((item) => item.id)),
            ...mcp.builtInIds(),
          ].filter((item) => item !== server.id),
        ),
    });
  }

  async pluginContents(id: string): Promise<PluginContents | undefined> {
    const view = await this.#view(id);
    if (!view?.enabled) return undefined;
    const states = await this.pluginStates();
    return pluginContentsOf(
      view,
      states.find((state) => state.id === id),
    );
  }

  describePluginContents(contents: PluginContents): readonly ActionDetail[] {
    return pluginContentsDetails(contents);
  }

  async connectorSetup(id: string): Promise<SetupSuggestion | undefined> {
    const views = await this.#members.plugins.list();
    await this.#described();
    return setupSuggestionFor(views, id, await this.#facts());
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
    if (owner === "skill" || owner === "plugin")
      return { ok: false, reason: notOffered(name) };
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
    { signal, identity, answerTokens }: ExecuteOptions = {},
  ): Promise<ToolInvocationResult> {
    if (owner === "built-in")
      return this.#members.tools.execute(
        name,
        args,
        signal,
        conversationId,
        answerTokens,
      );
    if (owner === "mcp")
      return this.#members.mcp.execute(name, args, {
        signal,
        expectedIdentity: identity,
        scope: conversationId,
        excludedServerIds: await this.#withheldFor(conversationId),
      });
    return { ok: false, reason: notOffered(name) };
  }

  get completeUserInput(): CapabilityTools["completeUserInput"] {
    const { tools } = this.#members;
    const complete = tools.completeUserInput;
    return complete
      ? (name, args, response) => complete.call(tools, name, args, response)
      : undefined;
  }

  async stopConversation(conversationId: string): Promise<void> {
    await this.#members.commands?.stopCommands(conversationId);
  }

  async restConversation(conversationId: string): Promise<void> {
    const { browsers, scenes } = this.#members;
    await Promise.all([
      browsers.close(conversationId),
      scenes?.close(conversationId),
    ]);
  }

  async modelChanged(): Promise<void> {
    await this.#members.mcp.listBuiltInsAgain();
  }

  async forgetConversation(conversationId: string): Promise<void> {
    const { browsers, mcp, scenes, cad } = this.#members;
    this.#offered.delete(conversationId);
    await Promise.all([
      browsers.forget(conversationId),
      scenes?.forget(conversationId),
      cad?.forget(conversationId),
      mcp.shutdownScope(conversationId),
      this.#members.commands?.stopCommands(conversationId),
    ]);
  }

  async shutdown(): Promise<void> {
    const { browsers, mcp, commands, scenes } = this.#members;
    await Promise.all([
      browsers.closeAll(),
      scenes?.closeAll(),
      mcp.shutdownAll(),
      commands?.stopAllCommands(),
    ]);
  }

  onCommandEnded(
    listener: (conversationId: string, notice: string, wakes: boolean) => void,
  ): void {
    this.#members.commands?.onCommandEnded(listener);
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
    const { plugins } = this.#members;
    const [views, damaged] = await Promise.all([
      plugins.list(),
      plugins.damaged(),
    ]);
    const connections = knownConnections ?? (await this.#members.mcp.states());
    const { appConnections } = await this.#facts(connections);
    return [
      ...pluginStatesFrom(views, connections, appConnections),
      ...damaged.map(damagedPluginState),
    ];
  }

  /** What each connection last answered and what each built-in has of its programs; reaches none. */
  async #facts(known?: readonly McpServerState[]): Promise<ConnectorFacts> {
    const connections = known ?? (await this.#members.mcp.states());
    const appConnections = new Map<string, AppConnectionFact>();
    for (const state of connections.filter((item) => item.builtIn)) {
      const toolchain = await this.#toolchainOf(state.id);
      appConnections.set(state.id, {
        state,
        ...(toolchain ? { toolchain } : {}),
      });
    }
    return {
      connections: new Map(connections.map((state) => [state.id, state])),
      appConnections,
    };
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

  async installToolchain(
    componentId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const connector = (await this.#members.plugins.list())
      .flatMap((view) => view.appConnectors)
      .find((item) => item.id === componentId);
    const programs = connector
      ? (this.#members.connectionToolchains[connector.connector] ?? [])
      : [];
    const setup = connector
      ? this.#members.connectionSetups?.[connector.connector]
      : undefined;
    if (!programs.length && !setup)
      throw new Error("This connector does not need anything installed.");
    for (const program of programs) {
      signal?.throwIfAborted();
      await (signal
        ? this.#members.toolchains.install(program, signal)
        : this.#members.toolchains.install(program));
    }
    signal?.throwIfAborted();
    if (setup) await (signal ? setup.install(signal) : setup.install());
    await this.#members.mcp.retryFailed();
  }

  /** What each connection last answered; reaches none of them. */
  connections(): Promise<readonly McpServerState[]> {
    return this.#members.mcp.states();
  }

  /** Reaches one configured connection now, as a person asked. */
  checkConnection(id: string): Promise<McpServerState> {
    return this.#members.mcp.check(id);
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

  setConnectionToolTreatment(
    id: string,
    toolName: string,
    treatment: ConnectionToolTreatment,
    shown: string,
  ): Promise<void> {
    return this.#members.mcp.setToolTreatment(id, toolName, treatment, shown);
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

  signInToConnection(
    id: string,
    signal: AbortSignal,
  ): Promise<McpSignInOutcome> {
    return this.#members.mcp.signIn(id, signal);
  }

  shellAvailability(): ShellAvailability {
    return (
      this.#members.tools.shellAvailability?.() ?? unknownShellAvailability
    );
  }

  recheckShell(): ShellAvailability {
    return this.#members.tools.recheckShell?.() ?? this.shellAvailability();
  }

  runningCommands(conversationId: string): readonly RunningCommand[] {
    return this.#members.commands?.runningCommands(conversationId) ?? [];
  }

  async commandOutput(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined> {
    return this.#members.commands?.commandOutput(conversationId, jobId);
  }

  async stopCommandForPerson(
    conversationId: string,
    jobId: string,
  ): Promise<void> {
    await this.#members.commands?.stopCommandForPerson(conversationId, jobId);
  }

  onJobChanges(
    watcher: (
      conversationId: string,
      job: string,
      changes: CommandFileChanges,
    ) => void,
  ): void {
    this.#members.commands?.onJobChanges(watcher);
  }

  onCommandsChanged(watcher: (conversationId: string) => void): void {
    this.#members.commands?.onCommandsChanged(watcher);
  }

  async #view(id: string): Promise<PluginView | undefined> {
    return (await this.#members.plugins.list()).find(
      (view) => view.manifest.name === id,
    );
  }

  /**
   * What each built-in connection offers, from what it says of itself: no
   * conversation's connection is opened for it. One that cannot say offers
   * nothing.
   */
  async #described(): Promise<DescribedTools> {
    return (
      (await this.#members.mcp.builtInTools?.().catch(() => undefined)) ??
      new Map()
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
        ...(await mcp.states().catch(() => [])).map((item) => item.id),
      ];
    return withheldConnectionIds(
      views,
      this.#offered.get(conversationId) ?? new Set(),
      mcp.builtInIds(),
    );
  }

  /**
   * What a connection still needs, as one answer: everything that would be
   * downloaded, not only the first missing program, and what is made with
   * them, so a person agrees to the whole of it.
   */
  async #toolchainOf(
    connectionId: string,
  ): Promise<ToolchainState | undefined> {
    const programs = this.#members.connectionToolchains[connectionId] ?? [];
    const setup = this.#members.connectionSetups?.[connectionId];
    if (!programs.length && !setup) return undefined;
    const states = await Promise.all(
      programs.map((program) => this.#members.toolchains.state(program)),
    );
    const made = await setup?.state();
    const failed = [...states, ...(made ? [made] : [])].find(
      (state) => state.status === "failed",
    );
    if (failed) return failed;
    // What is made comes last, and says which step it is on.
    if (made?.status === "installing") return made;
    // What has arrived of the programs still to come. What is made after
    // them is not counted: its download cannot be followed byte by byte.
    if (states.some((state) => state.status === "installing")) {
      let received = 0;
      let bytes = 0;
      for (const state of states)
        if (state.status === "installing") {
          received += state.received ?? 0;
          bytes += state.bytes ?? 0;
        } else if (state.status === "missing")
          for (const item of state.downloads) bytes += item.bytes;
      return { status: "installing", received, bytes };
    }
    const downloads = [
      ...states.flatMap((state) =>
        state.status === "missing" ? state.downloads : [],
      ),
      ...(made?.status === "missing" ? made.downloads : []),
    ];
    return downloads.length || made?.status === "missing"
      ? { status: "missing", downloads }
      : { status: "ready" };
  }
}
