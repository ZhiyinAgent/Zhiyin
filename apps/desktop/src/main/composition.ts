/**
 * Where the real implementations are chosen and handed to the agent loop.
 *
 * Features that are not implemented still fail closed. The model client is a
 * real OpenRouter implementation; its credential source remains replaceable.
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
import { FileAuditLog } from "@zhiyin/audit";
import { CHANNEL, type AppEvent } from "@zhiyin/contract";
import { Core, Workspace, type CoreDependencies } from "@zhiyin/core";
import {
  FileModelChoice,
  OpenRouterModelClient,
  ProviderCredentials,
  type CredentialEntry,
  defaultModel,
  fetchOpenRouterModelInfo,
} from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
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
  readonly credentialEntry?: CredentialEntry;
  /** Tests only: closing browsers and connections never finishes. */
  readonly connectionsNeverClose?: boolean;
};

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
  credentialEntry,
  connectionsNeverClose,
}: Surroundings): Core {
  const emit = (event: AppEvent): void => send(CHANNEL.appEvent, event);
  const views = new PendingViewChecks({
    ask: (request) => send(CHANNEL.viewCheck, request),
  });
  const sessions = new FileSessions(dataDirectory);
  const audit = new FileAuditLog(dataDirectory);
  const credentials = new ProviderCredentials({
    environment: () => process.env["OPENROUTER_API_KEY"],
    ...(credentialEntry ? { entry: credentialEntry } : {}),
  });
  /*
   * Which model answers is the person's choice, kept on disk. The built-in name
   * is only the starting point for an install that has never chosen one, and
   * routing starts unrestricted: a single upstream has no recovery when it is
   * busy. ADR 0030.
   */
  const choice = new FileModelChoice(dataDirectory, {
    model: process.env["ZHIYIN_MODEL"] ?? defaultModel,
    providers: [],
  });
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
  const browserLauncher = playwrightBrowserLauncher(containment);
  const browsers = new BrowserSessions(
    () =>
      new BrowserSession({
        launcher: browserLauncher,
        workspaceRoot: () => workspace.workspaceRoot(),
      }),
  );
  const workspace = new WorkspaceTools(workspaceDirectory, {
    containment,
    shell: containmentState.available ? resolveShell() : undefined,
    // The answer a turn is given: the core's provider settings, which the core
    // reads again whenever the model or the key changes.
    acceptsImages: (): boolean =>
      state.settings.current()?.acceptsImages === true,
    // A command's whole output and a pasted text, kept with the conversation
    // and read again by address.
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
      rewind,
      audit,
      usage: new FileUsageTelemetry(dataDirectory),
      model,
      // Each conversation gets an app-owned browser rather than access to the
      // person's browser or another conversation's page.
      browsers,
      newTaskId: randomUUID,
      now,
      emit,
      onboarding: true,
    },
    (host) =>
      new AgentLoop({
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
        // The selected model for now. Named apart so a local model can take
        // the naming and labelling work.
        guidanceModel: model,
        newMessageId: randomUUID,
        newActionId: randomUUID,
        newSpecialistRunId: randomUUID,
        newApprovalId: randomUUID,
        newUserInputId: randomUUID,
        now,
        host,
      }),
  );

  return new Core({
    workspace: state,
    // One instance owns the data directory at a time, and taking and giving up
    // that ownership belongs to the app's lifetime rather than to a turn.
    ownership: sessions,
    viewChecks: views,
    chooseFolder,
    chooseSaveLocation,
    openExternal,
    openPath,
    version,
  });
}
