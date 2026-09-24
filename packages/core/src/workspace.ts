/**
 * Everything behind the window that is not a turn: the conversations and which
 * one is open, the folder and the folders worked in, preferences, issues, the
 * capability and connection lists, usage and the browser feed — and the one
 * path by which all of it is saved. Model settings sit beside it.
 *
 * Turns run in the agent loop, which reads and writes conversations through the
 * turn host this class hands it. The loop holds none of this state, and the
 * rules for saving it live in one place (ADR 0012, ADR 0034).
 *
 * Boundaries and invariants: docs/architecture/features/core/README.md
 */

import type {
  AppEvent,
  ArtifactExport,
  ArtifactPreview,
  AuthoredPluginContents,
  BrowserIntent,
  ComponentContent,
  ComponentContentDraft,
  ContextBudgetChoice,
  EvidenceState,
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  PluginSourceOutcome,
  PluginState,
  RewindCommitResult,
  RewindPreview,
  ShellAvailability,
  UsageState,
  WorkspaceContext,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { AgentLoop, TurnHost } from "@zhiyin/agent-loop";
import type { AuditLog } from "@zhiyin/audit";
import type { Artifacts, DestinationChooser } from "@zhiyin/artifacts";
import type { Capabilities } from "@zhiyin/capabilities";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";
import type { ModelClient } from "@zhiyin/model-client";
import type { Rewind } from "@zhiyin/rewind";
import type { Sessions } from "@zhiyin/session";
import type { UsageTelemetry } from "@zhiyin/usage";
import { BrowserFeed } from "./browser-feed.js";
import { ModelSettings } from "./model-settings.js";
import * as startup from "./startup.js";
import { requiredTask, stampTaskWorkspace } from "./workspace-tasks.js";
import { WorkspacePersistence } from "./workspace-persistence.js";
import { recordUsage } from "./workspace-usage.js";
import { forTheWindow } from "./window-events.js";
import {
  clearEvidence as clearStoredEvidence,
  readEvidence,
} from "./workspace-evidence.js";
import { WorkspaceRewinds } from "./workspace-rewinds.js";
import { WorkspacePlugins } from "./workspace-plugins.js";
import { WorkspaceConnections } from "./workspace-connections.js";
import { WorkspaceShell } from "./workspace-shell.js";
import { closeInTurn } from "./closing.js";
import * as produced from "./produced-files.js";
import { ConversationList } from "./conversation-list.js";
import { KeptItems } from "./kept-items.js";

/** What the workspace asks of whoever runs turns. */
export type WorkspaceTurns = Pick<
  AgentLoop,
  | "start"
  | "cancel"
  | "shutdown"
  | "resolveApproval"
  | "resolveUserInput"
  | "running"
  | "anyRunning"
  | "accepts"
  | "settleAfterRestart"
  | "settleEndedTurn"
>;

export type WorkspaceDependencies = {
  readonly onboarding?: boolean;
  readonly sessions: Sessions;
  readonly capabilities: Capabilities;
  readonly workspace: WorkspaceContext;
  readonly artifacts: Artifacts;
  readonly rewind: Rewind;
  readonly audit: AuditLog;
  readonly usage: UsageTelemetry;
  readonly model: ModelClient;
  readonly browsers: ConversationBrowsers;
  readonly newTaskId: () => string;
  readonly now: () => Date;
  /** Everything user-visible leaves through here. There is no other route. */
  readonly emit: (event: AppEvent) => void;
};

/**
 * Said once, while the window is showing changes the disk does not hold. It is
 * cleared by the next commit that succeeds, so it describes the present state
 * rather than a failure that happened once.
 */
const UNSAVED_CHANGES = `Recent changes could not be saved. What is on screen is not yet stored, and the last saved state is unchanged. Try again, or restart to go back to what was saved.`;

export class Workspace {
  readonly #deps: WorkspaceDependencies;
  /** Whoever runs this workspace's turns. */
  readonly turns: WorkspaceTurns;
  /** The conversations opened so far; the list holds every one. */
  #tasks: WorkspaceTask[] = [];
  readonly #conversations: ConversationList;
  #selectedTaskId: string | null = null;
  #preferences: WorkspaceSnapshot["preferences"];
  #contextBudget: WorkspaceSnapshot["contextBudget"];
  #workspaceSelection: WorkspaceSnapshot["workspace"];
  #recentWorkspaces: NonNullable<WorkspaceSnapshot["recentWorkspaces"]> = [];
  #issues: string[] = [];
  #historyAvailable = true;
  #historyRecovery: WorkspaceSnapshot["historyRecovery"];
  #connectionsReady: Promise<void> = Promise.resolve();
  #capabilitiesAvailable = true;
  #mcpServers: McpServerState[] = [];
  #plugins: PluginState[] = [];
  /** The browser panel a person watches, one per conversation. */
  readonly #browser: BrowserFeed;
  #usage: UsageState = startup.initialUsage;
  /** The key, the models on offer and the model chosen. */
  readonly settings: ModelSettings;
  readonly #persistence: WorkspacePersistence;
  readonly #rewinds: WorkspaceRewinds;
  readonly #pluginLifecycle: WorkspacePlugins;
  readonly #connections: WorkspaceConnections;
  readonly #shell: WorkspaceShell;
  /** Pastes and pictures kept beside the conversations. */
  readonly kept: KeptItems;

  constructor(
    deps: WorkspaceDependencies,
    /** Builds whoever runs turns, around the host this workspace provides. */
    runTurns: (host: TurnHost) => WorkspaceTurns,
  ) {
    this.#deps = deps;
    this.#persistence = new WorkspacePersistence(
      deps.sessions,
      () => this.snapshot(),
      () => this.#historyAvailable,
      () => {
        if (!this.#issues.includes(UNSAVED_CHANGES))
          this.#issues = [...this.#issues, UNSAVED_CHANGES];
      },
      () => {
        this.#issues = this.#issues.filter(
          (issue) => issue !== UNSAVED_CHANGES,
        );
      },
    );
    this.settings = new ModelSettings(deps.model, (event) => this.emit(event));
    this.#browser = new BrowserFeed(deps.browsers, (event) => this.emit(event));
    this.#rewinds = new WorkspaceRewinds({
      rewind: deps.rewind,
      open: (id) => this.#ensureOpen(id).then(() => undefined),
      task: (id) => requiredTask(this.#tasks, id),
      save: (task) => this.#replaceTask(task),
      historyAvailable: () => this.#historyAvailable,
      running: (taskId) => this.turns.running(taskId),
    });
    // A package change can add or remove connections, so the connections are
    // looked at again, and the plugins with them.
    this.#pluginLifecycle = new WorkspacePlugins({
      capabilities: deps.capabilities,
      refresh: () => this.#refreshMcpServers(),
    });
    this.#connections = new WorkspaceConnections({
      capabilities: deps.capabilities,
      refresh: () => this.#refreshMcpServers(),
    });
    this.#shell = new WorkspaceShell(deps.capabilities);
    this.kept = new KeptItems(deps.sessions);
    this.turns = runTurns({
      find: (taskId) => this.#tasks.find((task) => task.id === taskId),
      store: (task, options) => this.#store(task, options),
      historyAvailable: () => this.#historyAvailable,
      capabilitiesAvailable: () => this.#capabilitiesAvailable,
      acceptsImages: () => this.settings.current()?.acceptsImages === true,
      modelWindow: () => ({ model: "", ...this.settings.current() }),
      defaultContextBudget: () => this.#contextBudget ?? "medium",
      enterFolderOf: (taskId) => this.#enterFolderOf(taskId),
      watchBrowser: (taskId) => this.#browser.watch(taskId),
      refreshConnections: () => this.#refreshMcpServers(),
      recordUsage: (usage) => this.#recordUsage(usage),
      reportIssue: (notice) => this.#reportIssue(notice),
      emit: (event) => this.emit(event),
    });
    this.#conversations = new ConversationList(deps.sessions, (task) =>
      this.turns.settleAfterRestart(task),
    );
  }

  emit(event: AppEvent): void {
    this.#deps.emit(forTheWindow(event));
  }

  async initialize(): Promise<void> {
    if (this.turns.anyRunning()) return;
    const restored = await startup.loadStartup(this.#deps, {
      tasks: this.#tasks,
      conversations: this.#listed(),
      selectedTaskId: this.#selectedTaskId,
      historyRecovery: this.#historyRecovery,
    });
    this.#tasks = restored.tasks;
    this.#conversations.replace(restored.conversations);
    this.#selectedTaskId = restored.selectedTaskId;
    this.#preferences = restored.preferences;
    this.#contextBudget = restored.contextBudget;
    this.#workspaceSelection = restored.workspace;
    this.#recentWorkspaces = restored.recentWorkspaces;
    this.#issues = restored.issues;
    this.#historyAvailable = restored.historyAvailable;
    this.#historyRecovery = restored.historyRecovery;
    this.#capabilitiesAvailable = restored.capabilitiesAvailable;
    this.#plugins = restored.plugins;
    this.#mcpServers = [];
    this.#usage = restored.usage;
    if (this.#selectedTaskId && !(await this.#ensureOpen(this.#selectedTaskId)))
      this.#selectedTaskId = null;
    const rewindIssue = await this.#rewinds.resume();
    if (rewindIssue) this.#issues = [...this.#issues, rewindIssue];
    if (restored.needsSave) await this.#persistence.save();
    this.#connectionsReady = startup.loadConnections(
      this.#deps.capabilities,
      ({ mcpServers, plugins, issues }) => {
        this.#mcpServers = mcpServers;
        if (plugins) this.#plugins = plugins;
        if (issues) this.#issues = [...this.#issues, ...issues];
        this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
      },
    );
    // Provider settings look the model up in the provider's catalogue, so like
    // connections they arrive when they arrive.
    void this.settings
      .refresh()
      .catch(() =>
        this.#reportIssue(
          "The model's settings could not be read. Open Settings to check them.",
        ),
      );
  }

  /**
   * Resolves once the connections have either arrived or failed. Present so a
   * caller that genuinely needs them — a test, or a shutdown — can wait rather
   * than poll.
   */
  connectionsReady(): Promise<void> {
    return this.#connectionsReady;
  }

  snapshot(): WorkspaceSnapshot {
    return {
      ...(this.#historyRecovery
        ? { historyRecovery: this.#historyRecovery }
        : {}),
      runtime: {
        tasks: this.#historyAvailable ? "available" : "unavailable",
        capabilities: this.#capabilitiesAvailable ? "available" : "unavailable",
      },
      ...(this.#preferences ? { preferences: this.#preferences } : {}),
      ...(this.#contextBudget ? { contextBudget: this.#contextBudget } : {}),
      ...(this.#workspaceSelection
        ? { workspace: this.#workspaceSelection }
        : {}),
      ...(this.#recentWorkspaces.length
        ? { recentWorkspaces: this.#recentWorkspaces }
        : {}),
      ...(this.#issues.length ? { issues: this.#issues } : {}),
      tasks: this.#tasks,
      conversations: this.#listed(),
      selectedTaskId: this.#selectedTaskId,
      plugins: this.#plugins,
      mcpServers: this.#mcpServers,
      browser: this.#browser.panel(this.#selectedTaskId),
      usage: this.#usage,
    };
  }

  evidence = (): Promise<EvidenceState> =>
    readEvidence(this.#deps.audit, this.#deps.rewind, this.#listed());

  clearEvidence = (kind: "corrections" | "recovery"): Promise<EvidenceState> =>
    clearStoredEvidence(
      this.#deps.audit,
      this.#deps.rewind,
      this.#listed(),
      kind,
    );

  #listed = () => this.#conversations.list(this.#tasks);

  /**
   * Reads a conversation from disk the first time it is needed, and answers
   * whether it is open. One that cannot be read is reported and stays closed.
   */
  async #ensureOpen(taskId: string): Promise<boolean> {
    if (this.#tasks.some((task) => task.id === taskId)) return true;
    const opened = await this.#conversations.open(taskId);
    if (opened.issue) this.#reportIssue(opened.issue);
    if (!opened.task) return false;
    // Another caller may have opened it while this one was reading.
    if (!this.#tasks.some((item) => item.id === taskId))
      this.#tasks = [...this.#tasks, opened.task];
    if (opened.changed) await this.#persistence.save();
    this.emit({ kind: "taskChanged", data: opened.task });
    return true;
  }

  async createTask(): Promise<string> {
    if (!this.#historyAvailable)
      throw new VisibleError("Restore saved history before creating a task.");
    const id = this.#deps.newTaskId();
    const task: WorkspaceTask = {
      id,
      title: "New task",
      titleSource: "generated",
      updatedAt: this.#deps.now().toISOString(),
      updatedLabel: "Now",
      messages: [],
      actions: [],
      ...(this.#workspaceSelection
        ? { workspace: this.#workspaceSelection }
        : {}),
      phase: { kind: "draft" },
    };
    this.#tasks = [task, ...this.#tasks];
    this.#conversations.add(task);
    this.#selectedTaskId = id;
    await this.#persistence.save();
    this.emit({ kind: "taskChanged", data: task });
    this.emit({ kind: "taskSelectionChanged", data: { taskId: id } });
    return id;
  }

  async selectTask(taskId: string): Promise<void> {
    if (!this.#conversations.has(taskId))
      throw new Error("The selected task does not exist.");
    if (!(await this.#ensureOpen(taskId))) return;
    const task = requiredTask(this.#tasks, taskId);
    this.#selectedTaskId = taskId;
    const moved = await this.#openTaskWorkspace(task);
    await this.#persistence.save();
    this.#browser.announce(taskId);
    this.emit({
      kind: "taskSelectionChanged",
      data: { taskId },
    });
    // The window now shows a different folder than it did, or an issue that
    // was not there before; either way the whole snapshot has moved.
    if (moved) this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  /**
   * No conversation open. The folder stays as it is: it is the folder the next
   * conversation will be started in, and `createTask` gives it to whatever is
   * created next.
   */
  async selectNothing(): Promise<void> {
    if (this.#selectedTaskId === null) return;
    this.#selectedTaskId = null;
    await this.#persistence.save();
    this.emit({ kind: "taskSelectionChanged", data: { taskId: null } });
  }

  async renameTask(taskId: string, title: string): Promise<void> {
    const value = title.trim();
    if (!value) throw new Error("Enter a conversation name.");
    // Named from the list, so it may not have been opened yet.
    if (!(await this.#ensureOpen(taskId))) return;
    const task = requiredTask(this.#tasks, taskId);
    await this.#replaceTask({ ...task, title: value, titleSource: "manual" });
  }

  async setContextBudget(
    taskId: string,
    budget: ContextBudgetChoice,
  ): Promise<void> {
    if (!(await this.#ensureOpen(taskId))) return;
    const task = requiredTask(this.#tasks, taskId);
    await this.#replaceTask({ ...task, contextBudget: budget });
  }

  async setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void> {
    this.#contextBudget = budget;
    await this.#persistence.save();
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  previewRewind = (taskId: string, messageId: string): Promise<RewindPreview> =>
    this.#rewinds.preview(taskId, messageId);

  commitRewind = (
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ): Promise<RewindCommitResult> =>
    this.#rewinds.commit(taskId, rewindId, files);

  async deleteTask(taskId: string): Promise<void> {
    if (!this.#conversations.has(taskId))
      throw new Error("The task does not exist.");
    if (this.turns.running(taskId)) await this.turns.cancel(taskId);
    this.#browser.forget(taskId);
    await this.#deps.capabilities.forgetConversation(taskId);
    this.#tasks = this.#tasks.filter((task) => task.id !== taskId);
    const next = this.#conversations.remove(taskId, this.#tasks);
    if (this.#selectedTaskId === taskId)
      this.#selectedTaskId =
        next && (await this.#ensureOpen(next)) ? next : null;
    await this.#persistence.save();
    // What it kept beside itself goes with it: its pictures, pastes and saved
    // outputs. A file that will not go yet does not keep the conversation.
    await this.#deps.sessions.forgetConversation(taskId).catch(() => {});
    if (this.#selectedTaskId) this.#browser.announce(this.#selectedTaskId);
    this.emit({
      kind: "taskRemoved",
      data: { taskId, selectedTaskId: this.#selectedTaskId },
    });
  }

  /**
   * Stops every turn first, then closes what the conversations held open: the
   * browsers and the connections, and the feeds watching them.
   *
   * Each is given until one deadline, not waited for without end: something
   * that never finishes closing would otherwise keep the app alive, holding
   * the data folder. Answers what had not finished by then.
   */
  shutdown(): Promise<readonly string[]> {
    return closeInTurn([
      ["conversation turns", () => this.turns.shutdown()],
      ["browsers and connections", () => this.#deps.capabilities.shutdown()],
    ]).finally(() => this.#browser.stopWatching());
  }

  setPluginEnabled = (id: string, enabled: boolean): Promise<void> =>
    this.#pluginLifecycle.setEnabled(id, enabled);

  setComponentEnabled = (id: string, enabled: boolean): Promise<void> =>
    this.#pluginLifecycle.setComponentEnabled(id, enabled);

  componentContent = (id: string): Promise<ComponentContent | undefined> =>
    this.#deps.capabilities.componentContent(id);

  overrideComponent = (
    id: string,
    content: ComponentContentDraft,
  ): Promise<void> => this.#pluginLifecycle.overrideComponent(id, content);

  resetComponent = (id: string): Promise<void> =>
    this.#pluginLifecycle.resetComponent(id);

  installToolchain = (id: string): Promise<void> =>
    this.#pluginLifecycle.installToolchain(id);

  installPlugin(
    chooseSource: () => Promise<string | undefined>,
  ): Promise<PluginSourceOutcome> {
    return this.#pluginLifecycle.install(chooseSource);
  }

  updatePlugin(
    id: string,
    chooseSource: () => Promise<string | undefined>,
  ): Promise<PluginSourceOutcome> {
    return this.#pluginLifecycle.update(id, chooseSource);
  }

  rollbackPlugin = (id: string): Promise<void> =>
    this.#pluginLifecycle.rollback(id);

  removePlugin = (id: string): Promise<void> =>
    this.#pluginLifecycle.remove(id);

  createPlugin = (displayName: string, description: string): Promise<void> =>
    this.#pluginLifecycle.create(displayName, description);

  savePluginContents = (
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void> => this.#pluginLifecycle.saveContents(id, contents);

  /** An app-made plugin's whole content, for the component-edit form to open on. */
  editablePluginContents = (
    id: string,
  ): Promise<AuthoredPluginContents | undefined> =>
    this.#deps.capabilities.editablePluginContents(id);

  setMcpServerToolEnabled = (
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> => this.#connections.setToolEnabled(id, toolName, enabled);

  testMcpConnection = (
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome> => this.#connections.test(server, token);

  /** One thing the person asked the browser to do, in the open conversation. */
  async driveBrowser(intent: BrowserIntent): Promise<void> {
    const taskId = this.#selectedTaskId;
    if (!taskId)
      throw new Error("Open a conversation before using the browser.");
    await this.#browser.drive(taskId, intent);
  }

  saveMcpServerToken = (id: string, token: string): Promise<void> =>
    this.#connections.saveToken(id, token);

  clearMcpServerToken = (id: string): Promise<void> =>
    this.#connections.clearToken(id);

  refreshConnections = (): Promise<void> => this.#connections.refresh();

  shellAvailability = (): Promise<ShellAvailability> =>
    this.#shell.availability();

  recheckShell = (): Promise<ShellAvailability> => this.#shell.recheck();

  async #recordUsage(
    modelUsage: Parameters<TurnHost["recordUsage"]>[0],
  ): Promise<void> {
    this.#usage = await recordUsage(
      this.#deps.usage,
      modelUsage,
      this.#deps.now(),
      (event) => this.emit(event),
    );
  }

  previewArtifact = (taskId: string, path: string): Promise<ArtifactPreview> =>
    produced.previewArtifact(this.#deps.artifacts, this.#tasks, taskId, path);

  exportArtifact = (
    taskId: string,
    path: string,
    choose: DestinationChooser,
  ): Promise<ArtifactExport> =>
    produced.exportArtifact(
      this.#deps.artifacts,
      this.#tasks,
      taskId,
      path,
      choose,
    );

  exportView = (
    taskId: string,
    viewId: string,
    svg: string,
    choose: DestinationChooser,
  ): Promise<ArtifactExport> =>
    produced.exportView(
      this.#deps.artifacts,
      this.#tasks,
      taskId,
      viewId,
      svg,
      choose,
    );

  /**
   * The workspace's own change to a conversation, held to the same rule as a
   * turn's: a conversation whose turn was stopped takes nothing but the record
   * of its stopping.
   */
  async #replaceTask(task: WorkspaceTask): Promise<void> {
    if (!this.turns.accepts(task)) return;
    await this.#store(task, {
      persist: true,
      commit: () => this.turns.accepts(task),
      announce: () => this.turns.accepts(task),
    });
  }

  /**
   * Keeps a new revision of a conversation. A conversation that has been
   * deleted takes no further writes, however late the work that produced them
   * started. Whether the change is announced is asked only once it has been
   * saved, because a turn can be stopped while the save is under way.
   */
  async #store(
    task: WorkspaceTask,
    options: {
      readonly persist: boolean;
      readonly commit: () => boolean;
      readonly announce: () => boolean;
    },
  ): Promise<void> {
    if (!this.#tasks.some((item) => item.id === task.id)) return;
    const updated = {
      // Reasoning that was still arriving when the turn ended is settled by
      // the turn, not by whoever happens to be saving the conversation.
      ...this.turns.settleEndedTurn(task),
      updatedAt: this.#deps.now().toISOString(),
      updatedLabel: "Now",
    };
    const nextTasks = this.#tasks.map((item) =>
      item.id === task.id ? updated : item,
    );
    try {
      if (options.persist)
        await this.#persistence.save(
          { ...this.snapshot(), tasks: nextTasks },
          options.commit,
        );
      if (!options.commit()) return;
      this.#tasks = nextTasks;
    } catch (error) {
      // A genuine failed save remains visible and is marked unsaved. A write
      // whose author lost ownership is discarded instead.
      if (options.commit()) this.#tasks = nextTasks;
      throw error;
    } finally {
      const current = this.#tasks.find((item) => item.id === task.id);
      if (current && options.announce())
        this.emit({ kind: "taskChanged", data: current });
    }
  }

  /** Said once, and the window is told at once rather than at the next change. */
  #reportIssue(notice: string): void {
    if (this.#issues.includes(notice)) return;
    this.#issues.push(notice);
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  /**
   * The answer to the damaged-history question, and the only thing that writes
   * over a damaged file. Until this is called the history is left exactly as it
   * was found.
   */
  async recoverHistory(choice: "recover" | "startFresh"): Promise<void> {
    await startup.recoverHistory(
      this.#deps.sessions,
      this.#historyRecovery,
      choice,
    );
    this.#historyRecovery = undefined;
    this.#historyAvailable = true;
    this.#issues = [];
    if (choice === "startFresh") {
      this.#tasks = [];
      this.#conversations.replace([]);
      this.#selectedTaskId = null;
      await this.#persistence.save();
    }
    await this.initialize();
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  async configureProfile(interests: readonly string[]): Promise<void> {
    await startup.configureProfile({
      capabilities: this.#deps.capabilities,
      interests,
      preferences: () => this.#preferences,
      setPreferences: (preferences) => (this.#preferences = preferences),
      persist: () => this.#persistence.save(),
      refreshPlugins: () => this.#refreshPlugins(),
    });
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  /**
   * A turn runs where its conversation lives, whatever the window last
   * displayed — the selection may have been changed by another route, or the
   * app restarted since. A conversation that has never named a folder —
   * restored from before they were recorded, or started before one was chosen
   * — takes the one it is actually about to run in.
   */
  async #enterFolderOf(taskId: string): Promise<void> {
    const started = this.#tasks.find((task) => task.id === taskId);
    if (!started) return;
    if (await this.#openTaskWorkspace(started, taskId))
      this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
    if (!started.workspace && this.#workspaceSelection) {
      const folder = this.#workspaceSelection;
      this.#tasks = this.#tasks.map((task) =>
        task.id === taskId ? { ...task, workspace: folder } : task,
      );
    }
  }

  /**
   * Moves the app to the folder a conversation belongs to, and answers whether
   * anything changed.
   *
   * A folder that will not open is reported and nothing else: relabelling the
   * current folder with the name of one that failed to open would be a lie
   * about where the next action would run. A conversation with no recorded
   * folder is left alone rather than dragged anywhere, and no folder is
   * changed under a turn that is already running.
   */
  async #openTaskWorkspace(
    task: WorkspaceTask,
    /** The turn this move is being made for, which is not an obstacle to it. */
    ownTurnTaskId?: string,
  ): Promise<boolean> {
    const wanted = task.workspace;
    if (
      !wanted ||
      wanted.path === this.#workspaceSelection?.path ||
      this.turns.anyRunning(ownTurnTaskId) ||
      !this.#deps.workspace.selectWorkspace
    )
      return false;
    const moved = await startup.enterFolder(this.#deps.workspace, task, {
      selection: this.#workspaceSelection,
      recents: this.#recentWorkspaces,
      issues: this.#issues,
    });
    this.#workspaceSelection = moved.selection;
    this.#recentWorkspaces = moved.recents;
    this.#issues = moved.issues;
    return true;
  }

  async selectWorkspace(path: string): Promise<void> {
    if (this.turns.anyRunning())
      throw new VisibleError("Stop running tasks before changing the folder.");
    if (!this.#deps.workspace.selectWorkspace)
      throw new VisibleError("Folder selection is unavailable.");
    const previous = {
      selection: this.#workspaceSelection,
      recents: this.#recentWorkspaces,
      tasks: this.#tasks,
    };
    await this.#deps.workspace.selectWorkspace(path);
    const description = await this.#deps.workspace.describeWorkspace();
    this.#workspaceSelection = { path, name: description.rootName };
    this.#recentWorkspaces = startup.withRecentWorkspace(
      this.#recentWorkspaces,
      this.#workspaceSelection,
    );
    // The folder was chosen while looking at this conversation, so it is this
    // conversation's folder from now on.
    this.#tasks = stampTaskWorkspace(
      this.#tasks,
      this.#selectedTaskId,
      this.#workspaceSelection,
    );
    this.#issues = this.#issues.filter(
      (issue) => issue !== startup.movedWorkspaceNotice,
    );
    try {
      await this.#persistence.save();
    } catch (error) {
      // The choice was not recorded, so it did not happen. Put the folder the
      // window is about to go back to showing under the file tools again,
      // rather than leaving them somewhere the person is not being shown.
      this.#workspaceSelection = previous.selection;
      this.#recentWorkspaces = previous.recents;
      this.#tasks = previous.tasks;
      // Issues are not rolled back: the failed save is one of them, and the
      // person needs to keep being told about it.
      const issue = await startup.returnToWorkspace(
        this.#deps.workspace,
        previous.selection,
      );
      if (issue) {
        this.#workspaceSelection = undefined;
        this.#issues = [...this.#issues, issue];
      }
      this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
      throw error;
    }
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  async #refreshMcpServers(): Promise<void> {
    this.#mcpServers = [...(await this.#deps.capabilities.connections())];
    await this.#refreshPlugins();
    this.emit({ kind: "mcpServersChanged", data: this.#mcpServers });
  }

  async #refreshPlugins(): Promise<void> {
    try {
      this.#plugins = [
        ...(await this.#deps.capabilities.pluginStates(this.#mcpServers)),
      ];
      this.emit({ kind: "pluginsChanged", data: this.#plugins });
    } catch {
      this.#reportIssue(
        "Plugins could not be refreshed. What is shown may be out of date.",
      );
    }
  }
}
