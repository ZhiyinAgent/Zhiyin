import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  COMMAND_CHANNELS,
  type ArtifactExport,
  VisibleError,
  type CommandName,
  type CommandOutput,
  type Commands,
  type RunningCommand,
  type ViewCheckOutcome,
} from "@zhiyin/contract";
import type { ModelSettings } from "./model-settings.js";
import { validateCommand } from "./validation.js";
import type { Workspace, WorkspaceTurns } from "./workspace.js";

/** What the core asks of the workspace, and of the turns it runs. */
export type CoreWorkspace = Pick<
  Workspace,
  | "initialize"
  | "snapshot"
  | "emit"
  | "shutdown"
  | "configureProfile"
  | "recoverHistory"
  | "settleSavedConversations"
  | "selectWorkspace"
  | "createTask"
  | "selectNothing"
  | "attachWindow"
  | "resendTask"
  | "selectTask"
  | "renameTask"
  | "setContextBudget"
  | "setDefaultContextBudget"
  | "setAppearance"
  | "setSpelling"
  | "choices"
  | "deleteTask"
  | "dismissIssue"
  | "kept"
  | "previewRewind"
  | "commitRewind"
  | "previewUndo"
  | "commitUndo"
  | "compareDocument"
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
  | "connections"
  | "shellAvailability"
  | "recheckShell"
  | "driveBrowser"
  | "chooseWorkspaceView"
  | "showDocument"
  | "closeDocument"
  | "drawDocumentPage"
  | "locateDocument"
  | "previewArtifact"
  | "exportArtifact"
  | "exportView"
  | "exportConversation"
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

/**
 * Commands that carried on as jobs (ADR 0007), as the person sees and stops
 * them. Held by the capabilities, not by the workspace: a job is a running
 * process, not saved state.
 */
export type CoreCommands = {
  runningCommands(taskId: string): readonly RunningCommand[];
  commandOutput(
    taskId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  stopCommandForPerson(taskId: string, jobId: string): Promise<void>;
  onCommandsChanged(watcher: (taskId: string) => void): void;
};

export type CoreDependencies = {
  readonly workspace: CoreWorkspace;
  readonly commands: CoreCommands;
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
  /** Shows a file selected in its folder, without opening it. */
  readonly showInFolder: (path: string) => Promise<void>;
  /** Where Zhiyin keeps its data: conversations, pictures, file copies. */
  readonly dataFolder: string;
  readonly version: string;
};

const notOpenable =
  "Zhiyin opens only PDFs, pictures, and Word, Excel or PowerPoint files in their own app.";

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
  /** Files Zhiyin wrote where the person chose in its save dialog, this session. */
  readonly #saved = new Set<string>();

  constructor(deps: CoreDependencies) {
    this.#deps = deps;
    const {
      workspace,
      viewChecks,
      chooseFolder,
      chooseSaveLocation,
      openExternal,
      openPath,
      commands,
    } = deps;
    commands.onCommandsChanged((taskId) =>
      workspace.emit({
        kind: "commandsChanged",
        data: { taskId, commands: commands.runningCommands(taskId) },
      }),
    );
    const { turns, settings } = workspace;
    this.#commands = {
      frontendReady: () => this.#attach(),
      openDataFolder: () => openPath(deps.dataFolder),
      showInFolder: (path) => {
        // The window names the file, so it is held to what Zhiyin keeps, or
        // wrote where the person chose.
        if (this.#saved.has(resolve(path))) return deps.showInFolder(path);
        // The platform's containment rule, restated: above the feature layer
        // a package imports types only (ADR 0002). A name that merely starts
        // with two dots is inside.
        const inside = relative(resolve(deps.dataFolder), resolve(path));
        if (
          !inside ||
          inside === ".." ||
          inside.startsWith(`..${sep}`) ||
          isAbsolute(inside)
        )
          throw new VisibleError("Zhiyin only shows files it keeps itself.");
        return deps.showInFolder(path);
      },
      configureProfile: (interests) => workspace.configureProfile(interests),
      recoverHistory: (choice) => workspace.recoverHistory(choice),
      settleSavedConversations: (choice) =>
        workspace.settleSavedConversations(choice),
      chooseWorkspace: () => this.chooseWorkspace(),
      useRecentWorkspace: (path) => this.#useRecentWorkspace(path),
      createTask: () => workspace.createTask(),
      selectTask: (taskId) => workspace.selectTask(taskId),
      selectNothing: () => workspace.selectNothing(),
      resendTask: (taskId) => workspace.resendTask(taskId),
      renameTask: (taskId, title) => workspace.renameTask(taskId, title),
      deleteTask: (taskId) => workspace.deleteTask(taskId),
      dismissIssue: (message) => workspace.dismissIssue(message),
      sendMessage: (taskId, message, reasoning, attachments, delivery) =>
        turns.start(taskId, message, reasoning, attachments, delivery),
      keepPaste: (text) => workspace.kept.keepPaste(text),
      keepPicture: (picture) => workspace.kept.keepPicture(picture),
      setContextBudget: (taskId, budget) =>
        workspace.setContextBudget(taskId, budget),
      setDefaultContextBudget: (budget) =>
        workspace.setDefaultContextBudget(budget),
      setPersonalInstructions: (text) =>
        workspace.choices.setPersonalInstructions(text),
      setNotifications: (enabled) =>
        workspace.choices.setNotifications(enabled),
      setAppearance: (appearance) => workspace.setAppearance(appearance),
      setSpelling: (choice) => workspace.setSpelling(choice),
      condenseNow: (taskId) => turns.condenseNow(taskId),
      openAttachment: async (taskId, id) =>
        openPath(await workspace.kept.attachmentPath(taskId, id)),
      previewRewind: (taskId, messageId) =>
        workspace.previewRewind(taskId, messageId),
      commitRewind: (taskId, rewindId, files) =>
        workspace.commitRewind(taskId, rewindId, files),
      previewUndo: (taskId, messageId) =>
        workspace.previewUndo(taskId, messageId),
      commitUndo: (taskId, undoId) => workspace.commitUndo(taskId, undoId),
      compareDocument: (taskId, messageId, path) =>
        workspace.compareDocument(taskId, messageId, path),
      interruptTask: (taskId) => turns.cancel(taskId),
      runningCommands: async (taskId) => commands.runningCommands(taskId),
      commandOutput: (taskId, jobId) => commands.commandOutput(taskId, jobId),
      stopCommand: (taskId, jobId) =>
        commands.stopCommandForPerson(taskId, jobId),
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
        workspace.connections.setToolEnabled(id, toolName, enabled),
      testMcpConnection: (server, token) =>
        workspace.connections.test(server, token),
      saveMcpServerToken: (id, token) =>
        workspace.connections.saveToken(id, token),
      clearMcpServerToken: (id) => workspace.connections.clearToken(id),
      signInToMcpServer: (id) => workspace.connections.signIn(id),
      cancelMcpSignIn: (id) => workspace.connections.cancelSignIn(id),
      refreshConnections: () => workspace.connections.refresh(),
      checkMcpConnection: (id) => workspace.connections.check(id),
      shellAvailability: () => workspace.shellAvailability(),
      recheckShell: () => workspace.recheckShell(),
      openExternalUrl: (url) => openExternal(url),
      driveBrowser: (intent) => workspace.driveBrowser(intent),
      chooseWorkspaceView: (taskId, view) =>
        workspace.chooseWorkspaceView(taskId, view),
      showDocument: (taskId, path, page) =>
        workspace.showDocument(taskId, path, page),
      closeDocument: (taskId) => workspace.closeDocument(taskId),
      drawDocumentPage: (taskId, revision, page, width) =>
        workspace.drawDocumentPage(taskId, revision, page, width),
      // Only a type on the allow-list goes to Windows, which would otherwise
      // run whatever program a file named.
      openDocument: async (taskId, path) => {
        const found = await workspace.locateDocument(taskId, path);
        if (!found.ok) throw new VisibleError(found.reason);
        if (!found.openable) throw new VisibleError(notOpenable);
        return openPath(found.path);
      },
      showDocumentInFolder: async (taskId, path) => {
        const found = await workspace.locateDocument(taskId, path);
        if (!found.ok) throw new VisibleError(found.reason);
        return deps.showInFolder(found.path);
      },
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
      exportConversation: (taskId, format) =>
        this.#remembered(
          workspace.exportConversation(taskId, format, (suggestedName) =>
            chooseSaveLocation("Export conversation", suggestedName),
          ),
        ),
      answerViewCheck: async (requestId, outcome) =>
        viewChecks.answer(requestId, outcome),
    };
  }

  async #remembered(saving: Promise<ArtifactExport>): Promise<ArtifactExport> {
    const outcome = await saving;
    if (outcome.status === "saved")
      this.#saved.add(resolve(outcome.destination));
    return outcome;
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
    workspace.attachWindow();
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
      .recentWorkspaces.some((folder) => folder.path === path);
    if (!known) throw new Error("That folder has not been opened before.");
    await workspace.selectWorkspace(path);
  }
}
