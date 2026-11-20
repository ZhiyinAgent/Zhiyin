/**
 * Everything behind the window that is not a turn: the conversations and which
 * one is open, the folder and the folders worked in, preferences, issues, the
 * capability and connection lists, usage and the browser feed — and the one
 * path by which all of it is saved. Model settings sit beside it.
 *
 * Turns run in the agent loop, which reads and writes conversations through the
 * turn host this class hands it. The loop holds none of this state, and the
 * rules for saving it live in one place (ADR 0007, ADR 0002).
 */

import type {
  AppEvent,
  Appearance,
  LookChoice,
  SpellingChoice,
  ArtifactExport,
  ConversationFormat,
  ArtifactPreview,
  ContextBudgetChoice,
  RewindCommitResult,
  SavedConversationsOutcome,
  UsageState,
  WorkspaceContext,
  WorkspaceIssue,
  WorkspaceSnapshot,
  WorkspaceTask,
} from "@zhiyin/contract";
import { emptyConversationLists, VisibleError } from "@zhiyin/contract";
import type { TurnHost } from "@zhiyin/agent-loop";
import type { Artifacts, DestinationChooser } from "@zhiyin/artifacts";
import type { ConversationExport } from "@zhiyin/conversation-export";
import type {
  CapabilityLifecycle,
  CapabilityOverview,
  CommandWatch,
  ConnectionManagement,
  PluginManagement,
} from "@zhiyin/capabilities";
import type { ConversationBrowsers } from "@zhiyin/interactive-browser";
import type {
  ModelClient,
  ModelListControl,
  ProviderDirectory,
} from "@zhiyin/model-client";
import type { Rewind } from "@zhiyin/rewind";
import type {
  HistoryRepair,
  HistoryUpdates,
  KeptStore,
  Sessions,
} from "@zhiyin/session";
import type { Spelling } from "@zhiyin/spelling";
import type { UsageTelemetry } from "@zhiyin/usage";
import type { PartsPort } from "./parts-feed.js";
import type { ScenesPort } from "./scene-feed.js";
import type { DocumentViewerPort } from "./workspace-panel.js";
export type { DocumentViewerPort } from "./workspace-panel.js";
import { ConversationSurfaces } from "./conversation-surfaces.js";
import { OpenConversations } from "./open-conversations.js";
import { ModelSettings } from "./model-settings.js";
import { PersonalChoices } from "./personal-choices.js";
import * as startup from "./startup.js";
import { reached, type WorkspaceTurns } from "./workspace-tasks.js";
export type { WorkspaceTurns } from "./workspace-tasks.js";
import { WorkspacePersistence } from "./workspace-persistence.js";
import { recordUsage } from "./workspace-usage.js";

import { WindowFeed } from "./window-feed.js";
import { WorkspaceRewinds } from "./workspace-rewinds.js";
import type { WorkspacePlugins } from "./workspace-plugins.js";
import { WorkspaceMemory, type MemoryPort } from "./workspace-memory.js";
import type { WorkspaceConnections } from "./workspace-connections.js";
import { CapabilityState } from "./capability-state.js";
import { closeInTurn } from "./closing.js";
import * as produced from "./produced-files.js";
import { Issues } from "./issues.js";
import { WorkspaceFolders } from "./workspace-folders.js";
import type { RecordDamage } from "./conversation-list.js";
import { KeptItems } from "./kept-items.js";
import { Attention, type Notifier } from "./attention.js";
import { LeftAlone } from "./left-alone.js";
import { nextConversation } from "./next-conversation.js";

const modelSettingsIssue =
  "The model's settings could not be read. Open the Model page to check them.";

export type WorkspaceDependencies = {
  readonly onboarding?: boolean;
  /** The folder a conversation starts in when the history names none. */
  readonly startingFolder?: string | undefined;
  readonly sessions: Sessions;
  /** What conversations keep beside themselves. */
  readonly kept: KeptStore;
  /** Examines and recovers a history whose settings will not open. */
  readonly historyRepair: HistoryRepair;
  /** Updates or recycles conversations an older version saved. */
  readonly historyUpdates: HistoryUpdates;
  /**
   * The capabilities group comes in by role, and each part of the workspace
   * takes only the role it uses.
   */
  readonly capabilityOverview: CapabilityOverview;
  readonly pluginManagement: PluginManagement;
  readonly connectionManagement: ConnectionManagement;
  readonly capabilityLifecycle: CapabilityLifecycle;
  /** Which commands run as jobs, so a conversation with one is still at work. */
  readonly commands: Pick<CommandWatch, "runningCommands">;
  readonly workspace: WorkspaceContext;
  readonly artifacts: Artifacts;
  readonly conversationExport: ConversationExport;
  readonly rewind: Rewind;
  readonly usage: UsageTelemetry;
  /** The model as chosen: every request follows the person's choice. */
  readonly model: ModelClient;
  /** Every provider, each set up on its own. */
  readonly modelProviders?: ProviderDirectory;
  /** Zhiyin's model list, which the labs' models and prices come from. */
  readonly modelList?: ModelListControl;
  readonly browsers: ConversationBrowsers;
  /** Each conversation's 3D scene, which the person watches (ADR 0022). */
  readonly scenes?: ScenesPort;
  /** The parts each conversation's CAD studio built last, shown beside it. */
  readonly parts?: PartsPort;
  /** The documents shown beside conversations (ADR 0019). */
  readonly documents: DocumentViewerPort;
  /** Each page's words of a PDF, or nothing when it cannot be read. */
  readonly pdfWords: (
    bytes: Uint8Array,
  ) => Promise<readonly string[] | undefined>;
  readonly newTaskId: () => string;
  readonly now: () => Date;
  /** Every event the window is sent leaves through here. */
  readonly emit: (event: AppEvent) => void;
  /** Keeps why a conversation would not open; absent, it is not kept. */
  readonly recordDamage?: RecordDamage;
  /** The operating system's notifications; absent, none are sent. */
  readonly notifier?: Notifier;
  /** Paints the window light or dark; absent, nothing is painted. */
  readonly appearance?: { readonly apply: (appearance: Appearance) => void };
  /** Dresses the window in a look; absent, nothing is dressed. */
  readonly look?: { readonly apply: (choice: LookChoice) => void };
  /** Checks spelling as the person types; absent, Settings offers none. */
  readonly spelling?: Pick<Spelling, "apply" | "state" | "onChanged">;
  /** What Zhiyin remembers across conversations (ADR 0026); absent, nothing. */
  readonly memory?: MemoryPort;
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
  /** Every conversation, those opened, and the one way a revision is kept. */
  readonly #open: OpenConversations;
  /**
   * Counts the selections asked for, so one still being read when the person
   * asks for another is not shown over it.
   */
  #selectionsAsked = 0;
  #selectedTaskId: string | null = null;
  readonly #issues = new Issues();
  /** Each conversation's folder, and the one shown. */
  readonly #folders: WorkspaceFolders;
  #historyAvailable = true;
  #historyRecovery: WorkspaceSnapshot["historyRecovery"];
  #newerHistory: WorkspaceSnapshot["newerHistory"];
  /**
   * The conversations being condensed now, each with when its summary began;
   * known only while the app runs.
   */
  readonly #compacting = new Map<string, string>();
  /**
   * Saved specialist reports wait for this: the turn that takes one may use a
   * connector.
   */
  #connected = false;
  /** The space beside each conversation, and what the person does there. */
  readonly surfaces: ConversationSurfaces;
  #usage: UsageState = startup.initialUsage;
  /** The key, the models on offer and the model chosen. */
  readonly settings: ModelSettings;
  /** Onboarding, the default budget, standing instructions (ADR 0016). */
  readonly choices = new PersonalChoices(() => this.#choicesChanged());
  readonly #capabilityState: CapabilityState;
  readonly #persistence: WorkspacePersistence;
  readonly #rewinds: WorkspaceRewinds;
  /** What going back to a message, or undoing a turn, would do. */
  readonly rewinds: Pick<
    WorkspaceRewinds,
    "preview" | "previewUndo" | "compareDocument"
  >;
  /** Installing, changing and removing plugins and their components. */
  readonly plugins: WorkspacePlugins;
  /** Connection tokens, tool choices, and checks. */
  readonly connections: WorkspaceConnections;
  /** Pastes and pictures kept beside the conversations. */
  readonly kept: KeptItems;
  /** The Memory page, and each conversation's project. */
  readonly memory: WorkspaceMemory;
  /** Asks for the person outside the window when a conversation needs them. */
  readonly #attention: Attention | undefined;
  /** Closes the browser and Blender of a conversation left alone. */
  readonly #leftAlone: LeftAlone;
  /** What the window was sent, so it is sent only what changed. */
  readonly #window = new WindowFeed();

  constructor(
    deps: WorkspaceDependencies,
    /** Builds whoever runs turns, around the host this workspace provides. */
    runTurns: (host: TurnHost) => WorkspaceTurns,
  ) {
    this.#deps = deps;
    this.#open = new OpenConversations({
      sessions: deps.sessions,
      historyRepair: deps.historyRepair,
      now: deps.now,
      settleAfterRestart: (task) => this.turns.settleAfterRestart(task),
      settleEndedTurn: (task) => this.turns.settleEndedTurn(task),
      save: (commit) => this.#persistence.save(this.#toSave(), commit),
      announce: (task) => this.emit({ kind: "taskChanged", data: task }),
      recordDamage: deps.recordDamage,
    });
    this.#persistence = new WorkspacePersistence(
      deps.sessions,
      () => this.#toSave(),
      () => this.#historyAvailable,
      () => {
        this.#issues.add(UNSAVED_CHANGES);
      },
      () => {
        this.#issues.remove(UNSAVED_CHANGES);
      },
    );
    this.#folders = new WorkspaceFolders({
      workspace: deps.workspace,
      issues: this.#issues,
      tasks: () => this.#open.opened(),
      changeTask: (taskId, change) => this.#open.changeFolder(taskId, change),
      selectedTaskId: () => this.#selectedTaskId,
      works: (taskId) =>
        this.turns.running(taskId) ||
        deps.commands.runningCommands(taskId).length > 0,
      beforeChange: (taskId) => this.#rewinds.beforeChange(taskId),
      save: () => this.#persistence.save(),
      snapshotChanged: () => this.#snapshotChanged(),
    });
    this.settings = new ModelSettings(
      deps.model,
      (event) => this.emit(event),
      deps.modelProviders,
      {
        // What a conversation's browser offers follows whether the model sees
        // pictures.
        modelChanged: () => deps.capabilityLifecycle.modelChanged(),
        ...(deps.modelList ? { modelList: deps.modelList } : {}),
      },
    );
    deps.spelling?.onChanged(() => this.#snapshotChanged());
    this.surfaces = new ConversationSurfaces({
      browsers: deps.browsers,
      scenes: deps.scenes,
      parts: deps.parts,
      documents: deps.documents,
      emit: (event) => this.emit(event),
      folderOf: (taskId) => this.#folderOf(taskId),
      reached: (taskId) => {
        const task = this.#open.find(taskId);
        return task ? reached(task) : 0;
      },
      exists: (taskId) => this.#open.has(taskId),
      selected: () => this.#selectedTaskId,
    });
    this.#rewinds = new WorkspaceRewinds({
      rewind: deps.rewind,
      open: (id) => this.#ensureOpen(id).then(() => undefined),
      task: (id) => this.#open.required(id),
      save: (task) => this.#open.replace(task),
      historyAvailable: () => this.#historyAvailable,
      running: (taskId) => this.turns.running(taskId),
      pdfWords: deps.pdfWords,
      memory: {
        effects: (actions) => this.memory.effects(actions),
        takeBack: (effects, choice, cardsStay) =>
          this.memory.takeBack(effects, choice, cardsStay),
      },
    });
    this.rewinds = this.#rewinds;
    this.#capabilityState = new CapabilityState({
      capabilityOverview: deps.capabilityOverview,
      pluginManagement: deps.pluginManagement,
      connectionManagement: deps.connectionManagement,
      emit: (event) => this.emit(event),
      addIssue: (issue) => void this.#issues.add(issue),
      reportIssue: (notice) => this.#reportIssue(notice),
      changed: () => this.#snapshotChanged(),
    });
    this.plugins = this.#capabilityState.plugins;
    this.connections = this.#capabilityState.connections;
    this.memory = new WorkspaceMemory({
      memory: deps.memory,
      emit: (event) => this.emit(event),
      tasks: () => this.#open.opened(),
      ready: (taskId) => this.#readyToChange(taskId),
      save: (task) => this.#open.replace(task),
      folderOf: (taskId) => this.#folderOf(taskId),
      now: deps.now,
    });
    // Looked up again first when the last look could not reach the model's
    // details.
    this.kept = new KeptItems(deps.kept, async () => {
      await this.settings.readIfUnknown();
      return this.settings.seesPictures();
    });
    this.turns = runTurns({
      find: (taskId) => this.#open.find(taskId),
      store: (task, options) => this.#open.store(task, options),
      historyAvailable: () => this.#historyAvailable,
      capabilitiesAvailable: () => this.#capabilityState.available(),
      ...this.settings.forTurns(),
      ...this.choices.forTurns(),
      reviewerModel: async () => {
        const choice = this.choices.reviewerModel();
        return choice ? this.settings.reviewerFor(choice) : undefined;
      },
      enterFolderOf: (taskId) => this.#folders.enterFolderOf(taskId),
      settleRewind: (taskId) => this.#rewinds.settle(taskId),
      ...this.surfaces.forTurns(),
      refreshConnections: () => this.#capabilityState.refresh(),
      recordUsage: (usage) => this.#recordUsage(usage),
      reportIssue: (notice) => this.#reportIssue(notice),
      compacting: (taskId, running) => {
        if (!running) this.#compacting.delete(taskId);
        else if (!this.#compacting.has(taskId))
          this.#compacting.set(taskId, this.#deps.now().toISOString());
        this.#snapshotChanged();
      },
    });
    this.#leftAlone = new LeftAlone({
      inUse: (taskId) =>
        this.turns.running(taskId) || this.#selectedTaskId === taskId,
      close: (taskId) => deps.capabilityLifecycle.restConversation(taskId),
    });
    this.#attention = deps.notifier
      ? new Attention({
          notifier: deps.notifier,
          now: deps.now,
          enabled: () => this.choices.notifies(),
          open: (taskId) => void this.selectTask(taskId).catch(() => undefined),
        })
      : undefined;
  }

  emit(event: AppEvent): void {
    this.#attention?.observe(event);
    this.surfaces.observe(event);
    this.#leftAlone.observe(event);
    const sent = this.#window.translate(event);
    if (sent) this.#deps.emit(sent);
  }

  /** A window that holds nothing yet is sent the whole workspace. */
  attachWindow(): void {
    this.#window.restart();
    this.surfaces.unviewAll();
    this.#snapshotChanged();
  }

  /** The window is sent the whole workspace again: something in it moved. */
  #snapshotChanged(): void {
    this.emit({ kind: "workspaceSnapshot", data: this.snapshot() });
  }

  /** For a window that missed a change to this conversation. */
  async resendTask(taskId: string): Promise<void> {
    const task = this.#open.find(taskId);
    if (!task) return;
    this.#window.resend(taskId);
    this.emit({ kind: "taskChanged", data: task });
  }

  async initialize(): Promise<void> {
    if (this.turns.anyRunning()) return;
    this.#connected = false;
    const restored = await startup.loadStartup(
      { ...this.#deps, capabilityState: this.#capabilityState },
      {
        tasks: this.#open.opened(),
        conversations: this.#open.listed(),
        selectedTaskId: this.#selectedTaskId,
        historyRecovery: this.#historyRecovery,
      },
    );
    this.#open.replaceAll(restored.tasks, restored.conversations);
    this.#selectedTaskId = restored.selectedTaskId;
    this.choices.restore(restored.settings);
    this.#deps.appearance?.apply(this.choices.appearance());
    this.#deps.look?.apply(this.choices.look());
    await this.#deps.spelling?.apply(this.choices.spelling());
    this.#folders.restore(restored);
    this.#issues.replace(restored.issues);
    this.#historyAvailable = restored.historyAvailable;
    this.#historyRecovery = restored.historyRecovery;
    this.#newerHistory = restored.newerHistory;
    this.#capabilityState.restore(restored.plugins);
    this.#usage = restored.usage;
    // One that will not open stays selected: its report is shown in its place.
    await this.#openSelected();
    const rewindIssue = await this.#rewinds.resume();
    if (rewindIssue) this.#issues.add(rewindIssue);
    if (restored.needsSave) await this.#persistence.save();
    void this.#capabilityState.connect().then(() => {
      this.#connected = true;
      this.turns.wakeSaved(this.#open.opened());
    });
    // Provider settings look the model up in the provider's catalogue, so like
    // connections they arrive when they arrive.
    void this.settings
      .refresh()
      .catch(() => this.#reportIssue(modelSettingsIssue));
  }

  /**
   * Resolves once the connections have either arrived or failed. Present so a
   * caller that needs them — a test, or a shutdown — can wait rather than poll.
   */
  connectionsReady(): Promise<void> {
    return this.#capabilityState.ready();
  }

  snapshot(): WorkspaceSnapshot {
    return this.#snapshotWith(this.#folders.shownField());
  }

  /** The snapshot, with the folder field given. */
  #snapshotWith(folder: {
    readonly workspace?: NonNullable<WorkspaceSnapshot["workspace"]>;
  }): WorkspaceSnapshot {
    return {
      ...(this.#historyRecovery
        ? { historyRecovery: this.#historyRecovery }
        : {}),
      ...(this.#newerHistory ? { newerHistory: this.#newerHistory } : {}),
      ...(this.#compacting.size
        ? {
            compacting: [...this.#compacting].map(([taskId, since]) => ({
              taskId,
              since,
            })),
          }
        : {}),
      runtime: {
        tasks: this.#historyAvailable ? "available" : "unavailable",
        capabilities: this.#capabilityState.available()
          ? "available"
          : "unavailable",
      },
      ...this.choices.snapshot(),
      ...(this.#deps.spelling ? { spelling: this.#deps.spelling.state() } : {}),
      ...folder,
      ...(this.#folders.launchFolders().length
        ? { launchFolders: this.#folders.launchFolders() }
        : {}),
      recentWorkspaces: this.#folders.recents(),
      ...(this.#issues.list().length ? { issues: this.#issues.list() } : {}),
      tasks: [...this.#open.opened()],
      conversations: this.#open.listed(),
      selectedTaskId: this.#selectedTaskId,
      ...this.#capabilityState.fields(),
      ...this.surfaces.fields(this.#selectedTaskId),
      usage: this.#usage,
    };
  }

  /**
   * Opens the conversation selected without the person choosing it, at launch
   * or once history is settled, and shows its folder as selecting it would,
   * whatever folder this launch named.
   */
  async #openSelected(): Promise<void> {
    const taskId = this.#selectedTaskId;
    if (!taskId || !(await this.#ensureOpen(taskId))) return;
    const selected = this.#open.find(taskId);
    if (selected) await this.#folders.show(selected);
  }

  /**
   * Opens a conversation the person is about to change, settled first and
   * refused while its files are restored; false when it cannot be opened.
   */
  async #readyToChange(taskId: string): Promise<boolean> {
    if (!(await this.#ensureOpen(taskId))) return false;
    await this.#rewinds.beforeChange(taskId);
    return true;
  }

  /**
   * Reads a conversation from disk the first time it is needed, and answers
   * whether it is open. One that cannot be read is reported and stays closed.
   */
  async #ensureOpen(taskId: string): Promise<boolean> {
    if (this.#open.isOpen(taskId)) return true;
    const opened = await this.#open.read(taskId);
    // Deleted while it was read: it stays gone.
    if (!this.#open.has(taskId)) return false;
    // A report that it could not be read no longer holds once it has been.
    if (opened.task) this.#issues.forgetConversation(taskId);
    if (opened.issue) this.#reportIssue(opened.issue);
    if (!opened.task) return false;
    // Another caller may have opened it while this one was reading.
    this.#open.adopt(opened.task);
    if (opened.changed) await this.#persistence.save();
    this.emit({ kind: "taskChanged", data: opened.task });
    // One read before the connections arrive is woken with the rest.
    if (this.#connected) this.turns.wakeSaved([opened.task]);
    // On screen already, as one that could not be read is: it now shows its
    // folder, however it came to be read.
    if (
      this.#selectedTaskId === taskId &&
      (await this.#folders.show(opened.task))
    )
      this.#snapshotChanged();
    return true;
  }

  async createTask(): Promise<string> {
    if (!this.#historyAvailable)
      throw new VisibleError("Restore saved history before creating a task.");
    const asked = ++this.#selectionsAsked;
    const folder = this.#folders.forNew();
    // In the folder being chosen, rather than the one it replaces.
    await this.#folders.settledForNew();
    // The person opened another conversation while it waited: it is created
    // and listed, and the window stays where they went.
    const shown = asked === this.#selectionsAsked;
    const id = this.#deps.newTaskId();
    const task: WorkspaceTask = {
      id,
      title: "New conversation",
      titleSource: "generated",
      updatedAt: this.#deps.now().toISOString(),
      updatedLabel: "Now",
      messages: [],
      ...emptyConversationLists,
      ...this.#folders.startNew(shown ? undefined : { folder }),
      phase: { kind: "draft" },
    };
    this.#open.add(task);
    if (shown) this.#selectedTaskId = id;
    await this.#persistence.save();
    this.emit({ kind: "taskChanged", data: task });
    if (shown)
      this.emit({ kind: "taskSelectionChanged", data: { taskId: id } });
    return id;
  }

  async selectTask(taskId: string): Promise<void> {
    if (!this.#open.has(taskId))
      throw new Error("The selected task does not exist.");
    const asked = ++this.#selectionsAsked;
    const open = await this.#ensureOpen(taskId);
    // The person went elsewhere, or deleted it, while it was read: the window
    // stays where they went.
    if (asked !== this.#selectionsAsked || !this.#open.has(taskId)) return;
    if (!open) {
      // Selected all the same: the window shows what is wrong with it where
      // the conversation would be, in place of whatever was shown before.
      this.#selectedTaskId = taskId;
      this.surfaces.announce(taskId);
      this.emit({ kind: "taskSelectionChanged", data: { taskId } });
      this.#snapshotChanged();
      return;
    }
    const task = this.#open.required(taskId);
    this.#selectedTaskId = taskId;
    const moved = await this.#folders.show(task);
    if (this.#selectedTaskId !== taskId) {
      // The person went elsewhere, or deleted it, while its folder opened:
      // the window stays where they went, told only of an issue that changed.
      if (moved) this.#snapshotChanged();
      return;
    }
    await this.#persistence.save();
    // Gone elsewhere while the choice was saved: the window is told only of
    // where the person went.
    if (this.#selectedTaskId !== taskId) {
      if (moved) this.#snapshotChanged();
      return;
    }
    this.surfaces.announce(taskId);
    this.emit({
      kind: "taskSelectionChanged",
      data: { taskId },
    });
    // The window now shows a different folder than it did, or an issue that
    // was not there before; either way the whole snapshot has moved.
    if (moved) this.#snapshotChanged();
  }

  /**
   * Reads a listed conversation without showing it, so a window can show its
   * details. One that cannot be read is refused with the reason.
   */
  async openTask(taskId: string): Promise<void> {
    if (!this.#open.has(taskId))
      throw new Error("The conversation does not exist.");
    if (await this.#ensureOpen(taskId)) return;
    const issue = this.#issues
      .list()
      .find((item) => item.conversationId === taskId);
    throw new VisibleError(
      issue?.message ?? "This conversation could not be opened.",
    );
  }

  /**
   * No conversation open. The folder stays as it is: it is the folder the next
   * conversation will be started in, and `createTask` gives it to whatever is
   * created next.
   */
  async selectNothing(): Promise<void> {
    this.#selectionsAsked += 1;
    if (this.#selectedTaskId === null) return;
    this.#selectedTaskId = null;
    await this.#persistence.save();
    this.emit({ kind: "taskSelectionChanged", data: { taskId: null } });
  }

  async renameTask(taskId: string, title: string): Promise<void> {
    const value = title.trim();
    if (!value) throw new Error("Enter a conversation name.");
    // Named from the list, so it may not have been opened yet.
    if (!(await this.#readyToChange(taskId))) return;
    const task = this.#open.required(taskId);
    await this.#open.replace({ ...task, title: value, titleSource: "manual" });
  }

  async setContextBudget(
    taskId: string,
    budget: ContextBudgetChoice,
  ): Promise<void> {
    if (!(await this.#readyToChange(taskId))) return;
    const task = this.#open.required(taskId);
    await this.#open.replace({ ...task, contextBudget: budget });
  }

  setDefaultContextBudget = (budget: ContextBudgetChoice) =>
    this.choices.setDefaultContextBudget(budget);

  /**
   * Painted as chosen, as the snapshot says, whether or not the choice could
   * be saved: one that could not stays, and is said to be not yet stored.
   */
  async setAppearance(appearance: Appearance): Promise<void> {
    await this.choices
      .setAppearance(appearance)
      .finally(() => this.#deps.appearance?.apply(appearance));
  }

  /** Applied as chosen, as the appearance is. */
  async setLook(choice: LookChoice): Promise<void> {
    await this.choices
      .setLook(choice)
      .finally(() => this.#deps.look?.apply(this.choices.look()));
  }

  /** Applied as chosen, as the appearance is. */
  async setSpelling(choice: SpellingChoice): Promise<void> {
    await this.choices
      .setSpelling(choice)
      .finally(() => this.#deps.spelling?.apply(choice));
  }

  /** A choice is kept and shown, saved or not; one not saved is said. */
  async #choicesChanged(): Promise<void> {
    await this.#persistence.save().finally(() => this.#snapshotChanged());
  }

  /**
   * Files put back are drawn again as they now are, or said to be gone.
   * Undoing memory changes is the default, as the person's dialog offers it.
   */
  async commitRewind(
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
    memory: "keep" | "undo" = "undo",
  ): Promise<RewindCommitResult> {
    const result = await this.#rewinds.commit(taskId, rewindId, files, memory);
    await this.surfaces.wentBack(
      taskId,
      reached(this.#open.required(taskId)),
      files,
    );
    return result;
  }

  async commitUndo(
    taskId: string,
    undoId: string,
    files: "keep" | "restore" = "restore",
    memory: "keep" | "undo" = "undo",
  ): Promise<RewindCommitResult> {
    const result = await this.#rewinds.commitUndo(
      taskId,
      undoId,
      files,
      memory,
    );
    await this.surfaces.refresh(taskId);
    return result;
  }

  async deleteTask(taskId: string): Promise<void> {
    if (!this.#open.has(taskId)) throw new Error("The task does not exist.");
    // The store never removes a conversation waiting for an update, so taking
    // it off the list would only hide it until the next launch.
    const waiting = this.#open.waiting(taskId);
    if (waiting)
      throw new VisibleError(
        `“${waiting.title}” needs an update first. Update it, or move it to the Recycle Bin, from the question about saved conversations.`,
      );
    if (this.turns.running(taskId)) await this.turns.cancel(taskId);
    await this.surfaces.forget(taskId);
    await this.#deps.capabilityLifecycle.forgetConversation(taskId);
    this.#deps.workspace.leaveFolder?.(taskId);
    this.#leftAlone.forget(taskId);
    const next = this.#open.remove(taskId);
    this.#issues.forgetConversation(taskId);
    let moved = false;
    if (this.#selectedTaskId === taskId) {
      const asked = ++this.#selectionsAsked;
      // Never the deleted one, while the next is read or once the person
      // went elsewhere.
      this.#selectedTaskId = null;
      const shown = await nextConversation(next, {
        listed: () => this.#open.listed(),
        exists: (id) => this.#open.has(id),
        open: (id) => this.#ensureOpen(id),
        wanted: () => asked === this.#selectionsAsked,
      });
      // Gone somewhere else while the next one was read: that stays on screen.
      if (asked === this.#selectionsAsked) {
        this.#selectedTaskId = shown;
        // The next conversation is opened in its own folder, as selecting it is.
        const opened = this.#selectedTaskId
          ? this.#open.find(this.#selectedTaskId)
          : undefined;
        if (opened) moved = await this.#folders.show(opened);
      }
    }
    await this.#persistence.save();
    // What it kept beside itself goes with it: its pictures, pastes, saved
    // outputs and the copies taken before its file changes. A file that will
    // not go yet does not keep the conversation.
    await this.#deps.kept.forgetConversation(taskId).catch(() => {});
    await this.#deps.rewind.forgetConversation(taskId).catch(() => {});
    await this.memory.conversationDeleted(taskId).catch(() => {});
    if (this.#selectedTaskId) this.surfaces.announce(this.#selectedTaskId);
    this.emit({
      kind: "taskRemoved",
      data: { taskId, selectedTaskId: this.#selectedTaskId },
    });
    if (moved) this.#snapshotChanged();
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
    this.settings.stop();
    return closeInTurn([
      ["conversation turns", () => this.turns.shutdown()],
      [
        "browsers and connections",
        () => this.#deps.capabilityLifecycle.shutdown(),
      ],
    ]).finally(() => {
      this.#leftAlone.stop();
      this.surfaces.stop();
    });
  }

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

  /**
   * The folder a conversation works in, which the paths it recorded are
   * relative to: its own, or, when it never named one, the one the tools give
   * it.
   */
  #folderOf(taskId: string): string | undefined {
    return (
      this.#open.find(taskId)?.workspace?.path ??
      this.#deps.workspace.workspaceRoot(taskId)
    );
  }

  previewArtifact = (taskId: string, path: string): Promise<ArtifactPreview> =>
    produced.previewArtifact(
      this.#deps.artifacts,
      this.#open.opened(),
      taskId,
      path,
      this.#folderOf(taskId),
    );

  exportArtifact = (
    taskId: string,
    path: string,
    choose: DestinationChooser,
  ): Promise<ArtifactExport> =>
    produced.exportArtifact(
      this.#deps.artifacts,
      this.#open.opened(),
      taskId,
      path,
      this.#folderOf(taskId),
      choose,
    );

  /** The whole record, opened from disk when the list is all that is loaded. */
  exportConversation = async (
    taskId: string,
    format: ConversationFormat,
    choose: DestinationChooser,
  ): Promise<ArtifactExport> =>
    produced.exportConversation(
      this.#deps.conversationExport,
      (await this.#ensureOpen(taskId))
        ? (this.#open.find(taskId) ?? "gone")
        : "unopened",
      format,
      choose,
      (source) => this.kept.readPicture(source),
    );

  exportView = (
    taskId: string,
    viewId: string,
    svg: string,
    choose: DestinationChooser,
  ): Promise<ArtifactExport> =>
    produced.exportView(this.#deps.artifacts, this.#open.opened(), {
      taskId,
      viewId,
      svg,
      chooseDestination: choose,
    });

  /** What a save writes: every conversation at its newest revision, committed yet or not. */
  #toSave(): WorkspaceSnapshot {
    const snapshot = this.#snapshotWith(this.#folders.savedField());
    return { ...snapshot, tasks: this.#open.forSave(snapshot.tasks) };
  }

  /** Said once, and the window is told at once rather than at the next change. */
  #reportIssue(notice: string | WorkspaceIssue): void {
    if (!this.#issues.add(notice)) return;
    this.#snapshotChanged();
  }

  /**
   * Stops showing an issue the person has read, and only that one: another
   * conversation's report with the same words stays.
   */
  async dismissIssue(message: string, conversationId?: string): Promise<void> {
    this.#issues.withdraw(
      conversationId ? { message, conversationId } : { message },
    );
    this.#snapshotChanged();
  }

  /**
   * The answer to the damaged-history question, and the only thing that writes
   * over a damaged file. Until this is called the history is left exactly as it
   * was found.
   */
  async recoverHistory(choice: "recover" | "startFresh"): Promise<void> {
    await startup.recoverHistory(
      this.#deps.historyRepair,
      this.#historyRecovery,
      choice,
    );
    this.#historyRecovery = undefined;
    this.#historyAvailable = true;
    this.#issues.replace([]);
    // The store has cleared the damage, so what is read next is a first launch.
    if (choice === "startFresh") {
      this.#open.replaceAll([], []);
      this.#selectedTaskId = null;
    }
    await this.initialize();
    this.#snapshotChanged();
  }

  /**
   * The answer to the question about conversations an older version saved.
   * Each is updated, or moved to the Recycle Bin, on its own; one that cannot
   * be stays listed as it was, waiting, and is counted. ADR 0025.
   */
  async settleSavedConversations(
    choice: "update" | "recycle",
  ): Promise<SavedConversationsOutcome> {
    let outcome: SavedConversationsOutcome;
    if (choice === "update") {
      const result = await this.#deps.historyUpdates.updateConversations();
      this.#open.updated(result.updated);
      for (const item of result.updated)
        this.#issues.forgetConversation(item.id);
      outcome = { done: result.updated.length, failed: result.failed };
    } else {
      const result =
        await this.#deps.historyUpdates.recycleOutdatedConversations();
      for (const id of result.recycled) {
        this.#open.remove(id);
        this.#issues.forgetConversation(id);
      }
      if (this.#selectedTaskId && !this.#open.has(this.#selectedTaskId))
        this.#selectedTaskId =
          this.#open.listed().find((item) => !item.needsUpdate)?.id ?? null;
      outcome = { done: result.recycled.length, failed: result.failed };
    }
    await this.#openSelected();
    await this.#persistence.save();
    this.#snapshotChanged();
    return outcome;
  }

  async configureProfile(interests: readonly string[]): Promise<void> {
    await this.#capabilityState
      .configureProfile({
        interests,
        setPreferences: (preferences) =>
          (this.choices.preferences = preferences),
        persist: () => this.#persistence.save(),
      })
      .finally(() => this.#snapshotChanged());
  }

  /**
   * The folder picker: the folder of the conversation on screen, or, with
   * none open, the one the next conversation starts in.
   */
  selectWorkspace(path: string): Promise<void> {
    return this.#folders.choose(path);
  }
}
