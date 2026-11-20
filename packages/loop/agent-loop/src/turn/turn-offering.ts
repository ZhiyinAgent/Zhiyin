import type { ConversationTools, OfferedToolkit } from "@zhiyin/capabilities";
import type {
  DirectoryReadiness,
  SpecialistDefinition,
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import { fixedModelMessages } from "../context/conversation-context.js";
import { directoryAsSent } from "../context/directory-readiness.js";
import type { ModelHistory } from "../context/model-history.js";
import { selfDescribing } from "../context/self-description.js";
import type { LoopTool } from "../round/loop-tool.js";
import type { Unwrapped } from "../round/round-answers.js";
import { unwrapBridged } from "../tools/bridged-call.js";
import type { ToolRoute } from "../tools/catalog-tools.js";
import {
  bridgedSchemas,
  openedToolkits,
  toldThroughBridge,
  type OpenedToolkit,
} from "../tools/opened-entries.js";
import type { Activation } from "../tools/plugin-activation.js";
import { refusal, type Refusal } from "../tools/refusals.js";
import type { AssembledToolCall } from "./turn-shared.js";

/**
 * Whether a specialist's list names a tool: a connection's tool by the name
 * its connection gives it, when that connection is its plugin's, and any
 * other tool by the name it is offered under.
 */
export function namedBySpecialist(
  specialist: SpecialistDefinition,
  tool: ToolSpec,
): boolean {
  const listed = specialist.tools ?? [];
  return tool.connection
    ? !!specialist.connections?.includes(tool.connection.id) &&
        listed.includes(tool.connection.tool)
    : listed.includes(tool.name);
}

/** What an offering is made from: the folder, the time, and the tools gathered. */
export type OfferingStart = {
  readonly workspace: WorkspaceDescription;
  readonly startedAt: Date;
  readonly timeZone: string | undefined;
  readonly gathered: ConversationTools;
  readonly activatedPlugins: readonly string[];
  /** How a toolkit opened reaches the chosen model. */
  readonly route: ToolRoute;
  /** The directory's marks as the conversation's requests start with them. */
  readonly readiness?: DirectoryReadiness | undefined;
};

/** How what a turn offers is widened: a plugin activated, or the tools gathered again. */
export type OfferingChanges = {
  activate(
    plugin: string,
    activatedPlugins: readonly string[],
  ): Promise<Activation>;
  gatherAgain(
    activatedPlugins: readonly string[],
  ): Promise<ConversationTools | undefined>;
};

/**
 * What a turn offers the model, as it stands: the tools it may call, those
 * the loop answers itself, the toolkits it opened, and the start of its
 * requests. The start names every enabled plugin whether it is active or
 * not, so activating one changes only the tools, by its core tools, once;
 * and a toolkit opened leaves the tools as they were but where the switch
 * says to add it at their end (ADR 0017).
 *
 * What is open is read from the conversation as it was sent, so it holds
 * from turn to turn, and after condensing only as Zhiyin opens it again.
 */
export class TurnOffering {
  readonly workspace: WorkspaceDescription;
  readonly route: ToolRoute;
  /** The tools the loop answers itself, in the order they are offered. */
  readonly loopTools: readonly LoopTool[];
  readonly #startedAt: Date;
  readonly #timeZone: string | undefined;
  readonly #conversation: () => readonly ModelMessage[];
  readonly #changes: OfferingChanges | undefined;
  readonly #readiness: DirectoryReadiness | undefined;
  #gathered: ConversationTools;
  #activatedPlugins: readonly string[];
  #fixedMessages: readonly ModelMessage[];
  readonly #memoryTools: readonly ToolSpec[];

  constructor(
    start: OfferingStart & {
      /** Memory's tools, named in the system prompt (ADR 0026). */
      readonly memoryTools?: readonly ToolSpec[];
      /** The loop's own tools, made for what this offers. */
      readonly loopTools: (offering: TurnOffering) => readonly LoopTool[];
      /** The conversation as it stands, which says what was opened. */
      readonly conversation: () => readonly ModelMessage[];
      /** Absent where nothing is answered, as between turns. */
      readonly changes?: OfferingChanges;
    },
  ) {
    this.workspace = start.workspace;
    this.route = start.route;
    this.#startedAt = start.startedAt;
    this.#timeZone = start.timeZone;
    this.#conversation = start.conversation;
    this.#changes = start.changes;
    this.#readiness = start.readiness;
    this.#gathered = start.gathered;
    this.#activatedPlugins = start.activatedPlugins;
    this.#memoryTools = start.memoryTools ?? [];
    this.#fixedMessages = this.#start();
    this.loopTools = start.loopTools(this);
  }

  get tools(): ConversationTools["tools"] {
    return this.#gathered.tools;
  }

  get specialists(): ConversationTools["specialists"] {
    return this.#gathered.specialists;
  }

  /** The directory as it stands now, which what is opened is checked against. */
  get pluginDirectory(): ConversationTools["pluginDirectory"] {
    return this.#gathered.pluginDirectory;
  }

  get activatedPlugins(): readonly string[] {
    return this.#activatedPlugins;
  }

  /** Who answers for a name, as the tools stand now. */
  get ownerOf(): (name: string) => ToolOwner | undefined {
    return this.#gathered.ownerOf;
  }

  /** The start of every request of the turn, the same however many plugins it activates. */
  get fixedMessages(): readonly ModelMessage[] {
    return this.#fixedMessages;
  }

  toolkit(id: string): OfferedToolkit | undefined {
    return this.#toolkits().find((toolkit) => toolkit.id === id);
  }

  /** The toolkits the conversation opened, first opening first. */
  opened(
    messages: readonly ModelMessage[] = this.#conversation(),
  ): readonly OpenedToolkit[] {
    return openedToolkits(messages, this.#toolkits());
  }

  /**
   * The tools as the model is shown them: the gathered ones, each able to say
   * what a call is for, then the loop's own, then, where the switch says so,
   * the opened toolkits' tools.
   */
  advertised(): readonly ToolSpec[] {
    return [
      ...this.tools.map(selfDescribing),
      ...this.#loopSpecs(),
      ...(this.route === "list" ? this.#openedTools().map(selfDescribing) : []),
    ];
  }

  /**
   * Every tool the model may call, as its own spec: what a call is checked
   * against once the model has made it, whichever part of the loop answers
   * it, opened toolkits' tools included on every route.
   */
  offered(): readonly ToolSpec[] {
    return [...this.tools, ...this.#loopSpecs(), ...this.#openedTools()];
  }

  /**
   * The tools a provider that loads them natively is sent beside the
   * request: each toolkit opened among these messages, joining at its
   * answer. None on any other route.
   */
  loads(messages: readonly ModelMessage[]): ModelRequest["loads"] {
    if (this.route !== "native") return undefined;
    const opened = this.opened(messages);
    return opened.length
      ? opened.map((toolkit) => ({
          tools: toolkit.tools.map(selfDescribing),
          after: this.#fixedMessages.length + toolkit.at,
        }))
      : undefined;
  }

  /**
   * A call to a toolkit's tool that the conversation has not opened, refused
   * before its input is read, naming the toolkit to open.
   */
  notOpened(call: AssembledToolCall): Refusal | undefined {
    if (this.#openedTools().some((tool) => tool.name === call.name))
      return undefined;
    const toolkit = this.#toolkits().find((item) =>
      item.tools.some((tool) => tool.name === call.name),
    );
    if (!toolkit) return undefined;
    return refusal(
      "input-check",
      `“${call.name}” loads with ${toolkit.id}, which is not open.`,
      `Open it with open("${toolkit.id}"), then call the tool.`,
    );
  }

  /** The opened tool a bridge's `call` names, where opened tools go through it. */
  unwrap(call: AssembledToolCall): Unwrapped | undefined {
    if (this.route !== "bridge") return undefined;
    return unwrapBridged(call, {
      has: (name) =>
        this.offered().some((tool) => tool.name === name) ||
        this.#toolkits().some((toolkit) =>
          toolkit.tools.some((tool) => tool.name === name),
        ),
      names: () => this.offered().map((tool) => tool.name),
      own: (name) => this.loopTools.some((tool) => tool.answers(name)),
    });
  }

  /**
   * Tells the model, once, how its opened toolkits are reached now that the
   * route changed, as when the person chose a model that loads tools another
   * way: through `call` with their schemas, or directly.
   */
  async tellRoute(history: ModelHistory): Promise<void> {
    const messages = history.messages();
    const opened = this.opened(messages);
    if (!opened.length) return;
    const bridge = this.route === "bridge";
    if (toldThroughBridge(messages) === bridge) return;
    const ids = opened.map((toolkit) => toolkit.id).join(", ");
    await history.notice(
      "toolkit",
      bridge
        ? `Open: ${ids}.\n\n${bridgedSchemas(opened.flatMap((toolkit) => toolkit.tools).map(selfDescribing))}`
        : `Open: ${ids}. Their tools are now called directly, not through call.`,
    );
  }

  /**
   * The tools a specialist is handed, before its role narrows them: the
   * turn's, the toolkits opened, and any toolkit's tools its definition names.
   */
  specialistTools(specialist: SpecialistDefinition): readonly ToolSpec[] {
    const tools = [...this.tools, ...this.#openedTools()];
    const present = new Set(tools.map((tool) => tool.name));
    for (const toolkit of this.#toolkits())
      for (const tool of toolkit.tools)
        if (namedBySpecialist(specialist, tool) && !present.has(tool.name)) {
          present.add(tool.name);
          tools.push(tool);
        }
    return tools;
  }

  /** The start of a specialist's requests, written for it as of `now`, naming the tools it has. */
  specialistStart(
    now: Date,
    tools: readonly ToolSpec[],
  ): readonly ModelMessage[] {
    return fixedModelMessages({
      workspace: this.workspace,
      now,
      timeZone: this.#timeZone,
      tools,
      reader: "specialist",
    });
  }

  /** Activates a plugin, taking what it then offers; why not, when it cannot be. */
  async activate(plugin: string): Promise<string | undefined> {
    if (!this.#changes) return "Nothing can be activated here.";
    const activation = await this.#changes.activate(
      plugin,
      this.#activatedPlugins,
    );
    if (!activation.ok) return activation.reason;
    this.#adopt(activation.activatedPlugins, activation.gathered);
    return undefined;
  }

  /** Gathers the tools again, as a toolkit that connected when opened needs. */
  async gatherAgain(): Promise<void> {
    const gathered = await this.#changes?.gatherAgain(this.#activatedPlugins);
    if (gathered) this.#adopt(this.#activatedPlugins, gathered);
  }

  #adopt(
    activatedPlugins: readonly string[],
    gathered: ConversationTools,
  ): void {
    this.#activatedPlugins = activatedPlugins;
    this.#gathered = gathered;
    this.#fixedMessages = this.#start();
  }

  #toolkits(): readonly OfferedToolkit[] {
    return this.#gathered.toolkits;
  }

  #openedTools(): readonly ToolSpec[] {
    return this.opened().flatMap((toolkit) => toolkit.tools);
  }

  #loopSpecs(): readonly ToolSpec[] {
    return this.loopTools.flatMap((tool) => tool.specs());
  }

  #start(): readonly ModelMessage[] {
    return fixedModelMessages({
      workspace: this.workspace,
      // Its marks as the conversation started; a change since is a notice.
      pluginDirectory: directoryAsSent(this.pluginDirectory, this.#readiness),
      now: this.#startedAt,
      timeZone: this.#timeZone,
      // Named in the system prompt, which says how memory is used.
      tools: [...this.tools, ...this.#memoryTools],
    });
  }
}
