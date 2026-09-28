/**
 * The front desk between the app's window and everything behind it.
 *
 * Every command the window sends arrives here, is checked for shape, and goes
 * to whoever answers it: the workspace, which holds the conversations and the
 * app state around them, or the agent loop, which runs a turn. What the window
 * may not decide for itself is decided here too — which folder may be reopened
 * without a dialog, and when startup is tried again — so the Electron main
 * process only carries messages (ADR 0034).
 *
 * Boundaries and invariants: docs/architecture/features/core/README.md
 */

import {
  COMMAND_CHANNELS,
  type CommandName,
  type Commands,
  type ViewCheckOutcome,
} from "@zhiyin/contract";
import type { ModelSettings } from "./model-settings.js";
import { validateCommand } from "./validation.js";
import type { Workspace, WorkspaceTurns } from "./workspace.js";

export type { ModelSettings } from "./model-settings.js";
export {
  Workspace,
  type WorkspaceDependencies,
  type WorkspaceTurns,
} from "./workspace.js";

/** What the core asks of the workspace, and of the turns it runs. */
export type CoreWorkspace = Pick<
  Workspace,
  | "initialize"
  | "snapshot"
  | "evidence"
  | "clearEvidence"
  | "emit"
  | "shutdown"
  | "configureProfile"
  | "recoverHistory"
  | "selectWorkspace"
  | "createTask"
  | "selectNothing"
  | "selectTask"
  | "renameTask"
  | "setContextBudget"
  | "setDefaultContextBudget"
  | "choices"
  | "deleteTask"
  | "kept"
  | "previewRewind"
  | "commitRewind"
  | "setPluginEnabled"
  | "setComponentEnabled"
  | "componentContent"
  | "overrideComponent"
  | "resetComponent"
  | "installToolchain"
  | "installPlugin"
  | "updatePlugin"
  | "rollbackPlugin"
  | "removePlugin"
  | "createPlugin"
  | "savePluginContents"
  | "editablePluginContents"
  | "setMcpServerToolEnabled"
  | "testMcpConnection"
  | "saveMcpServerToken"
  | "clearMcpServerToken"
  | "refreshConnections"
  | "shellAvailability"
  | "recheckShell"
  | "driveBrowser"
  | "previewArtifact"
  | "exportArtifact"
  | "exportView"
> & {
  readonly turns: Pick<
    WorkspaceTurns,
    | "start"
    | "cancel"
    | "condenseNow"
    | "resolveApproval"
    | "revokeConversationPermission"
    | "resolveUserInput"
  >;
  readonly settings: Pick<
    ModelSettings,
    | "current"
    | "saveApiKey"
    | "clearApiKey"
    | "models"
    | "modelProviders"
    | "selectModel"
  >;
};

export type CoreDependencies = {
  readonly workspace: CoreWorkspace;
  /** One instance owns the saved data at a time. */
  readonly ownership: {
    claim(): Promise<void>;
    release(): Promise<void>;
  };
  readonly viewChecks: {
    answer(requestId: string, outcome: ViewCheckOutcome): void;
    abandon(): void;
  };
  /** Asks the person for a folder; nothing when they cancel. */
  readonly chooseFolder: () => Promise<string | undefined>;
  /** Asks the person where to save a copy; nothing when they cancel. */
  readonly chooseSaveLocation: (
    title: string,
    suggestedName: string,
  ) => Promise<string | undefined>;
  /** Opens a URL in the person's own browser, never this app's window. */
  readonly openExternal: (url: string) => Promise<void>;
  /** Opens a file the app kept in the program the person uses for it. */
  readonly openPath: (path: string) => Promise<void>;
  readonly version: string;
};

const commandByChannel = new Map(
  Object.entries(COMMAND_CHANNELS).map(
    ([name, channel]) => [channel as string, name as CommandName] as const,
  ),
);

export class Core {
  readonly #deps: CoreDependencies;
  /** One handler per command, held to the shape the window is offered. */
  readonly #commands: Commands;
  #ready: Promise<void> = Promise.resolve();

  constructor(deps: CoreDependencies) {
    this.#deps = deps;
    const {
      workspace,
      viewChecks,
      chooseFolder,
      chooseSaveLocation,
      openExternal,
      openPath,
    } = deps;
    const { turns, settings } = workspace;
    this.#commands = {
      frontendReady: () => this.#attach(),
      readEvidence: () => workspace.evidence(),
      clearEvidence: (kind) => workspace.clearEvidence(kind),
      configureProfile: (interests) => workspace.configureProfile(interests),
      recoverHistory: (choice) => workspace.recoverHistory(choice),
      chooseWorkspace: () => this.chooseWorkspace(),
      useRecentWorkspace: (path) => this.#useRecentWorkspace(path),
      createTask: () => workspace.createTask(),
      selectTask: (taskId) => workspace.selectTask(taskId),
      selectNothing: () => workspace.selectNothing(),
      renameTask: (taskId, title) => workspace.renameTask(taskId, title),
      deleteTask: (taskId) => workspace.deleteTask(taskId),
      sendMessage: (taskId, message, reasoning, attachments) =>
        turns.start(taskId, message, reasoning, attachments),
      keepPaste: (text) => workspace.kept.keepPaste(text),
      setContextBudget: (taskId, budget) =>
        workspace.setContextBudget(taskId, budget),
      setDefaultContextBudget: (budget) =>
        workspace.setDefaultContextBudget(budget),
      setPersonalInstructions: (text) =>
        workspace.choices.setPersonalInstructions(text),
      condenseNow: (taskId) => turns.condenseNow(taskId),
      openAttachment: async (taskId, id) =>
        openPath(await workspace.kept.attachmentPath(taskId, id)),
      previewRewind: (taskId, messageId) =>
        workspace.previewRewind(taskId, messageId),
      commitRewind: (taskId, rewindId, files) =>
        workspace.commitRewind(taskId, rewindId, files),
      interruptTask: (taskId) => turns.cancel(taskId),
      resolveApproval: (taskId, requestId, decision, reason) =>
        turns.resolveApproval(taskId, requestId, decision, reason),
      revokeConversationPermission: (taskId, permissionId) =>
        turns.revokeConversationPermission(taskId, permissionId),
      resolveUserInput: (taskId, requestId, response) =>
        turns.resolveUserInput(taskId, requestId, response),
      setPluginEnabled: (id, enabled) =>
        workspace.setPluginEnabled(id, enabled),
      setComponentEnabled: (id, enabled) =>
        workspace.setComponentEnabled(id, enabled),
      componentContent: (id) => workspace.componentContent(id),
      overrideComponent: (id, content) =>
        workspace.overrideComponent(id, content),
      resetComponent: (id) => workspace.resetComponent(id),
      installToolchain: (id) => workspace.installToolchain(id),
      installPlugin: () => workspace.installPlugin(chooseFolder),
      updatePlugin: (id) => workspace.updatePlugin(id, chooseFolder),
      rollbackPlugin: (id) => workspace.rollbackPlugin(id),
      removePlugin: (id) => workspace.removePlugin(id),
      createPlugin: (displayName, description) =>
        workspace.createPlugin(displayName, description),
      savePluginContents: (id, contents) =>
        workspace.savePluginContents(id, contents),
      editablePluginContents: (id) => workspace.editablePluginContents(id),
      setMcpServerToolEnabled: (id, toolName, enabled) =>
        workspace.setMcpServerToolEnabled(id, toolName, enabled),
      testMcpConnection: (server, token) =>
        workspace.testMcpConnection(server, token),
      saveMcpServerToken: (id, token) =>
        workspace.saveMcpServerToken(id, token),
      clearMcpServerToken: (id) => workspace.clearMcpServerToken(id),
      refreshConnections: () => workspace.refreshConnections(),
      shellAvailability: () => workspace.shellAvailability(),
      recheckShell: () => workspace.recheckShell(),
      openExternalUrl: (url) => openExternal(url),
      driveBrowser: (intent) => workspace.driveBrowser(intent),
      saveProviderApiKey: (apiKey) => settings.saveApiKey(apiKey),
      clearProviderApiKey: () => settings.clearApiKey(),
      listModels: () => settings.models(),
      listModelProviders: (model) => settings.modelProviders(model),
      selectModel: (model, providers) => settings.selectModel(model, providers),
      readPicture: (source) => workspace.kept.readPicture(source),
      previewArtifact: (taskId, path) =>
        workspace.previewArtifact(taskId, path),
      exportArtifact: (taskId, path) =>
        workspace.exportArtifact(taskId, path, (suggestedName) =>
          chooseSaveLocation("Save a copy", suggestedName),
        ),
      exportView: (taskId, viewId, svg) =>
        workspace.exportView(taskId, viewId, svg, (suggestedName) =>
          chooseSaveLocation("Save image", suggestedName),
        ),
      answerViewCheck: async (requestId, outcome) =>
        viewChecks.answer(requestId, outcome),
    };
  }

  /**
   * Claims the saved data and starts the workspace. One instance owns the data
   * at a time: Electron turns a second launch back at the door, and the store's
   * own claim covers what Electron cannot see, such as a second copy pointed at
   * the same folder.
   */
  start(): void {
    const { ownership, workspace } = this.#deps;
    this.#ready = ownership.claim().then(() => workspace.initialize());
    void this.#ready.catch(() => undefined);
  }

  /** Answers one command from the window, once its arguments have the right shape. */
  async receive(channel: string, args: readonly unknown[]): Promise<unknown> {
    validateCommand(channel, args);
    const name = commandByChannel.get(channel);
    if (!name)
      throw new Error(
        "This request is invalid. Reopen the page and try again.",
      );
    const handler = this.#commands[name] as (
      ...args: readonly unknown[]
    ) => unknown;
    return handler(...args);
  }

  /** Asks for a folder and opens it; choosing nothing changes nothing. */
  async chooseWorkspace(): Promise<void> {
    const path = await this.#deps.chooseFolder();
    if (path) await this.#deps.workspace.selectWorkspace(path);
  }

  /** The window has gone, so no view check it was asked can be answered. */
  windowClosed(): void {
    this.#deps.viewChecks.abandon();
  }

  /**
   * Gives up the saved data once the workspace has stopped writing to it, or
   * has stopped being waited for. Answers what had not finished closing.
   */
  async shutdown(): Promise<readonly string[]> {
    const { workspace, ownership } = this.#deps;
    const unfinished = await workspace.shutdown();
    await ownership.release();
    return unfinished;
  }

  /**
   * A handshake rather than an event at startup: the core is ready long before
   * the window attaches a listener, so anything sent during setup is lost.
   * Startup that failed, or that could not open the saved history, is tried
   * again when the window arrives.
   */
  async #attach(): Promise<void> {
    const { workspace, version } = this.#deps;
    try {
      await this.#ready;
    } catch {
      this.#ready = workspace.initialize();
      await this.#ready;
    }
    if (workspace.snapshot().runtime.tasks === "unavailable") {
      this.#ready = workspace.initialize();
      await this.#ready;
    }
    workspace.emit({ kind: "coreReady", data: { version } });
    workspace.emit({ kind: "workspaceSnapshot", data: workspace.snapshot() });
    // Settings still being looked up reach the window as their own event.
    const provider = workspace.settings.current();
    if (provider)
      workspace.emit({ kind: "providerSettingsChanged", data: provider });
  }

  /**
   * Returning to a folder skips the dialog, so the path must be one a person
   * has already chosen in one. Without that, the window could name any folder
   * on the machine.
   */
  async #useRecentWorkspace(path: string): Promise<void> {
    const { workspace } = this.#deps;
    const known = workspace
      .snapshot()
      .recentWorkspaces?.some((folder) => folder.path === path);
    if (!known) throw new Error("That folder has not been opened before.");
    await workspace.selectWorkspace(path);
  }
}
