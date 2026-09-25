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

import type {
  AppEvent,
  ContextBudgetChoice,
  ModelWindow,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import {
  ComposedCapabilities,
  type CapabilityMembers,
} from "@zhiyin/capabilities";
import type { PluginView, Plugins } from "@zhiyin/plugins";
import type { RewindPlanner } from "@zhiyin/conversation-rewind";
import type { Recovery } from "@zhiyin/recovery";
import { ComposedRewind } from "@zhiyin/rewind";
import type { ModelClient, ModelEvent } from "@zhiyin/model-client";
import {
  AgentLoop,
  type AgentLoopDependencies,
  type TurnHost,
} from "../src/index.js";
import { settledWhenTurnEnded } from "../src/settling.js";

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
  /** What the turn asked the app around it to do, in order. */
  readonly enteredFolders: string[] = [];
  readonly watchedBrowsers: string[] = [];
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
      actions: [],
      phase: { kind: "draft" },
      ...(activatedPlugins.length ? { activatedPlugins } : {}),
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

  snapshot(): WorkspaceSnapshot {
    return {
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

  async enterFolderOf(taskId: string): Promise<void> {
    this.enteredFolders.push(taskId);
  }

  watchBrowser(taskId: string): void {
    this.watchedBrowsers.push(taskId);
  }

  async refreshConnections(): Promise<void> {
    this.connectionRefreshes += 1;
  }

  async recordUsage(modelUsage: unknown): Promise<void> {
    // Stamped and announced the way the app does, because a turn's tests watch
    // for what the window is told.
    const usage = {
      ...(modelUsage as Record<string, unknown>),
      recordedAt: this.#now().toISOString(),
    };
    this.usage.push(usage);
    this.#emit({ kind: "usageRecorded", data: usage } as unknown as AppEvent);
  }

  reportIssue(notice: string): void {
    if (this.issues.includes(notice)) return;
    this.issues.push(notice);
    this.#emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  emit(event: AppEvent): void {
    this.#emit(event);
  }
}

/**
 * What a turn test supplies: the loop's dependencies, with each group's members
 * given separately so a test can replace one of them — the built-in tools, say,
 * or file recovery — and still exercise the real joining between them.
 */
export type LoopTestDependencies = Omit<
  AgentLoopDependencies,
  "capabilities" | "rewind" | "host"
> &
  CapabilityMembers & {
    readonly rewind: RewindPlanner;
    readonly recovery: Recovery;
    readonly emit: (event: AppEvent) => void;
    readonly newTaskId: () => string;
    /**
     * Whether the app around the turn says the model can be shown a picture.
     * In production the core answers this from the provider's settings.
     */
    readonly acceptsImages?: boolean;
    /** The model's size as the catalogue lists it; unknown when absent. */
    readonly modelWindow?: ModelWindow & { readonly model: string };
    readonly defaultContextBudget?: ContextBudgetChoice;
  };

/** The loop as a test drives it, with the app around it answering beside. */
export type TurnTestApp = AgentLoop &
  Pick<
    TestHost,
    "createTask" | "snapshot" | "restore" | "renameTask" | "deleteTask"
  >;

/** The name the tests that moved here already used for it. */
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
    modelWindow,
    defaultContextBudget,
    ...rest
  } = dependencies;
  const host = new TestHost({ emit, now: rest.now, newTaskId });
  host.images = acceptsImages === true;
  if (modelWindow) host.window = modelWindow;
  if (defaultContextBudget) host.contextBudget = defaultContextBudget;
  const loop = new AgentLoop({
    ...rest,
    model: withOneChannel(rest.model),
    capabilities: new ComposedCapabilities({
      tools,
      mcp,
      plugins,
      toolchains,
      connectionToolchains,
      browsers: rest.browsers as CapabilityMembers["browsers"],
    }),
    rewind: new ComposedRewind({ conversation: rewind, recovery }),
    host,
  });
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

/** Every feature the turn reaches, answering plainly and reaching nothing. */
export function stubDependencies(
  emit: (event: AppEvent) => void,
  modelEvents: readonly ModelEvent[] = [{ kind: "done" }],
): LoopTestDependencies {
  let approvalNumber = 0;
  let messageNumber = 0;
  let actionNumber = 0;
  let keptNumber = 0;
  const browser = {
    refresh: async () => {},
    availability: async () => ({
      available: false as const,
      reason: "No browser in this fixture",
    }),
    state: () => ({
      status: "closed" as const,
      url: "",
      title: "",
      loading: false,
    }),
    lastFrame: () => undefined,
    automation: () => undefined,
    onState: () => () => {},
    onFrame: () => () => {},
    open: async () => {},
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    close: async () => {},
  };
  return {
    emit,
    permissions: { decide: async () => ({ outcome: "deny", reason: "stub" }) },
    tools: {
      list: () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
    },
    mcp: {
      manage: async () => [],
      retryFailed: async () => {},
      builtInIds: () => [],
      setToolEnabled: async () => {},
      test: async () => ({ ok: false, reason: "stub" }),
      saveToken: async () => {},
      clearToken: async () => {},
      availableTools: async () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
      shutdownScope: async () => {},
      shutdownAll: async () => {},
    },
    plugins: pluginsOffering([]),
    toolchains: {
      state: async () => ({ status: "ready", version: "stub" }),
      install: async () => {},
      executable: async () => undefined,
    },
    connectionToolchains: {},
    sessions: {
      loadWorkspace: async () => undefined,
      // Answered from whatever `loadWorkspace` a test gives, so a test states
      // the saved history once, whole, and the core reads it lazily as it
      // would from disk.
      async loadIndex() {
        const saved = await this.loadWorkspace();
        return (
          saved && {
            ...saved,
            conversations:
              saved.conversations ??
              saved.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                ...(task.titleSource ? { titleSource: task.titleSource } : {}),
                ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
                updatedLabel: task.updatedLabel,
              })),
          }
        );
      },
      async openConversation(id: string) {
        const task = (await this.loadWorkspace())?.tasks.find(
          (item) => item.id === id,
        );
        if (!task) throw new Error("No such conversation is saved.");
        return { task, lost: false };
      },
      saveWorkspace: async () => {},
      list: async () => [],
      undo: async () => {},
      savePicture: async () => "picture-1",
      readPicture: async () => ({
        status: "missing" as const,
        reason: "This picture is no longer stored with the conversation.",
      }),
      keep: async (
        _kind: string,
        _conversationId: string | undefined,
        source: { text: string } | { file: string },
      ) => ({
        status: "kept" as const,
        id: `kept-${++keptNumber}`,
        bytes: "text" in source ? Buffer.byteLength(source.text) : 0,
      }),
      locate: async () => ({
        status: "missing" as const,
        reason: "This output is no longer stored with the conversation.",
      }),
      claimDrafts: async () => [],
      forgetConversation: async () => {},
      lastRead: async () => undefined,
      noteRead: async () => {},
      inspectDamage: async () => ({ kind: "unreadable" as const }),
      preserveDamaged: async () => "damaged-history/workspace.json",
      recoverReadable: async () => ({
        recovered: 0,
        discarded: 0,
        kept: "damaged-history/workspace.json",
      }),
    },
    model: {
      send: async function* () {
        for (const event of modelEvents) yield event;
      },
      settings: async () => ({
        model: "z-ai/glm-5.3-flash",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        credential: { status: "missing", source: "none" },
      }),
      setApiKey: async () => {},
      clearApiKey: async () => {},
    },
    workspace: {
      describeWorkspace: async () => ({
        rootName: "workspace",
        entries: [],
        truncated: false,
      }),
      workspaceRoot: () => undefined,
    },
    audit: {
      record: async () => {},
      read: async () => [],
      clear: async () => {},
      retentionLimit: () => 5_000,
    },
    artifacts: {
      record: (existing) => existing,
      preview: async () => ({
        status: "missing",
        path: "",
        reason: "No workspace in this test.",
      }),
      exportTo: async () => ({ status: "cancelled" }),
      exportView: async () => ({ status: "cancelled" }),
    },
    views: { validate: async () => ({ ok: true }) },
    rewind: {
      plan: () => ({ ok: false, reason: "stub" }),
      apply: () => ({ ok: false, reason: "stub" }),
    },
    recovery: {
      prepare: async (actionId, _workspaceRoot, changes) => ({
        actionId,
        files: changes.map((change) => ({
          path: change.path,
          status: "protected" as const,
        })),
      }),
      validate: async () => ({ ok: true }),
      commit: async () => {},
      discard: async () => {},
      review: async (id, workspaceRoot) => ({
        id,
        workspaceRoot,
        files: [],
        targets: [],
      }),
      restore: async () => ({ files: [] }),
      cleanup: async () => {},
    },
    guidanceModel: {
      send: async function* () {
        yield { kind: "done" };
      },
    },
    judgementModel: {
      send: async function* () {
        yield { kind: "done" };
      },
    },
    browsers: {
      browser: () => browser,
      close: async () => browser.close(),
      forget: async () => browser.close(),
      closeAll: async () => browser.close(),
    },
    newTaskId: () => "task-1",
    newMessageId: () => `message-${++messageNumber}`,
    newActionId: () => `${++actionNumber}`,
    newSpecialistRunId: () => `specialist-${++actionNumber}`,
    newApprovalId: () => `approval-${++approvalNumber}`,
    newUserInputId: () => `input-${++approvalNumber}`,
    now: () => new Date("2026-09-02T19:00:00.000Z"),
  } as unknown as LoopTestDependencies;
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
  }[];
  readonly connectors?: readonly { id: string; url: string }[];
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
    appConnectors: [],
  };
}

/** A plugin store that offers exactly these plugins and refuses every change. */
export function pluginsOffering(views: readonly PluginView[]): Plugins {
  const refuse = async (): Promise<never> => {
    throw new Error("The loop's tests change no plugin.");
  };
  return {
    list: async () => views,
    builtInNames: async () => views.map((view) => view.manifest.name),
    setEnabled: refuse,
    setComponentEnabled: refuse,
    overrideComponent: refuse,
    resetComponent: refuse,
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: refuse,
    create: refuse,
    saveContents: refuse,
  };
}
