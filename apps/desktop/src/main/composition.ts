/**
 * Where the real implementations are chosen and handed to the agent loop.
 *
 * The model client talks to the provider the person chose, OpenRouter or a
 * lab's own API; each key comes from the environment or from the operating
 * system's credential store.
 */

import { join } from "node:path";
import { AgentLoop } from "@zhiyin/agent-loop";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  unreadablePackagesOf,
  documentsConnection,
  sceneConnection,
  gitConnection,
  pythonConnection,
} from "@zhiyin/capabilities";
import { gitAutomation } from "@zhiyin/git-connector";
import { documentCompilers } from "@zhiyin/document-compiler";
import { pythonSandboxes } from "@zhiyin/python-sandbox";
import {
  ConversationScenes,
  compiledBlenderPython,
  containedSessionLaunch,
  describeSceneTools,
  sceneAutomation,
} from "@zhiyin/blender-studio";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { conversationExport } from "@zhiyin/conversation-export";
import { FileAuditLog } from "@zhiyin/audit";
import { replaceFile } from "@zhiyin/file-replacement";
import { CHANNEL, type AppEvent, type Appearance } from "@zhiyin/contract";
import {
  Core,
  DiagnosticLog,
  Workspace,
  debuggingRefusal,
  recordCrashes,
  reloadAfterCrash,
  testSwitches,
  type CoreDependencies,
  type LogEntry,
  type Notifier,
} from "@zhiyin/core";
import {
  FileModelChoice,
  ModelListUpdates,
  modelListKeys,
  ModelProviders,
  type CredentialEntry,
} from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import {
  DictionaryShelf,
  Spelling,
  textMenu,
  type SpellcheckEngine,
} from "@zhiyin/spelling";
import {
  ComposedPlugins,
  FilePluginSettings,
  FilePluginStore,
  loadBuiltInPlugins,
} from "@zhiyin/plugins";
import { DownloadedToolchains, pinnedToolchains } from "@zhiyin/toolchains";
import { FileUsageTelemetry } from "@zhiyin/usage";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { ConversationRewind } from "@zhiyin/conversation-rewind";
import { FileRecovery } from "@zhiyin/recovery";
import { ComposedRewind, FileRewindJournal } from "@zhiyin/rewind";
import {
  CanvasPictureFitting,
  WorkspaceTools,
  checkRecyclable,
} from "@zhiyin/tools";
import {
  containmentAvailability,
  openProcessContainer,
} from "@zhiyin/process-ownership";
import {
  BrowserSessions,
  BrowserSession,
  browserAutomation,
  describeBrowserAutomation,
  playwrightBrowserLauncher,
} from "@zhiyin/interactive-browser";
import {
  KeyringMcpCredentials,
  ManagedMcpServers,
  connectHttpMcpServer,
} from "@zhiyin/mcp";
import {
  ContainedPdfPages,
  ContainedPictures,
  DocumentViewer,
  type StartDrawingProcess,
} from "@zhiyin/document-viewer";
import { randomUUID } from "node:crypto";
import { PendingViewChecks } from "@zhiyin/views";

/** What the composition needs from the Electron side. */
export type Surroundings = {
  readonly dataDirectory: string;
  /** Where the plugins shipped with the application are. */
  readonly builtInPluginsDirectory: string;
  /** The script Blender runs for the 3D studio; without it there is no studio. */
  readonly blenderSessionScript?: string;
  readonly workspaceDirectory: string | undefined;
  readonly version: string;
  /** An installed app, which takes no model address from the environment. */
  readonly packaged?: boolean;
  /** Sends to the app's window while it is open. */
  readonly send: (channel: string, payload: unknown) => void;
  readonly chooseFolder: CoreDependencies["chooseFolder"];
  readonly chooseSaveLocation: CoreDependencies["chooseSaveLocation"];
  readonly openExternal: CoreDependencies["openExternal"];
  readonly openPath: CoreDependencies["openPath"];
  readonly showInFolder: CoreDependencies["showInFolder"];
  /** Moves one item to the Recycle Bin; rejects, deleting nothing, when it cannot. */
  readonly recycle?: (path: string) => Promise<void>;
  /** The operating system's notifications. */
  readonly notifier?: Notifier;
  /** Paints the window light, dark, or as Windows is set. */
  readonly appearance?: { readonly apply: (appearance: Appearance) => void };
  /** Windows' own window controls, dimmed under a dialog. */
  readonly windowControls?: CoreDependencies["windowControls"];
  /** The spellchecker, where its dictionaries come from and are read. */
  readonly spelling?: {
    readonly engine: SpellcheckEngine;
    /** The dictionaries as shipped. */
    readonly bundled: string;
    /** Where the spellchecker reads them. */
    readonly installed: string;
    /** Windows' languages, most preferred first. */
    readonly systemLanguages: readonly string[];
  };
  /**
   * How Zhiyin's own requests go online: Chromium's network, which reads
   * Windows' certificates and proxy settings (ADR 0004). Node's own `fetch`
   * when absent, as in tests.
   */
  readonly network?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * Zhiyin's model list and where newer ones come from (ADR 0031). Absent, as
   * in tests, the list in force is kept in the data folder and read from
   * GitHub only when the Model page asks.
   */
  readonly modelList?: ModelListUpdates;
  /** The credential store's entry for one provider account. Tests only. */
  readonly credentialEntry?: (account: string) => CredentialEntry;
  /** Tests only: closing browsers and connections never finishes. */
  readonly connectionsNeverClose?: boolean;
  /** Starts a process that draws document pages, before it is contained. */
  readonly startDrawing: StartDrawingProcess;
  /** Device pixels per CSS pixel where the window is now. */
  readonly pixelDensity?: () => number;
  /** Where what went wrong is kept, on this computer. */
  readonly log?: { record(entry: LogEntry): void };
};

/**
 * Zhiyin's model list (ADR 0031), kept in the data folder, with newer ones
 * read from GitHub over `network`, or from `server` where a test names one.
 */
export function modelListOf({
  dataDirectory,
  network,
  server,
}: {
  readonly dataDirectory: string;
  readonly network?: Surroundings["network"];
  readonly server?: string;
}): ModelListUpdates {
  return new ModelListUpdates({
    directory: join(dataDirectory, "model-list"),
    keys: modelListKeys,
    ...(network ? { network } : {}),
    ...(server
      ? {
          addresses: {
            list: new URL("models.json", server).href,
            signature: new URL("models.json.sig", server).href,
          },
        }
      : {}),
  });
}

/** Looks once for a newer model list and keeps what came of it in the log. */
export function lookForNewerModelList(
  modelList: ModelListUpdates,
  log: { record(entry: LogEntry): void },
): void {
  void modelList.refresh().then((look) => {
    if (look.outcome === "updated")
      log.record({
        level: "info",
        source: "model-list",
        message: `Model list ${modelList.state().version} was taken from GitHub.`,
      });
    else if (look.outcome === "failed")
      log.record({
        level: "warn",
        source: "model-list",
        message: `No newer model list was taken: ${look.reason}`,
      });
  });
}

/** The person's light or dark choice, read before the window is made. */
export function savedAppearance(
  dataDirectory: string,
): Promise<Appearance | undefined> {
  return new FileSessions(dataDirectory).savedAppearance();
}

/** What the right-click menu offers at a point: the spelling feature decides. */
export const textMenuAt = textMenu;

/**
 * The diagnostic log, started before anything else so that whatever fails from
 * then on leaves a line behind, with what the main process throws and nobody
 * catches recorded rather than fatal. What it keeps is the core's.
 */
export function startDiagnosticLog(folder: string): DiagnosticLog {
  const log = new DiagnosticLog(folder);
  log.prune();
  recordCrashes(process, log);
  return log;
}

/** What happens when the window's page crashes: the core decides. */
export const watchForCrashes = reloadAfterCrash;

/** The switches only an uninstalled build reads, for testing it: the core decides. */
export const testSwitchesOf = testSwitches;

/** Whether the switches the app was started with let it start: the core decides. */
export const debuggingRefusalOf = debuggingRefusal;

export type { SpellcheckEngine, TextMenuItem } from "@zhiyin/spelling";

export function buildCore({
  dataDirectory,
  builtInPluginsDirectory,
  blenderSessionScript,
  workspaceDirectory,
  version,
  packaged = false,
  send,
  chooseFolder,
  chooseSaveLocation,
  openExternal,
  openPath,
  showInFolder,
  recycle,
  notifier,
  appearance,
  windowControls,
  spelling,
  network,
  modelList = modelListOf({ dataDirectory, ...(network ? { network } : {}) }),
  credentialEntry,
  connectionsNeverClose,
  startDrawing,
  pixelDensity,
  log,
}: Surroundings): Core {
  const emit = (event: AppEvent): void => send(CHANNEL.appEvent, event);
  const views = new PendingViewChecks({
    ask: (request) => send(CHANNEL.viewCheck, request),
  });
  const sessions = new FileSessions(dataDirectory, {
    version,
    ...(recycle
      ? { recycleBin: { recyclable: checkRecyclable, recycle } }
      : {}),
  });
  const audit = new FileAuditLog(dataDirectory);
  /*
   * Which provider and model answer is the person's choice, kept on disk;
   * until they make it, nothing is sent. Routing starts unrestricted: a single
   * upstream has no recovery when it is busy. ADR 0015.
   *
   * Outside an installed app, for a test run or the benchmark, ZHIYIN_MODEL
   * fixes the model, on the provider and region ZHIYIN_PROVIDER and
   * ZHIYIN_REGION name (OpenRouter when unnamed), and ZHIYIN_MODEL_ENDPOINT
   * sends every request elsewhere. An installed app answers with the
   * person's choice, and would send its keys to another endpoint.
   */
  const fixedModel = packaged ? undefined : process.env["ZHIYIN_MODEL"];
  const endpoint = packaged ? undefined : process.env["ZHIYIN_MODEL_ENDPOINT"];
  const model = new ModelProviders({
    environment: (variable) => process.env[variable],
    ...(fixedModel
      ? {
          fixed: {
            model: fixedModel,
            ...(process.env["ZHIYIN_PROVIDER"]
              ? { provider: process.env["ZHIYIN_PROVIDER"] }
              : {}),
            ...(process.env["ZHIYIN_REGION"]
              ? { region: process.env["ZHIYIN_REGION"] }
              : {}),
          },
        }
      : { choice: new FileModelChoice(dataDirectory) }),
    ...(endpoint ? { endpoint } : {}),
    ...(network ? { network } : {}),
    ...(credentialEntry ? { credentialEntry } : {}),
    modelLists: modelList,
  });
  const containment = { open: openProcessContainer };
  const containmentState = containmentAvailability();
  const browserLauncher = playwrightBrowserLauncher(
    containment,
    pixelDensity ? { pixelDensity } : {},
  );
  const browsers = new BrowserSessions(
    (conversationId) =>
      new BrowserSession({
        launcher: browserLauncher,
        workspaceRoot: () => workspace.workspaceRoot(conversationId),
      }),
    { directory: join(dataDirectory, "browser-output") },
  );
  // One reading process for every PDF read in the core: the model's, and the
  // words compared when a person reviews a changed PDF.
  const pdfPages = new ContainedPdfPages({ start: startDrawing, containment });
  // A picture made smaller for the model is decoded in one too (ADR 0023).
  const containedPictures = new ContainedPictures({
    start: startDrawing,
    containment,
  });
  // No folder of its own: each conversation enters its own (ADR 0008).
  const workspace = new WorkspaceTools(undefined, {
    containment,
    // A PDF the model reads is read in a contained process, as one the person
    // sees is drawn in one (ADR 0023).
    pdfPages,
    ...(containmentState.available
      ? {}
      : { uncontained: containmentState.reason }),
    ...(recycle
      ? { recycleBin: { recyclable: checkRecyclable, recycle } }
      : {}),
    // Answered from the core's provider settings, which the core reads again
    // whenever the model or the key changes.
    acceptsImages: (): boolean =>
      state.settings.current()?.acceptsImages === true,
    // A command's whole output, a pasted text and an attached picture, kept
    // with the conversation and read again by address.
    items: {
      locate: (conversationId, kind, id) =>
        sessions.locate(
          kind === "attachment" ? "pastedText" : "output",
          conversationId,
          id,
        ),
      keepOutput: async (conversationId, file) => {
        const kept = await sessions.keep("output", conversationId, { file });
        return kept.status === "kept"
          ? { status: "kept", id: kept.id }
          : { status: "refused", reason: kept.reason };
      },
      lastRead: (conversationId, path) =>
        sessions.lastRead(conversationId, path),
      noteRead: (conversationId, path, read) =>
        sessions.noteRead(conversationId, path, read),
      readPicture: (conversationId, id) =>
        sessions.readAttachedPicture(conversationId, id),
    },
  });
  const plugins = new ComposedPlugins({
    builtIns: () => loadBuiltInPlugins(builtInPluginsDirectory),
    store: new FilePluginStore(join(dataDirectory, "plugins")),
    settings: new FilePluginSettings(dataDirectory),
  });
  const toolchains = new DownloadedToolchains({
    directory: dataDirectory,
    specs: pinnedToolchains,
    ...(network ? { network } : {}),
    // Blender arrives with its Python as source and, contained, can keep no
    // compiled copy of it: it is compiled once, as it is installed.
    ready: { blender: compiledBlenderPython({ containment }) },
  });
  // Each conversation's own Blender, installed as a toolchain (ADR 0025).
  const blender = () => toolchains.executable("blender");
  const scenes = blenderSessionScript
    ? new ConversationScenes({
        blender,
        directory: join(dataDirectory, "blender-studio"),
        launch: containedSessionLaunch(containment, {
          scripts: join(dataDirectory, "blender-studio", "session-scripts"),
        }),
        script: blenderSessionScript,
      })
    : undefined;
  /** One Python for the app, its environments shared by every conversation. */
  const python = pythonSandboxes({
    directory: join(dataDirectory, "python-sandbox"),
    uv: async () => toolchains.executable("uv"),
    containment,
  });
  /** One installed program, named the way the compiler asks for it. */
  const executable = async (id: "typst" | "tectonic") => {
    const path = await toolchains.executable(id);
    return path ? { [id]: path } : {};
  };
  /** One compiler, and its one package cache, for every folder. */
  const compiler = documentCompilers({
    programs: async () => ({
      ...(await executable("typst")),
      ...(await executable("tectonic")),
    }),
    tectonicCache: join(dataDirectory, "tectonic"),
    containment,
  });
  const capabilities = new ComposedCapabilities({
    tools: workspace,
    mcp: new ManagedMcpServers(
      dataDirectory,
      connectHttpMcpServer,
      new KeyringMcpCredentials(),
      {
        builtIns: [
          browserConnection(
            (conversationId) =>
              browserAutomation(browsers.browser(conversationId), {
                // The core's one answer, which turns follow too; the
                // browser's tools are listed again when it changes.
                acceptsImages: async (): Promise<boolean> =>
                  state.settings.current()?.acceptsImages === true,
                outputDirectory: browsers.directory(conversationId),
              }),
            () =>
              describeBrowserAutomation(browserLauncher, {
                acceptsImages: async (): Promise<boolean> =>
                  state.settings.current()?.acceptsImages === true,
                // Every conversation's browser is given its folder to preview.
                workspacePreview: true,
              }),
          ),
          gitConnection(
            (conversationId) =>
              gitAutomation({
                workspaceRoot: () => workspace.workspaceRoot(conversationId),
                containment,
              }),
            () =>
              gitAutomation({
                workspaceRoot: () => undefined,
                containment,
              }).listTools(),
          ),
          documentsConnection(
            (conversationId) =>
              compiler(() => workspace.workspaceRoot(conversationId)),
            () => compiler(() => undefined).listTools(),
          ),
          pythonConnection(
            (conversationId) =>
              python(() => workspace.workspaceRoot(conversationId)),
            () => python(() => undefined).listTools(),
          ),
          ...(scenes
            ? [
                sceneConnection(
                  (conversationId) =>
                    sceneAutomation(scenes.scene(conversationId), {
                      workspaceRoot: () =>
                        workspace.workspaceRoot(conversationId),
                      blender,
                      directory: scenes.directory(conversationId),
                    }),
                  () => describeSceneTools(blender),
                ),
              ]
            : []),
        ],
        declared: () => declaredConnectionsOf(plugins),
        unreadable: () => unreadablePackagesOf(plugins),
        now: Date.now,
        signInOptions: { openBrowser: openExternal },
        network,
      },
    ),
    plugins,
    toolchains,
    // Which programs each application connection needs before it can run.
    connectionToolchains: {
      documents: ["typst", "tectonic"],
      python: ["uv"],
      blender: ["blender"],
    },
    // Stopping a turn, deleting a conversation and shutting down all let go of
    // what a conversation holds through this one group.
    browsers,
    ...(scenes ? { scenes } : {}),
  });
  // A test's stand-in for a browser or connection that never finishes closing.
  if (connectionsNeverClose)
    capabilities.shutdown = () => new Promise<void>(() => {});
  // Each preview and export is given its conversation's folder by the core.
  const artifacts = new WorkspaceArtifacts();
  const rewind = new ComposedRewind({
    conversation: new ConversationRewind(randomUUID),
    recovery: new FileRecovery(dataDirectory),
    journal: new FileRewindJournal(dataDirectory, replaceFile),
  });
  const now = () => new Date();

  const state = new Workspace(
    {
      startingFolder: workspaceDirectory,
      sessions,
      capabilities,
      workspace,
      artifacts,
      conversationExport: conversationExport(() => ({
        appVersion: version,
        exportedAt: now(),
      })),
      rewind,
      usage: new FileUsageTelemetry(dataDirectory),
      model,
      modelProviders: model,
      modelList,
      // Each conversation gets an app-owned browser rather than access to the
      // person's browser or another conversation's page.
      browsers,
      // Each conversation's 3D scene, which the person watches (ADR 0025).
      ...(scenes ? { scenes } : {}),
      // Pages are drawn in a contained process of their own (ADR 0023).
      documents: new DocumentViewer({ start: startDrawing, containment }),
      pdfWords: (bytes) => pdfPages.words(bytes),
      newTaskId: randomUUID,
      now,
      emit,
      // The person is told only that a conversation is damaged; what did not
      // read in it is kept here.
      recordDamage: ({ conversationId, error }) =>
        log?.record({
          level: "error",
          source: "history",
          message: `Conversation ${conversationId} is damaged and was not opened.`,
          error,
        }),
      ...(notifier ? { notifier } : {}),
      ...(appearance ? { appearance } : {}),
      ...(spelling
        ? {
            spelling: new Spelling({
              engine: spelling.engine,
              shelf: new DictionaryShelf(spelling),
              systemLanguages: spelling.systemLanguages,
            }),
          }
        : {}),
      onboarding: true,
    },
    (host) => {
      const loop = new AgentLoop({
        permissions: new GuardedPermissionEngine(),
        capabilities,
        workspace,
        artifacts,
        views,
        rewind,
        audit,
        sessions,
        // A picture past what the configured model accepts is scaled rather
        // than refused, and the model is told what it is looking at.
        pictures: new CanvasPictureFitting({
          shrink: (bytes, width) => containedPictures.smaller(bytes, width),
        }),
        model,
        // The selected model, passed separately so the naming and labelling
        // work can go to a different one, such as a local model.
        guidanceModel: model,
        // The conversation says only that Zhiyin stopped on an error of its
        // own; the error itself is kept here.
        recordDefect: ({ taskId, error }) =>
          log?.record({
            level: "error",
            source: "turn",
            message: `A turn stopped on an error of Zhiyin's own, in conversation ${taskId}.`,
            error,
          }),
        newMessageId: randomUUID,
        newActionId: randomUUID,
        newSpecialistRunId: randomUUID,
        newApprovalId: randomUUID,
        newUserInputId: randomUUID,
        now,
        host,
      });
      // A command carried on as a job reports its end to its conversation.
      capabilities.onCommandEnded((taskId, notice, wakes) =>
        loop.commandEnded(taskId, notice, wakes),
      );
      // Kept with the conversation, so a restart can tell of the ones it ends.
      capabilities.onCommandsChanged(
        (taskId) => void loop.commandsChanged(taskId),
      );
      // What a job changed reaches the action that started it.
      capabilities.onJobChanges(
        (taskId, job, changes) => void loop.jobChanged(taskId, job, changes),
      );
      return loop;
    },
  );

  return new Core({
    dataFolder: dataDirectory,
    workspace: state,
    // One instance owns the data directory at a time, and taking and giving up
    // that ownership belongs to the app's lifetime rather than to a turn.
    ownership: sessions,
    viewChecks: views,
    commands: capabilities,
    chooseFolder,
    chooseSaveLocation,
    openExternal,
    openPath,
    showInFolder,
    ...(windowControls ? { windowControls } : {}),
    version,
  });
}
