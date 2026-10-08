/**
 * Where the real implementations are chosen and handed to the agent loop.
 *
 * The model client talks to OpenRouter; its key comes from the environment or
 * from the operating system's credential store.
 */

import { join } from "node:path";
import { AgentLoop } from "@zhiyin/agent-loop";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  documentsConnection,
  gitConnection,
  pythonConnection,
} from "@zhiyin/capabilities";
import { gitAutomation } from "@zhiyin/git-connector";
import { documentCompiler } from "@zhiyin/document-compiler";
import { pythonSandbox } from "@zhiyin/python-sandbox";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { conversationExport } from "@zhiyin/conversation-export";
import { FileAuditLog } from "@zhiyin/audit";
import { CHANNEL, type AppEvent, type Appearance } from "@zhiyin/contract";
import {
  Core,
  Workspace,
  type CoreDependencies,
  type Notifier,
} from "@zhiyin/core";
import {
  FileModelChoice,
  OpenRouterModelClient,
  ProviderCredentials,
  type CredentialEntry,
  fetchOpenRouterModelInfo,
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
  resolveShell,
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
  DocumentViewer,
  type StartDrawingProcess,
} from "@zhiyin/document-viewer";
import { createHash, randomUUID } from "node:crypto";
import { PendingViewChecks } from "@zhiyin/views";

/** What the composition needs from the Electron side. */
export type Surroundings = {
  readonly dataDirectory: string;
  /** Where the plugins shipped with the application are. */
  readonly builtInPluginsDirectory: string;
  readonly workspaceDirectory: string | undefined;
  readonly version: string;
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
  readonly credentialEntry?: CredentialEntry;
  /** Tests only: closing browsers and connections never finishes. */
  readonly connectionsNeverClose?: boolean;
  /** Starts a process that draws document pages, before it is contained. */
  readonly startDrawing: StartDrawingProcess;
  /** Device pixels per CSS pixel where the window is now. */
  readonly pixelDensity?: () => number;
};

/** The person's light or dark choice, read before the window is made. */
export function savedAppearance(
  dataDirectory: string,
): Promise<Appearance | undefined> {
  return new FileSessions(dataDirectory).savedAppearance();
}

/** What the right-click menu offers at a point: the spelling feature decides. */
export const textMenuAt = textMenu;

export type { SpellcheckEngine, TextMenuItem } from "@zhiyin/spelling";

export function buildCore({
  dataDirectory,
  builtInPluginsDirectory,
  workspaceDirectory,
  version,
  send,
  chooseFolder,
  chooseSaveLocation,
  openExternal,
  openPath,
  showInFolder,
  recycle,
  notifier,
  appearance,
  spelling,
  credentialEntry,
  connectionsNeverClose,
  startDrawing,
  pixelDensity,
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
  const credentials = new ProviderCredentials({
    environment: () => process.env["OPENROUTER_API_KEY"],
    ...(credentialEntry ? { entry: credentialEntry } : {}),
  });
  /*
   * Which model answers is the person's choice, kept on disk; until they make
   * it, nothing is sent. Routing starts unrestricted: a single upstream has no
   * recovery when it is busy. ADR 0010.
   */
  const choice = new FileModelChoice(dataDirectory);
  const model = new OpenRouterModelClient({
    credentials,
    ...(process.env["ZHIYIN_MODEL"] ? {} : { choice }),
    ...(!process.env["ZHIYIN_MODEL_ENDPOINT"]
      ? { modelInfo: fetchOpenRouterModelInfo }
      : {}),
    ...(process.env["ZHIYIN_MODEL"]
      ? { model: process.env["ZHIYIN_MODEL"] }
      : {}),
    ...(process.env["ZHIYIN_MODEL_ENDPOINT"]
      ? { endpoint: process.env["ZHIYIN_MODEL_ENDPOINT"] }
      : {}),
  });
  const containment = { open: openProcessContainer };
  const containmentState = containmentAvailability();
  const browserLauncher = playwrightBrowserLauncher(
    containment,
    pixelDensity ? { pixelDensity } : {},
  );
  const browsers = new BrowserSessions(
    () =>
      new BrowserSession({
        launcher: browserLauncher,
        workspaceRoot: () => workspace.workspaceRoot(),
      }),
  );
  // One reading process for every PDF read in the core: the model's, and the
  // words compared when a person reviews a changed PDF.
  const pdfPages = new ContainedPdfPages({ start: startDrawing, containment });
  const workspace = new WorkspaceTools(workspaceDirectory, {
    containment,
    // A PDF the model reads is read in a contained process, as one the person
    // sees is drawn in one (ADR 0018).
    pdfPages,
    shell: containmentState.available ? resolveShell() : undefined,
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
  });
  /** One installed program, named the way the compiler asks for it. */
  const executable = async (id: "typst" | "tectonic") => {
    const path = await toolchains.executable(id);
    return path ? { [id]: path } : {};
  };
  const capabilities = new ComposedCapabilities({
    tools: workspace,
    mcp: new ManagedMcpServers(
      dataDirectory,
      connectHttpMcpServer,
      new KeyringMcpCredentials(),
      [
        browserConnection(
          (conversationId) =>
            browserAutomation(browsers.browser(conversationId), {
              acceptsImages: async () =>
                (await model.settings()).acceptsImages === true,
              outputDirectory: join(
                dataDirectory,
                "browser-output",
                createHash("sha256").update(conversationId).digest("hex"),
              ),
            }),
          () =>
            describeBrowserAutomation(browserLauncher, {
              acceptsImages: async () =>
                (await model.settings()).acceptsImages === true,
              // Every conversation's browser is given the workspace to preview.
              workspacePreview: true,
            }),
        ),
        gitConnection(
          gitAutomation({
            workspaceRoot: () => workspace.workspaceRoot(),
            containment,
          }),
        ),
        documentsConnection(
          documentCompiler({
            workspaceRoot: () => workspace.workspaceRoot(),
            programs: async () => ({
              ...(await executable("typst")),
              ...(await executable("tectonic")),
            }),
            containment,
          }),
        ),
        pythonConnection(
          pythonSandbox({
            workspaceRoot: () => workspace.workspaceRoot(),
            directory: join(dataDirectory, "python-sandbox"),
            uv: async () => toolchains.executable("uv"),
            containment,
          }),
        ),
      ],
      () => declaredConnectionsOf(plugins),
      Date.now,
      // A connector's sign-in opens in the person's own browser.
      { openBrowser: openExternal },
    ),
    plugins,
    toolchains,
    // Which programs each application connection needs before it can run.
    connectionToolchains: {
      documents: ["typst", "tectonic"],
      python: ["uv"],
    },
    // Stopping a turn, deleting a conversation and shutting down all let go of
    // what a conversation holds through this one group.
    browsers,
  });
  // A test's stand-in for a browser or connection that never finishes closing.
  if (connectionsNeverClose)
    capabilities.shutdown = () => new Promise<void>(() => {});
  // Both are pointed at the same folder here rather than at each other.
  const artifacts = new WorkspaceArtifacts(() => workspace.workspaceRoot());
  const rewind = new ComposedRewind({
    conversation: new ConversationRewind(randomUUID),
    recovery: new FileRecovery(dataDirectory),
    journal: new FileRewindJournal(dataDirectory),
  });
  const now = () => new Date();

  const state = new Workspace(
    {
      sessions,
      capabilities,
      workspace,
      artifacts,
      conversationExport: conversationExport(() => ({
        appVersion: version,
        exportedAt: now(),
      })),
      rewind,
      audit,
      usage: new FileUsageTelemetry(dataDirectory),
      model,
      // Each conversation gets an app-owned browser rather than access to the
      // person's browser or another conversation's page.
      browsers,
      // Pages are drawn in a contained process of their own (ADR 0018).
      documents: new DocumentViewer({ start: startDrawing, containment }),
      pdfWords: (bytes) => pdfPages.words(bytes),
      newTaskId: randomUUID,
      now,
      emit,
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
        pictures: new CanvasPictureFitting(),
        model,
        // The selected model, passed separately so the naming and labelling
        // work can go to a different one, such as a local model.
        guidanceModel: model,
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
    version,
  });
}
