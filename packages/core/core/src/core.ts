import { resolve } from "node:path";
import { below, sameFolder } from "@zhiyin/path-comparison";
import {
  COMMAND_CHANNELS,
  type AppUpdateState,
  type ArtifactExport,
  VisibleError,
  type CommandName,
  type CommandOutput,
  type Commands,
  type RunningCommand,
  type ShellAvailability,
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
  | "openTask"
  | "renameTask"
  | "setContextBudget"
  | "setDefaultContextBudget"
  | "setAppearance"
  | "setLook"
  | "setSpelling"
  | "choices"
  | "memory"
  | "deleteTask"
  | "dismissIssue"
  | "kept"
  | "rewinds"
  | "commitRewind"
  | "commitUndo"
  | "plugins"
  | "connections"
  | "surfaces"
  | "previewArtifact"
  | "exportArtifact"
  | "exportView"
  | "exportConversation"
> & {
  readonly turns: Pick<
    WorkspaceTurns,
    | "send"
    | "cancel"
    | "answerNow"
    | "sendNow"
    | "takeBack"
    | "condenseNow"
    | "resolveApproval"
    | "revokeConversationPermission"
    | "resolveUserInput"
    | "anyRunning"
  >;
  readonly settings: Pick<
    ModelSettings,
    | "current"
    | "readIfUnknown"
    | "saveApiKey"
    | "clearApiKey"
    | "models"
    | "modelProviders"
    | "selectModel"
    | "providers"
    | "modelList"
    | "checkModelList"
    | "setModelListUpdates"
    | "reviewerSettings"
  >;
};

/**
 * Commands that carried on as jobs (ADR 0012), as the person sees and stops
 * them, and whether the shell they run in is there. Held by the
 * capabilities, not by the workspace: a job is a running process, not saved
 * state.
 */
export type CoreCommands = {
  shellAvailability(): ShellAvailability;
  /** Looks for the shell again, without a restart. */
  recheckShell(): ShellAvailability;
  runningCommands(taskId: string): readonly RunningCommand[];
  commandOutput(
    taskId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  stopCommandForPerson(taskId: string, jobId: string): Promise<void>;
  onCommandsChanged(watcher: (taskId: string) => void): void;
};

/**
 * Zhiyin updating itself (ADR 0027): the updates feature, as the core uses
 * it. Whether a restart may happen is the core's to say, since it knows the
 * turns.
 */
export type CoreUpdates = {
  state(): AppUpdateState;
  onChanged(listener: (state: AppUpdateState) => void): void;
  check(): Promise<AppUpdateState>;
  setChecks(enabled: boolean): Promise<AppUpdateState>;
  /** Measures the ready installer again; throws, saying why, if none can run. */
  prepareRestart(): Promise<void>;
  stop(): void;
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
  /** Puts text on the person's clipboard. Absent, as in tests, nothing is put there. */
  readonly copyText?: (text: string) => void;
  /** Opens a file the app kept in the program the person uses for it. */
  readonly openPath: (path: string) => Promise<void>;
  /** Shows a file selected in its folder, without opening it. */
  readonly showInFolder: (path: string) => Promise<void>;
  /** Windows' own window controls, which the page cannot draw over. */
  readonly windowControls?: { readonly dim: (dimmed: boolean) => void };
  /** Where Zhiyin keeps its data: conversations, pictures, file copies. */
  readonly dataFolder: string;
  readonly version: string;
  /** Absent, as in tests, Zhiyin does not update itself. */
  readonly updates?: CoreUpdates;
  /**
   * Quits so the update that is ready installs. The main process shuts the
   * core down first, as for any quit, then starts the installer.
   */
  readonly restartToUpdate?: () => void;
};

const noUpdates = "This copy of Zhiyin does not update itself.";

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
    const { updates } = deps;
    updates?.onChanged((state) =>
      workspace.emit({ kind: "appUpdateChanged", data: state }),
    );
    const updating = () => {
      if (!updates) throw new VisibleError(noUpdates);
      return updates;
    };
    this.#commands = {
      frontendReady: () => this.#attach(),
      dimWindowControls: async (dimmed) => deps.windowControls?.dim(dimmed),
      openDataFolder: () => openPath(deps.dataFolder),
      openMemoryFolder: async () => {
        const folder = await workspace.memory.folder();
        if (!folder) throw new VisibleError("Memory is not kept here.");
        await openPath(folder);
      },
      showInFolder: (path) => {
        // The window names the file, so it is held to what Zhiyin keeps, or
        // wrote where the person chose.
        if (this.#saved.has(resolve(path))) return deps.showInFolder(path);
        if (!below(resolve(deps.dataFolder), resolve(path)))
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
      openTask: (taskId) => workspace.openTask(taskId),
      selectNothing: () => workspace.selectNothing(),
      resendTask: (taskId) => workspace.resendTask(taskId),
      renameTask: (taskId, title) => workspace.renameTask(taskId, title),
      deleteTask: (taskId) => workspace.deleteTask(taskId),
      dismissIssue: (message, conversationId) =>
        workspace.dismissIssue(message, conversationId),
      // A turn is planned from what the model accepts: looked up again first
      // when the last look could not reach the model's details.
      sendMessage: async (
        taskId,
        message,
        reasoning,
        attachments,
        delivery,
      ) => {
        await workspace.settings.readIfUnknown();
        return turns.send(taskId, message, reasoning, attachments, delivery);
      },
      keepPaste: (text) => workspace.kept.keepPaste(text),
      keepPicture: (picture) => workspace.kept.keepPicture(picture),
      setContextBudget: (taskId, budget) =>
        workspace.setContextBudget(taskId, budget),
      setDefaultContextBudget: (budget) =>
        workspace.setDefaultContextBudget(budget),
      memory: () => workspace.memory.state(),
      // A folder to link is chosen by the person, in Windows' own dialog.
      changeMemory: (request) => workspace.memory.change(request, chooseFolder),
      setConversationMemory: (taskId, choice) =>
        workspace.memory.setConversation(taskId, choice),
      setNotifications: (enabled) =>
        workspace.choices.setNotifications(enabled),
      setStudioReviews: (enabled) =>
        workspace.choices.setStudioReviews(enabled),
      setReviewerModel: (choice) =>
        workspace.choices.setReviewerModel(choice ?? undefined),
      reviewerModelSettings: async () => {
        const choice = workspace.choices.reviewerModel();
        return choice ? workspace.settings.reviewerSettings(choice) : null;
      },
      setWorkPauses: (pauses) => workspace.choices.setWorkPauses(pauses),
      setAppearance: (appearance) => workspace.setAppearance(appearance),
      setLook: (choice) => workspace.setLook(choice),
      setSpelling: (choice) => workspace.setSpelling(choice),
      // A summary is written from what the model is shown, which follows
      // whether it sees pictures: looked up again first, as for a message.
      condenseNow: async (taskId) => {
        await workspace.settings.readIfUnknown();
        return turns.condenseNow(taskId);
      },
      openAttachment: async (taskId, id) =>
        openPath(await workspace.kept.attachmentPath(taskId, id)),
      previewRewind: (taskId, messageId) =>
        workspace.rewinds.preview(taskId, messageId),
      commitRewind: (taskId, rewindId, files) =>
        workspace.commitRewind(taskId, rewindId, files),
      previewUndo: (taskId, messageId) =>
        workspace.rewinds.previewUndo(taskId, messageId),
      commitUndo: (taskId, undoId) => workspace.commitUndo(taskId, undoId),
      compareDocument: (taskId, messageId, path) =>
        workspace.rewinds.compareDocument(taskId, messageId, path),
      interruptTask: (taskId) => turns.cancel(taskId),
      answerNow: (taskId) => turns.answerNow(taskId),
      sendNow: (taskId) => turns.sendNow(taskId),
      takeBackMessage: (taskId, messageId) => turns.takeBack(taskId, messageId),
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
        workspace.plugins.setEnabled(id, enabled),
      setComponentEnabled: (id, enabled) =>
        workspace.plugins.setComponentEnabled(id, enabled),
      componentContent: (id) => workspace.plugins.componentContent(id),
      overrideComponent: (id, content) =>
        workspace.plugins.overrideComponent(id, content),
      resetComponent: (id) => workspace.plugins.resetComponent(id),
      installToolchain: (id) => workspace.plugins.installToolchain(id),
      cancelToolchainInstall: (id) =>
        workspace.plugins.cancelToolchainInstall(id),
      installPlugin: () => workspace.plugins.install(chooseFolder),
      updatePlugin: (id) => workspace.plugins.update(id, chooseFolder),
      rollbackPlugin: (id) => workspace.plugins.rollback(id),
      removePlugin: (id) => workspace.plugins.remove(id),
      createPlugin: (displayName, description) =>
        workspace.plugins.create(displayName, description),
      savePluginContents: (id, contents) =>
        workspace.plugins.saveContents(id, contents),
      editablePluginContents: (id) => workspace.plugins.editableContents(id),
      setMcpServerToolEnabled: (id, toolName, enabled) =>
        workspace.connections.setToolEnabled(id, toolName, enabled),
      setMcpServerToolTreatment: (id, toolName, treatment, shown) =>
        workspace.connections.setToolTreatment(id, toolName, treatment, shown),
      testMcpConnection: (server, token) =>
        workspace.connections.test(server, token),
      saveMcpServerToken: (id, token) =>
        workspace.connections.saveToken(id, token),
      clearMcpServerToken: (id) => workspace.connections.clearToken(id),
      signInToMcpServer: (id) => workspace.connections.signIn(id),
      cancelMcpSignIn: (id) => workspace.connections.cancelSignIn(id),
      refreshConnections: () => workspace.connections.refresh(),
      checkMcpConnection: (id) => workspace.connections.check(id),
      shellAvailability: async () => commands.shellAvailability(),
      recheckShell: async () => commands.recheckShell(),
      openExternalUrl: (url) => openExternal(url),
      // Validated already: an http or https page, written as a URL reads it.
      openAnswerLink: (url) => openExternal(new URL(url).toString()),
      // What a copy or a cut took from the page goes to the clipboard here,
      // on the person's own key press; the page never reaches the clipboard.
      driveBrowser: async (intent) => {
        const copied = await workspace.surfaces.driveBrowser(intent);
        if (copied) deps.copyText?.(copied);
      },
      watchBrowser: (taskId, view) =>
        workspace.surfaces.watchBrowser(taskId, view),
      lookAtScene: (intent) => workspace.surfaces.lookAtScene(intent),
      partModel: (taskId, sequence) =>
        workspace.surfaces.partModel(taskId, sequence),
      chooseWorkspaceView: (taskId, view, threeD) =>
        workspace.surfaces.chooseWorkspaceView(taskId, view, threeD),
      showDocument: (taskId, path, page) =>
        workspace.surfaces.showDocument(taskId, path, page),
      closeDocument: (taskId) => workspace.surfaces.closeDocument(taskId),
      drawDocumentPage: (taskId, revision, page, width) =>
        workspace.surfaces.drawDocumentPage(taskId, revision, page, width),
      // Only a type on the allow-list goes to Windows, which would otherwise
      // run whatever program a file named.
      openDocument: async (taskId, path) => {
        const found = await workspace.surfaces.locateDocument(taskId, path);
        if (!found.ok) throw new VisibleError(found.reason);
        if (!found.openable) throw new VisibleError(notOpenable);
        return openPath(found.path);
      },
      showDocumentInFolder: async (taskId, path) => {
        const found = await workspace.surfaces.locateDocument(taskId, path);
        if (!found.ok) throw new VisibleError(found.reason);
        return deps.showInFolder(found.path);
      },
      listProviders: () => settings.providers(),
      saveProviderApiKey: (apiKey, target) =>
        settings.saveApiKey(apiKey, target),
      clearProviderApiKey: (target) => settings.clearApiKey(target),
      listModels: (target) => settings.models(target),
      listModelProviders: (model, target) =>
        settings.modelProviders(model, target),
      selectModel: (model, providers, target) =>
        settings.selectModel(model, providers, target),
      modelList: () => settings.modelList(),
      checkModelList: () => settings.checkModelList(),
      setModelListUpdates: (enabled) => settings.setModelListUpdates(enabled),
      appUpdate: async () => updating().state(),
      checkForAppUpdate: () => updating().check(),
      setAppUpdateChecks: (enabled) => updating().setChecks(enabled),
      restartToUpdate: async () => {
        const ready = updating();
        const restart = deps.restartToUpdate;
        if (!restart) throw new VisibleError(noUpdates);
        // Restarting ends whatever runs; a turn is the person's to end.
        if (turns.anyRunning())
          throw new VisibleError(
            "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
          );
        try {
          await ready.prepareRestart();
        } catch (error) {
          throw new VisibleError(
            error instanceof Error
              ? error.message
              : "No update can be installed.",
          );
        }
        restart();
      },
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
    const { workspace, ownership, updates } = this.#deps;
    updates?.stop();
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
   * has already chosen in one: a folder worked in, or one linked to a
   * project. Without that, the window could name any folder on the machine.
   */
  async #useRecentWorkspace(path: string): Promise<void> {
    const { workspace } = this.#deps;
    const linked = await workspace.memory.state().then(
      (memory) => memory?.projects.flatMap((project) => project.folders) ?? [],
      () => [],
    );
    const known = [
      ...workspace.snapshot().recentWorkspaces.map((folder) => folder.path),
      ...linked,
    ].some((folder) => sameFolder(folder, path));
    if (!known) throw new Error("That folder has not been opened before.");
    await workspace.selectWorkspace(path);
  }
}
