/**
 * What the loop's own tests run against: a stand-in for the app around a turn,
 * and stubs for every feature the turn reaches.
 *
 * Nothing from the core is present. The loop holds no conversation state of its
 * own — it reads and writes through the turn host — so a store of conversations
 * and the events they announce is the whole of what the app has to be here. If
 * a test needs startup, folders, saving or the browser feed, it is a test of
 * the core and the loop together and belongs with the core.
 */

import {
  emptyConversationLists,
  type AppEvent,
  type ContextBudgetChoice,
  type ModelWindow,
  type ReasoningSelection,
  type WorkspaceSnapshot,
  type WorkspaceTask,
} from "@zhiyin/contract";
import {
  ComposedCapabilities,
  type CapabilityMembers,
} from "@zhiyin/capabilities";
import type { PluginView } from "@zhiyin/plugins";
import { ComposedRewind } from "@zhiyin/rewind";
import type { ModelClient, ModelMessage } from "@zhiyin/model-client";
import { AgentLoop, type TurnHost } from "../src/index.js";
import { settledWhenTurnEnded } from "../src/turn/settling.js";
import { type TurnStubs } from "./stubs.js";

export { pluginsOffering, stubDependencies } from "./stubs.js";

export async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached.");
}

export function currentApprovalId(loop: TurnTestApp, taskId: string): string {
  const phase = loop.snapshot().tasks.find((task) => task.id === taskId)?.phase;
  if (phase?.kind !== "approval") throw new Error("No active approval.");
  return phase.prompt.id;
}

/**
 * The conversations a turn reads and writes, and what the app announces about
 * them. The saving rules are the host's in production too; what is missing here
 * is durable storage, which no turn behaviour depends on.
 */
export class TestHost implements TurnHost {
  tasks: WorkspaceTask[] = [];
  selectedTaskId: string | null = null;
  history = true;
  capabilities = true;
  images = false;
  least: ReasoningSelection | undefined;
  /**
   * Commit a write only after a save that takes a moment, as the core does.
   * Off, a write lands at once, and two writers can never overlap.
   */
  savesSlowly = false;
  /**
   * A save the disk refuses, as the core's does: the write still shows, and
   * the save throws.
   */
  refusesSave: ((task: WorkspaceTask) => boolean) | undefined;
  /** What the turn asked the app around it to do, in order. */
  readonly enteredFolders: string[] = [];
  readonly watchedBrowsers: string[] = [];
  /** The workspace files the turn said it wrote, per call, in order. */
  readonly writtenFiles: { taskId: string; paths: readonly string[] }[] = [];
  readonly readDocuments: { taskId: string; path: string; page?: number }[] =
    [];
  readonly closedDocuments: string[] = [];
  readonly issues: string[] = [];
  readonly usage: unknown[] = [];
  connectionRefreshes = 0;
  readonly #emit: (event: AppEvent) => void;
  readonly #now: () => Date;
  readonly #newTaskId: () => string;

  constructor(options: {
    readonly emit: (event: AppEvent) => void;
    readonly now: () => Date;
    readonly newTaskId: () => string;
  }) {
    this.#emit = options.emit;
    this.#now = options.now;
    this.#newTaskId = options.newTaskId;
  }

  /**
   * A conversation to run a turn in, shaped as the app shapes a new one.
   * Plugins named here are already activated in it, as they are once a turn
   * has activated them.
   */
  async createTask(activatedPlugins: readonly string[] = []): Promise<string> {
    const id = this.#newTaskId();
    const task: WorkspaceTask = {
      id,
      title: "New task",
      titleSource: "generated",
      updatedAt: this.#now().toISOString(),
      updatedLabel: "Now",
      messages: [],
      ...emptyConversationLists,
      activatedPlugins,
      phase: { kind: "draft" },
    };
    this.tasks = [task, ...this.tasks];
    this.selectedTaskId = id;
    this.#emit({ kind: "taskChanged", data: task });
    this.#emit({ kind: "taskSelectionChanged", data: { taskId: id } });
    return id;
  }

  /** Conversations that already existed, as if the app had just opened. */
  restore(tasks: readonly WorkspaceTask[], selectedTaskId?: string): void {
    this.tasks = [...tasks];
    this.selectedTaskId = selectedTaskId ?? tasks[0]?.id ?? null;
  }

  /**
   * A conversation the person deleted. A turn still running in it is stopped
   * first, as the app does, so what the turn meets is a conversation that no
   * longer exists rather than one pulled out from under it.
   */
  stopTurn: ((taskId: string) => Promise<void>) | undefined;

  async deleteTask(taskId: string): Promise<void> {
    await this.stopTurn?.(taskId);
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
    if (this.selectedTaskId === taskId)
      this.selectedTaskId = this.tasks[0]?.id ?? null;
  }

  /** A title the person typed, which no turn may replace. */
  renameTask(taskId: string, title: string): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? { ...task, title, titleSource: "manual" as const }
        : task,
    );
  }

  /** The conversations being compacted now, as the loop says. */
  readonly compactingNow = new Set<string>();

  compacting(taskId: string, running: boolean): void {
    if (running) this.compactingNow.add(taskId);
    else this.compactingNow.delete(taskId);
  }

  snapshot(): WorkspaceSnapshot {
    return {
      ...(this.compactingNow.size
        ? { compacting: [...this.compactingNow] }
        : {}),
      stage: "ready",
      availability: { tasks: "available", capabilities: "available" },
      ...(this.issues.length ? { issues: this.issues } : {}),
      tasks: this.tasks,
      selectedTaskId: this.selectedTaskId,
      plugins: [],
      mcpServers: [],
      browser: { status: "closed", url: "", title: "", loading: false },
      usage: { status: "unavailable", reason: "No usage in this fixture." },
    } as unknown as WorkspaceSnapshot;
  }

  find(taskId: string): WorkspaceTask | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  async store(
    task: WorkspaceTask,
    options: {
      readonly persist: boolean;
      readonly commit: () => boolean;
      readonly announce: () => boolean;
    },
  ): Promise<void> {
    if (!this.tasks.some((item) => item.id === task.id)) return;
    if (this.savesSlowly)
      await new Promise((resolve) => setTimeout(resolve, 1));
    // As the app does: a write whose author lost the conversation while it
    // was being saved is dropped.
    if (!options.commit()) return;
    const refused = options.persist && this.refusesSave?.(task) === true;
    const updated = {
      ...settledWhenTurnEnded(task),
      updatedAt: this.#now().toISOString(),
      updatedLabel: "Now",
    };
    this.tasks = this.tasks.map((item) =>
      item.id === task.id ? updated : item,
    );
    const current = this.find(task.id);
    if (current && options.announce())
      this.#emit({ kind: "taskChanged", data: current });
    if (refused) throw new Error("The disk is full.");
  }

  historyAvailable(): boolean {
    return this.history;
  }

  capabilitiesAvailable(): boolean {
    return this.capabilities;
  }

  acceptsImages(): boolean {
    return this.images;
  }

  leastReasoning(): ReasoningSelection | undefined {
    return this.least;
  }

  /** The model's size as the app reads it from the catalogue; unknown here. */
  window: ModelWindow & {
    readonly model: string;
    readonly refusedTokens?: number;
  } = { model: "test-model" };
  contextBudget: ContextBudgetChoice = "medium";

  modelWindow(): ModelWindow & { readonly model: string } {
    return this.window;
  }

  lowerWindow(contextWindow: number, refusedTokens: number): void {
    if (contextWindow >= (this.window.contextWindow ?? Infinity)) return;
    this.window = { ...this.window, contextWindow, refusedTokens };
  }

  defaultContextBudget(): ContextBudgetChoice {
    return this.contextBudget;
  }

  /** What the person has set in Settings, as a test sets it. */
  personal: string | undefined;
  readonly #folderChoices = new Map<string, boolean>();

  personalInstructions(): string | undefined {
    return this.personal;
  }

  folderInstructionsChoice(root: string, hash: string): boolean | undefined {
    return this.#folderChoices.get(`${root}\u0000${hash}`);
  }

  async rememberFolderInstructions(
    root: string,
    hash: string,
    use: boolean,
  ): Promise<void> {
    this.#folderChoices.set(`${root}\u0000${hash}`, use);
  }

  /** As if the person had already approved this file in this folder. */
  approveFolder(root: string, hash: string): void {
    this.#folderChoices.set(`${root}\u0000${hash}`, true);
  }

  async enterFolderOf(taskId: string): Promise<void> {
    this.enteredFolders.push(taskId);
  }

  watchBrowser(taskId: string): void {
    this.watchedBrowsers.push(taskId);
  }

  async filesWritten(taskId: string, paths: readonly string[]): Promise<void> {
    this.writtenFiles.push({ taskId, paths });
  }

  async documentRead(
    taskId: string,
    path: string,
    page?: number,
  ): Promise<string> {
    this.readDocuments.push({ taskId, path, ...(page ? { page } : {}) });
    return `Shown to the person beside the conversation${page ? `, at page ${page}` : ""}.`;
  }

  async documentClose(taskId: string): Promise<string> {
    this.closedDocuments.push(taskId);
    return "Closed. The space beside the conversation goes back to the conversation.";
  }

  async refreshConnections(): Promise<void> {
    this.connectionRefreshes += 1;
  }

  async recordUsage(modelUsage: unknown): Promise<void> {
    // Stamped the way the app does, and kept for a turn's tests to read.
    this.usage.push({
      ...(modelUsage as Record<string, unknown>),
      recordedAt: this.#now().toISOString(),
    });
  }

  reportIssue(notice: string): void {
    if (this.issues.includes(notice)) return;
    this.issues.push(notice);
    this.#emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }
}

/**
 * What a turn test supplies: the loop's dependencies, with each group's members
 * given separately so a test can replace one of them — the built-in tools, say,
 * or file recovery — and still exercise the real joining between them.
 */
export type LoopTestDependencies = TurnStubs & {
  /**
   * Whether the app around the turn says the model can be shown a picture.
   * In production the core answers this from the provider's settings.
   */
  readonly acceptsImages?: boolean;
  /**
   * The least reasoning the model can be asked for: none, or its lowest
   * effort. Absent, it can be asked for no less than was chosen.
   */
  readonly leastReasoning?: ReasoningSelection;
  /** The model's size as the catalogue lists it; unknown when absent. */
  readonly modelWindow?: ModelWindow & { readonly model: string };
  readonly defaultContextBudget?: ContextBudgetChoice;
  /** See `TestHost.savesSlowly`. */
  readonly savesSlowly?: boolean;
  /** See `TestHost.refusesSave`. */
  readonly refusesSave?: (task: WorkspaceTask) => boolean;
};

/** A message's words as the model reads them, pictures left out. */
export function wordsOf(message: ModelMessage | undefined): string {
  const content = message?.content ?? "";
  return typeof content === "string"
    ? content
    : content.map((part) => (part.kind === "text" ? part.text : "")).join("");
}

/** The loop as a test drives it, with the app around it answering beside. */
export type TurnTestApp = AgentLoop &
  Pick<
    TestHost,
    "createTask" | "snapshot" | "restore" | "renameTask" | "deleteTask"
  >;

/** Another name for `TurnTestApp`, used across the tests. */
export type TestApp = TurnTestApp;

/**
 * What the model is told a tool returned: the result, inside the fence Zhiyin
 * puts round everything a tool answers.
 */
export function fenced(tool: string, result: string): string {
  return `<tool-output tool="${tool}" trust="untrusted">${result}</tool-output>`;
}

/** The result inside a fenced tool answer, read back as JSON. */
export function unfenced(content: string): Record<string, unknown> {
  const inside =
    /^<tool-output tool="[^"]*" trust="untrusted">([\s\S]*)<\/tool-output>$/.exec(
      content,
    )?.[1];
  if (inside === undefined)
    throw new Error(`Not a fenced tool answer: ${content.slice(0, 80)}`);
  return JSON.parse(inside) as Record<string, unknown>;
}

/**
 * Held for every request any test makes: after the person's first message,
 * nothing arrives as a system message. Zhiyin speaks through marked notices
 * instead, because upstreams merge, move or reject a system message placed
 * mid-conversation.
 */
function withOneChannel(model: ModelClient): ModelClient {
  return {
    ...model,
    send(request) {
      const firstUser = request.messages.findIndex(
        (message) => message.role === "user",
      );
      const late =
        firstUser < 0
          ? -1
          : request.messages.findIndex(
              (message, index) =>
                index > firstUser && message.role === "system",
            );
      if (late >= 0)
        throw new Error(
          `A system message was sent after the person's first message: ${JSON.stringify(request.messages[late]).slice(0, 200)}`,
        );
      return model.send(request);
    },
  };
}

export function loopFrom(dependencies: LoopTestDependencies): TurnTestApp {
  const { host } = loopAndHost(dependencies);
  return host.app;
}

/** The same, for a test that needs to reach the app around the turn. */
export function loopAndHost(dependencies: LoopTestDependencies): {
  readonly host: TestHost & { readonly app: TurnTestApp };
} {
  const {
    tools,
    mcp,
    plugins,
    toolchains,
    connectionToolchains,
    rewind,
    recovery,
    emit,
    newTaskId,
    acceptsImages,
    leastReasoning,
    modelWindow,
    defaultContextBudget,
    savesSlowly,
    refusesSave,
    ...rest
  } = dependencies;
  const host = new TestHost({ emit, now: rest.now, newTaskId });
  host.images = acceptsImages === true;
  host.least = leastReasoning;
  if (modelWindow) host.window = modelWindow;
  if (defaultContextBudget) host.contextBudget = defaultContextBudget;
  host.savesSlowly = savesSlowly === true;
  host.refusesSave = refusesSave;
  const capabilities = new ComposedCapabilities({
    tools,
    mcp,
    plugins,
    toolchains,
    connectionToolchains,
    browsers: rest.browsers as CapabilityMembers["browsers"],
  });
  const loop = new AgentLoop({
    ...rest,
    model: withOneChannel(rest.model),
    capabilities,
    rewind: new ComposedRewind({ conversation: rewind, recovery }),
    host,
  });
  // Wired as the application wires it.
  capabilities.onCommandEnded((taskId, notice, wakes) =>
    loop.commandEnded(taskId, notice, wakes),
  );
  capabilities.onCommandsChanged((taskId) => void loop.commandsChanged(taskId));
  capabilities.onJobChanges(
    (taskId, job, changes) => void loop.jobChanged(taskId, job, changes),
  );
  host.stopTurn = async (taskId) => {
    if (loop.running(taskId)) await loop.cancel(taskId);
  };
  const app = new Proxy(loop, {
    get(target, key) {
      const owner = key in target ? target : (host as unknown as object);
      const value: unknown = Reflect.get(owner, key);
      return typeof value === "function" ? value.bind(owner) : value;
    },
  }) as TurnTestApp;
  return { host: Object.assign(host, { app }) };
}

/** A plugin as a turn meets it: everything in it switched on. */
export function pluginOffering(options: {
  readonly name: string;
  readonly skills?: readonly {
    id: string;
    description: string;
    instructions: string;
  }[];
  readonly specialists?: readonly {
    id: string;
    name: string;
    description: string;
    instructions: string;
    access?: "read" | "change";
    tools?: readonly string[];
  }[];
  readonly connectors?: readonly { id: string; url: string }[];
  /** Connectors the application provides, each by the connection it names. */
  readonly appConnectors?: readonly {
    id: string;
    connector: string;
    name: string;
  }[];
  readonly enabled?: boolean;
}): PluginView {
  const full = (id: string) => `${options.name}/${id}`;
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: options.name,
      version: "1.0.0",
      description: `The ${options.name} plugin.`,
      author: { name: "Zhiyin" },
      displayName: options.name,
      category: "Development",
      defaultPrompts: [],
    },
    provenance: { source: "built-in", sourceId: "shipped" },
    enabled: options.enabled ?? true,
    editing: "override",
    skills: (options.skills ?? []).map((skill) => ({
      ...skill,
      id: full(skill.id),
      name: skill.id,
      enabled: true,
    })),
    specialists: (options.specialists ?? []).map((specialist) => ({
      ...specialist,
      id: full(specialist.id),
      enabled: true,
    })),
    mcpServers: (options.connectors ?? []).map((connector) => ({
      id: full(connector.id),
      name: connector.id,
      description: `The ${connector.id} connector.`,
      type: "streamable-http" as const,
      url: connector.url,
      access: "Needs a key.",
      dataDestination: connector.url,
      enabled: true,
    })),
    appConnectors: (options.appConnectors ?? []).map((connector) => ({
      id: full(connector.id),
      connector: connector.connector,
      name: connector.name,
      description: `The ${connector.name} connector.`,
      access: "Runs on this computer.",
      dataDestination: "Nothing leaves this computer.",
      enabled: true,
    })),
  };
}
