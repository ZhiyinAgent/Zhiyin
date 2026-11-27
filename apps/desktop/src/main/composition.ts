/**
 * Where the real implementations are chosen and handed to the agent loop.
 *
 * The model client talks to the provider the person chose, OpenRouter or a
 * lab's own API; each key comes from the environment or from the operating
 * system's credential store.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentLoop } from "@zhiyin/agent-loop";
import {
  ComposedCapabilities,
  browserConnection,
  declaredConnectionsOf,
  unreadablePackagesOf,
  documentsConnection,
  sceneConnection,
  cadConnection,
  gitConnection,
  pythonConnection,
  joinedConnections,
  needing,
} from "@zhiyin/capabilities";
import {
  gitAutomation,
  gitProgramLocations,
  shellGit,
} from "@zhiyin/git-connector";
import { documentCompilers, documentPrograms } from "@zhiyin/document-compiler";
import { pythonEnvironments, pythonPrograms } from "@zhiyin/python-sandbox";
import {
  CadConversations,
  cadAutomation,
  cadKnowledge,
  cadEnvironment,
  cadPrograms,
  describeCadTools,
  KeptFontLists,
  PartPreviews,
  PartReviews,
  type CadPython,
} from "@zhiyin/cad-studio";
import {
  ConversationScenes,
  compiledBlenderPython,
  containedSessionLaunch,
  describeSceneTools,
  KeptShaderCaches,
  nvidiaDriverVersion,
  sceneAutomation,
  scenePrograms,
  sceneLines,
  sceneReviews,
} from "@zhiyin/blender-studio";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { conversationExport } from "@zhiyin/conversation-export";
import { FileCorrectionsLog } from "@zhiyin/corrections-log";
import { checkRecyclable, replaceFile } from "@zhiyin/files";
import {
  CHANNEL,
  type AppEvent,
  type Appearance,
  type LookChoice,
} from "@zhiyin/contract";
import {
  Core,
  DiagnosticLog,
  Workspace,
  debuggingRefusal,
  recordCrashes,
  reloadAfterCrash,
  testSwitches,
  lookForNewerModelList as lookForNewerList,
  type TestSwitches,
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
import {
  GuardedPermissionEngine,
  StandingGrantRules,
} from "@zhiyin/permission-engine";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import type { WatchThread, WatchThreadData } from "@zhiyin/file-watch";
import { FileRecovery, folderLinks, RunBackups } from "@zhiyin/recovery";
import { ComposedRewind, FileRewindJournal } from "@zhiyin/rewind";
import {
  CanvasPictureFitting,
  WorkspaceTools,
  type ShellReach,
} from "@zhiyin/tools";
import {
  ComparisonThreads,
  type ComparisonThread,
} from "@zhiyin/picture-comparison";
import {
  containmentAvailability,
  openProcessContainer,
  type ProxyRoute,
  readOnlyHolds,
  removeUnusedContainers,
  runProcess,
} from "@zhiyin/sandbox";
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
  KeptVideos,
  type StartDrawingProcess,
} from "@zhiyin/document-viewer";
import { randomUUID } from "node:crypto";
import { PendingViewChecks } from "@zhiyin/views";
import { FileMemory, closeEntriesCheck } from "@zhiyin/memory";
import {
  AppUpdates,
  releaseKeys,
  updatePlaces,
  type UpdatePlace,
  type UpdateSource,
} from "@zhiyin/updates";

export {
  NotUsable,
  type SignedRelease,
  type UpdatePlace,
  type UpdateSource,
} from "@zhiyin/updates";

/** What the composition needs from the Electron side. */
export type Surroundings = {
  readonly dataDirectory: string;
  /** The folder the application runs from, which no tool writes. */
  readonly programDirectory?: string;
  /** Where the plugins shipped with the application are. */
  readonly builtInPluginsDirectory: string;
  /** The script Blender runs for the 3D studio; without it there is no studio. */
  readonly blenderSessionScript?: string;
  /** The script the CAD studio's Python runs; without it there is no studio. */
  readonly cadHarness?: string;
  /**
   * Zhiyin's shell, the folder holding `busybox.exe` and the `git` that hands
   * git to Zhiyin (ADR 0029); without it, commands run in the bash found here
   * with full access.
   */
  readonly busyboxDirectory?: string;
  readonly workspaceDirectory: string | undefined;
  readonly version: string;
  /**
   * The model switches a test run, an evaluation or a benchmark sets, and
   * Blender drawing as on a PC whose graphics card cannot; an installed app
   * has none.
   */
  readonly testing?: Pick<
    TestSwitches,
    "model" | "modelEndpoint" | "noGraphicsCard"
  >;
  /** Sends to the app's window while it is open. */
  readonly send: (channel: string, payload: unknown) => void;
  readonly chooseFolder: CoreDependencies["chooseFolder"];
  readonly chooseSaveLocation: CoreDependencies["chooseSaveLocation"];
  readonly openExternal: CoreDependencies["openExternal"];
  /** Puts text on the person's clipboard; absent, as in tests, nothing is. */
  readonly copyText?: CoreDependencies["copyText"];
  readonly openPath: CoreDependencies["openPath"];
  readonly showInFolder: CoreDependencies["showInFolder"];
  /** Moves one item to the Recycle Bin; rejects, deleting nothing, when it cannot. */
  readonly recycle?: (path: string) => Promise<void>;
  /**
   * The person's folders where work of every kind passes (home, Documents,
   * Desktop, Downloads), which memory never links to a project.
   */
  readonly broadFolders?: readonly string[];
  /** The operating system's notifications. */
  readonly notifier?: Notifier;
  /** Paints the window light, dark, or as Windows is set. */
  readonly appearance?: { readonly apply: (appearance: Appearance) => void };
  /** Dresses the window in a look, at a strength. */
  readonly look?: { readonly apply: (choice: LookChoice) => void };
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
   * How Chromium's network would reach a URL: the way the proxy of a confined
   * run that names hosts goes out, so it uses the computer's own proxy as
   * Zhiyin's requests do. Directly when absent, as in tests.
   */
  readonly proxyRoute?: ProxyRoute;
  /**
   * Zhiyin's model list and where newer ones come from (ADR 0027). Absent, as
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
  /**
   * Starts a thread that compares two pictures' pixels. Absent, as in tests,
   * they are compared in the core's own thread.
   */
  readonly startComparing?: () => ComparisonThread;
  /**
   * Starts the thread that holds the files a turn may change (ADR 0031).
   * Absent, as in tests, each run's folder is saved as the run is readied.
   */
  readonly startWatching?: (data: WatchThreadData) => WatchThread;
  /** Device pixels per CSS pixel where the window is now. */
  readonly pixelDensity?: () => number;
  /** Where what went wrong is kept, on this computer. */
  readonly log?: { record(entry: LogEntry): void };
  /**
   * The videos the 3D studio renders, kept to be played beside the
   * conversation; the window's video scheme is answered from them. Absent,
   * as in tests, no video is played.
   */
  readonly videos?: KeptVideos;
  /** Zhiyin updating itself (ADR 0027). Absent, as in tests, it does not. */
  readonly updates?: AppUpdates;
  /** Quits so the update that is ready installs. */
  readonly restartToUpdate?: () => void;
};

/**
 * A rehearsal build (docs/maintainers.md, "Rehearsing an update"): it updates
 * from a test server with a test key, runs with its window hidden, and
 * restarts into an update as soon as one is ready, so a script can install
 * and update it unwatched. No release is built as one. It is named in the
 * build, so an installed app reads nothing of it from outside.
 */
export type Rehearsal = {
  readonly rehearsal: "zhiyin-update-rehearsal";
  readonly keys: Readonly<Record<string, string>>;
  readonly places: readonly UpdatePlace[];
};

/** A rehearsal build's settings, as the build wrote them; none in any other. */
export function rehearsalOf(written: string): Rehearsal | undefined {
  // The marker is never named in code, so only a rehearsal build carries it,
  // and the packaged check finds it in no other (scripts/check-packaged.mjs).
  return written ? (JSON.parse(written) as Rehearsal) : undefined;
}

/**
 * Zhiyin updating itself (ADR 0027), from the places and with the keys this
 * build ships, kept in the data folder.
 */
export function appUpdatesOf({
  dataDirectory,
  version,
  source,
  network,
  rehearsal,
}: {
  readonly dataDirectory: string;
  readonly version: string;
  readonly source: UpdateSource;
  /** Chromium's network (ADR 0004), for the releases' signatures. */
  readonly network: NonNullable<Surroundings["network"]>;
  readonly rehearsal?: Rehearsal | undefined;
}): AppUpdates {
  return new AppUpdates({
    directory: join(dataDirectory, "updates"),
    version,
    keys: rehearsal?.keys ?? releaseKeys,
    places: rehearsal?.places ?? updatePlaces,
    source,
    network,
  });
}

/**
 * Zhiyin's model list (ADR 0027), kept in the data folder, with newer ones
 * read from GitHub or Zhiyin's copy over `network`, or from `server` where a
 * test names one.
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
          places: [
            {
              name: new URL(server).host,
              list: new URL("models.json", server).href,
              signature: new URL("models.json.sig", server).href,
            },
          ],
        }
      : {}),
  });
}

/** Looks once for a newer model list: the core decides what is logged. */
export const lookForNewerModelList = lookForNewerList;

/** The person's light or dark choice, read before the window is made. */
export function savedAppearance(
  dataDirectory: string,
): Promise<Appearance | undefined> {
  return new FileSessions(dataDirectory).savedAppearance();
}

/** The person's look, read before the window is made. */
export function savedLook(
  dataDirectory: string,
): Promise<LookChoice | undefined> {
  return new FileSessions(dataDirectory).savedLook();
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

/**
 * The videos the 3D studio renders, kept in the app's data to be played
 * beside the conversation; what the last run kept is let go of.
 */
export const keptVideosOf = (dataDirectory: string) =>
  new KeptVideos(join(dataDirectory, "videos"));

/** The switches only an uninstalled build reads, for testing it: the core decides. */
export const testSwitchesOf = testSwitches;

/** Whether the switches the app was started with let it start: the core decides. */
export const debuggingRefusalOf = debuggingRefusal;

export type { SpellcheckEngine, TextMenuItem } from "@zhiyin/spelling";

export function buildCore({
  dataDirectory,
  programDirectory,
  builtInPluginsDirectory,
  blenderSessionScript,
  cadHarness,
  busyboxDirectory,
  workspaceDirectory,
  version,
  testing = {},
  send,
  chooseFolder,
  chooseSaveLocation,
  openExternal,
  copyText,
  openPath,
  showInFolder,
  recycle,
  broadFolders = [],
  notifier,
  appearance,
  look,
  windowControls,
  spelling,
  network,
  proxyRoute,
  modelList = modelListOf({ dataDirectory, ...(network ? { network } : {}) }),
  credentialEntry,
  connectionsNeverClose,
  startDrawing,
  startComparing,
  startWatching,
  pixelDensity,
  log,
  videos,
  updates,
  restartToUpdate,
}: Surroundings): Core {
  const emit = (event: AppEvent): void => send(CHANNEL.appEvent, event);
  /**
   * Whether the model sees pictures: the core's one answer, from its provider
   * settings, which it reads again whenever the model or the key changes.
   */
  const acceptsImages = (): boolean =>
    state.settings.current()?.acceptsImages === true;
  const views = new PendingViewChecks({
    ask: (request) => send(CHANNEL.viewCheck, request),
  });
  // The person's Recycle Bin, asked about through a program Zhiyin owns.
  const recycleBin = recycle
    ? {
        recyclable: (paths: readonly string[]) =>
          checkRecyclable(paths, runProcess),
        recycle,
      }
    : undefined;
  const sessions = new FileSessions(dataDirectory, {
    version,
    ...(recycleBin ? { recycleBin } : {}),
  });
  const corrections = new FileCorrectionsLog(dataDirectory);
  /*
   * Which provider and model answer is the person's choice, kept on disk;
   * until they make it, nothing is sent. Routing starts unrestricted: a single
   * upstream has no recovery when it is busy. ADR 0014.
   *
   * A test run or the benchmark may fix the model, on OpenRouter when it
   * names no provider, and send every request elsewhere.
   */
  const model = new ModelProviders({
    environment: (variable) => process.env[variable],
    ...(testing.model
      ? { fixed: testing.model }
      : { choice: new FileModelChoice(dataDirectory) }),
    ...(testing.modelEndpoint ? { endpoint: testing.modelEndpoint } : {}),
    ...(network ? { network } : {}),
    ...(credentialEntry ? { credentialEntry } : {}),
    modelLists: modelList,
  });
  const containment = {
    open: openProcessContainer,
    ...(proxyRoute ? { route: proxyRoute } : {}),
  };
  const containmentState = containmentAvailability();
  // The containers left from homes that are gone leave the person's profile.
  if (containmentState.available)
    void removeUnusedContainers().catch(() => undefined);
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
  // A write outside the workspace the person approves never reaches
  // Zhiyin's own folders, where it could change what was approved.
  const ownFolders = [
    dataDirectory,
    ...(programDirectory ? [programDirectory] : []),
  ];
  // What a sealed-off script may only read for its run; what a run left
  // held when Zhiyin stopped gets its permissions back as this starts.
  const holds = readOnlyHolds(dataDirectory, { replace: replaceFile });
  // One reading process for every PDF read in the core: the model's, and the
  // words compared when a person reviews a changed PDF.
  const pdfPages = new ContainedPdfPages({ start: startDrawing, containment });
  // A picture made smaller for the model, or compared, is decoded in one too
  // (ADR 0019).
  const containedPictures = new ContainedPictures({
    start: startDrawing,
    containment,
  });
  // What each conversation granted its sealed-off commands, kept by the
  // agent loop, which is built once the core is.
  let reachOf: ((conversationId: string) => ShellReach) | undefined;
  // No folder of its own: each conversation enters its own (ADR 0008).
  const workspace = new WorkspaceTools(undefined, {
    containment,
    protect: ownFolders,
    // Zhiyin's own shell, sealed off in a container of each conversation's
    // own; git runs outside it, through the person's Git (ADR 0029). A
    // build without it runs commands in the bash found here.
    ...(busyboxDirectory && existsSync(join(busyboxDirectory, "busybox.exe"))
      ? {
          sealedShell: {
            busybox: join(busyboxDirectory, "busybox.exe"),
            handoff: join(busyboxDirectory, "git"),
            homes: join(dataDirectory, "shell-homes"),
            git: shellGit({
              containment,
              ...(proxyRoute ? { route: proxyRoute } : {}),
              // The links in a repository, kept from the change journal, so
              // a git call need not walk it whole each time.
              linksIn: folderLinks(),
            }),
            // The shell is told only that Zhiyin could not run git; which
            // step failed, and why, is kept here.
            recordGitFailure: ({ conversationId, step, error }) =>
              log?.record({
                level: "error",
                source: "sealed shell",
                message: `Zhiyin could not run a git command for the shell in conversation ${conversationId}: ${step === "hold" ? "holding its container still" : "git"} failed.`,
                error,
              }),
            // Zhiyin's own Node, a toolchain like uv (ADR 0027); a command
            // with full access runs the person's.
            node: {
              executable: () => toolchains.executable("node"),
              install: () => toolchains.install("node"),
            },
          },
          reach: (conversationId: string) =>
            reachOf?.(conversationId) ?? {
              hosts: [],
              read: [],
              change: [],
              registries: true,
            },
        }
      : {}),
    // A PDF the model reads is read in a contained process, as one the person
    // sees is drawn in one (ADR 0019).
    pdfPages,
    pixels: containedPictures,
    // The arithmetic on those pixels runs on a thread of its own, so a
    // comparison never holds up the core.
    ...(startComparing
      ? { comparer: new ComparisonThreads({ start: startComparing }) }
      : {}),
    ...(containmentState.available
      ? {}
      : { uncontained: containmentState.reason }),
    ...(recycleBin ? { recycleBin } : {}),
    acceptsImages,
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
  // Each conversation's own Blender, installed as a toolchain (ADR 0022).
  const blender = () => toolchains.executable("blender");
  const scenes = blenderSessionScript
    ? new ConversationScenes({
        blender,
        directory: join(dataDirectory, "blender-studio"),
        launch: containedSessionLaunch(containment, {
          scripts: join(dataDirectory, "blender-studio", "session-scripts"),
          ...(testing.noGraphicsCard ? { withoutGraphicsCard: true } : {}),
          // The shaders a new conversation's Blender starts on (ADR 0032).
          shaderCaches: new KeptShaderCaches({
            directory: join(dataDirectory, "blender-studio", "shader-caches"),
            driver: nvidiaDriverVersion(containment),
          }),
        }),
        script: blenderSessionScript,
      })
    : undefined;
  /** The parts each conversation built last, which the person sees beside it. */
  const partPreviews = cadHarness
    ? new PartPreviews(join(dataDirectory, "part-previews"))
    : undefined;
  /** One Python for the app, its environments shared by every conversation. */
  const pythons = pythonEnvironments({
    directory: join(dataDirectory, "python-sandbox"),
    uv: async () => toolchains.executable("uv"),
    containment,
    protect: ownFolders,
    // The CAD studio's build123d, kept here for it (ADR 0023).
    keptEnvironments: [cadEnvironment],
  });
  const python = pythons.connection;
  /** Each conversation's CAD studio records, which go with the conversation. */
  const cadConversations = new CadConversations(
    join(dataDirectory, "cad-studio"),
  );
  /** A conversation's 3D studio tools: the model's, and those its reviewer's views are drawn with. */
  const sceneTools = (studio: ConversationScenes, conversationId: string) =>
    sceneAutomation(studio.scene(conversationId), {
      workspaceRoot: () => workspace.workspaceRoot(conversationId),
      blender,
      directory: studio.directory(conversationId),
      protect: ownFolders,
      held: (path) => holds.heldAt(path),
      ...(videos
        ? {
            video: (file) =>
              videos.keep(conversationId, file.relative, file.absolute),
          }
        : {}),
    });
  /** The CAD studio's build123d, an environment the sandbox keeps (ADR 0023). */
  const cadPython: CadPython = {
    state: () => pythons.kept.state(cadEnvironment.name),
    run: (request) =>
      pythons.kept.run({ environment: cadEnvironment.name, ...request }),
  };
  /** The system's fonts as ezdxf lists them, kept for every conversation's builds. */
  const cadFonts = cadHarness
    ? new KeptFontLists({
        directory: join(dataDirectory, "cad-fonts"),
        python: cadPython,
        harness: cadHarness,
      })
    : undefined;
  /** One installed program, named the way the compiler asks for it. */
  const executable = async (id: "typst" | "tectonic") => {
    const path = await toolchains.executable(id);
    return path ? { [id]: path } : {};
  };
  /** One compiler, and its one package cache, for every folder. */
  const compiler = documentCompilers({
    programs: async () => {
      const installed = {
        ...(await executable("typst")),
        ...(await executable("tectonic")),
      };
      // The version each installed engine is pinned at, named in its answer.
      const versions = Object.fromEntries(
        pinnedToolchains
          .filter((spec) => spec.id in installed)
          .map((spec) => [spec.id, spec.version]),
      );
      return { ...installed, versions };
    },
    tectonicCache: join(dataDirectory, "tectonic"),
    // The PDF a compile wrote is read back where every PDF is (ADR 0019).
    readBack: pdfPages,
    containment,
    protect: ownFolders,
  });
  /** The application's own connections, and what each needs before it can run. */
  const appConnections = joinedConnections([
    browserConnection(
      (conversationId) =>
        browserAutomation(browsers.browser(conversationId), {
          // The core's one answer, which turns follow too; the
          // browser's tools are listed again when it changes.
          acceptsImages: async (): Promise<boolean> => acceptsImages(),
          outputDirectory: browsers.directory(conversationId),
        }),
      () =>
        describeBrowserAutomation(browserLauncher, {
          acceptsImages: async (): Promise<boolean> => acceptsImages(),
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
    needing(
      documentsConnection(
        (conversationId) =>
          compiler(() => workspace.workspaceRoot(conversationId)),
        () => compiler(() => undefined).listTools(),
      ),
      { programs: documentPrograms },
    ),
    needing(
      pythonConnection(
        (conversationId) =>
          python(() => workspace.workspaceRoot(conversationId)),
        () => python(() => undefined).listTools(),
      ),
      { programs: pythonPrograms },
    ),
    ...(scenes
      ? [
          needing(
            sceneConnection(
              (conversationId) => sceneTools(scenes, conversationId),
              () => describeSceneTools(blender),
            ),
            { programs: scenePrograms },
          ),
        ]
      : []),
    ...(cadHarness
      ? [
          needing(
            cadConnection(
              (conversationId) =>
                cadAutomation(cadPython, {
                  workspaceRoot: () => workspace.workspaceRoot(conversationId),
                  harness: cadHarness,
                  directory: cadConversations.folder(conversationId),
                  protect: ownFolders,
                  ...(cadFonts ? { fonts: cadFonts } : {}),
                  ...(partPreviews
                    ? {
                        preview: (model, parts, script) =>
                          partPreviews.shown(
                            conversationId,
                            model,
                            parts,
                            script,
                          ),
                      }
                    : {}),
                  ...(scenes
                    ? {
                        sceneLines: sceneLines(
                          scenes.scene(conversationId),
                          scenes.directory(conversationId),
                          blender,
                        ),
                      }
                    : {}),
                }),
              () => describeCadTools(cadPython),
            ),
            {
              programs: cadPrograms,
              // The CAD studio's environment, made with uv (ADR 0023).
              setup: pythons.kept.installation(cadEnvironment.name),
            },
          ),
        ]
      : []),
  ]);
  // What each studio hands the reviewer of the work a turn changed (ADR 0024).
  const reviews = [
    ...(scenes
      ? [
          sceneReviews({
            directory: (conversationId) => scenes.directory(conversationId),
            tools: (conversationId) => sceneTools(scenes, conversationId),
            open: async (conversationId) => {
              const root = workspace.workspaceRoot(conversationId);
              return root
                ? scenes.scene(conversationId).sceneIn(root)
                : undefined;
            },
          }),
        ]
      : []),
    ...(cadHarness
      ? [
          new PartReviews((conversationId) =>
            cadConversations.folder(conversationId),
          ),
        ]
      : []),
  ];
  const capabilities = new ComposedCapabilities({
    tools: workspace,
    commands: workspace,
    mcp: new ManagedMcpServers(
      dataDirectory,
      connectHttpMcpServer,
      new KeyringMcpCredentials(),
      {
        builtIns: appConnections.builtIns,
        declared: () => declaredConnectionsOf(plugins),
        unreadable: () => unreadablePackagesOf(plugins),
        now: Date.now,
        signInOptions: { openBrowser: openExternal },
        network,
      },
    ),
    plugins,
    toolchains,
    connectionToolchains: appConnections.toolchains,
    connectionSetups: appConnections.setups,
    // Stopping a turn, deleting a conversation and shutting down all let go of
    // what a conversation holds through this one group.
    browsers,
    ...(scenes ? { scenes } : {}),
    cad: cadConversations,
    // What the studios know beyond their tools, found and opened through the
    // catalog (ADR 0017, ADR 0024).
    knowledge: [
      ...(scenes ? [scenes.knowledge()] : []),
      ...(cadHarness
        ? [
            cadKnowledge(cadPython, {
              harness: cadHarness,
              directory: join(dataDirectory, "cad-reference"),
            }),
          ]
        : []),
    ],
  });
  // A test's stand-in for a browser or connection that never finishes closing.
  if (connectionsNeverClose)
    capabilities.shutdown = () => new Promise<void>(() => {});
  // Each preview and export is given its conversation's folder by the core.
  const artifacts = new WorkspaceArtifacts();
  // The loop asks, in a conversation whose turn is writing, about a file the
  // undo budget has no room for; it exists once the core makes it, below.
  let turns: AgentLoop | undefined;
  // From each turn's start, the files of its folder are held, and saved as
  // the turn first writes each, on a thread of their own (ADR 0031). A
  // script's or command's folder is listed as commands are checked.
  const recovery = new FileRecovery(dataDirectory, {
    list: workspace.listWorkspace,
    ...(startWatching ? { watch: startWatching } : {}),
    ask: async ({ conversationId, path, bytes, roomBytes, budgetBytes }) =>
      conversationId && turns
        ? turns.askUndoRoom(conversationId, {
            path,
            bytes,
            roomBytes,
            budgetBytes,
          })
        : "refuse",
    released: (versions) => state.undoVersionsReleased(versions),
  });
  const rewind = new ComposedRewind({
    conversation: new ConversationRewind(randomUUID),
    recovery,
    journal: new FileRewindJournal(dataDirectory, replaceFile),
  });
  const runs = new RunBackups(recovery, {
    holds,
    programLocations: gitProgramLocations,
  });
  const now = () => new Date();
  // What Zhiyin remembers across conversations (ADR 0026). A project is
  // deleted to the Recycle Bin, or not at all.
  const memory = new FileMemory({
    folder: join(dataDirectory, "memory"),
    now,
    newId: randomUUID,
    broadFolders,
    recycle,
  });

  const state = new Workspace(
    {
      startingFolder: workspaceDirectory,
      // One history on disk, handed in once for each role the core takes.
      sessions,
      kept: sessions,
      historyRepair: sessions,
      historyUpdates: sessions,
      // The capabilities group, likewise handed in once for each role.
      capabilityOverview: capabilities,
      pluginManagement: capabilities,
      connectionManagement: capabilities,
      capabilityLifecycle: capabilities,
      commands: capabilities,
      workspace,
      artifacts,
      conversationExport: conversationExport(() => ({
        appVersion: version,
        exportedAt: now(),
      })),
      rewind,
      usage: new FileUsageTelemetry(dataDirectory),
      memory,
      model,
      modelProviders: model,
      modelList,
      // Each conversation gets an app-owned browser rather than access to the
      // person's browser or another conversation's page.
      browsers,
      // Each conversation's 3D scene, which the person watches (ADR 0022).
      ...(scenes ? { scenes } : {}),
      // The parts each conversation's CAD studio built last.
      ...(partPreviews ? { parts: partPreviews } : {}),
      // Pages are drawn in a contained process of their own (ADR 0019).
      documents: new DocumentViewer({
        start: startDrawing,
        containment,
        ...(videos ? { videos } : {}),
      }),
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
      ...(look ? { look } : {}),
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
        grants: new StandingGrantRules(),
        capabilities,
        commands: capabilities,
        workspace,
        artifacts,
        views,
        rewind,
        backups: recovery,
        runs,
        turnFiles: recovery,
        corrections,
        kept: sessions,
        // A picture past what the configured model accepts is scaled rather
        // than refused, and the model is told what it is looking at.
        pictures: new CanvasPictureFitting({
          shrink: (bytes, width) => containedPictures.smaller(bytes, width),
        }),
        model,
        memory,
        // A new entry close to kept ones is named to the model with them.
        afterCalls: [closeEntriesCheck(memory)],
        reviews,
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
      reachOf = (conversationId) => loop.shellReach(conversationId);
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
        (taskId, job, changes, outcome) =>
          void loop.jobChanged(taskId, job, changes, outcome),
      );
      turns = loop;
      return loop;
    },
  );

  return new Core({
    dataFolder: dataDirectory,
    undo: recovery,
    workspace: state,
    // One instance owns the data directory at a time, and taking and giving up
    // that ownership belongs to the app's lifetime rather than to a turn.
    ownership: sessions,
    viewChecks: views,
    commands: capabilities,
    chooseFolder,
    chooseSaveLocation,
    openExternal,
    ...(copyText ? { copyText } : {}),
    openPath,
    showInFolder,
    ...(windowControls ? { windowControls } : {}),
    version,
    ...(updates ? { updates } : {}),
    ...(restartToUpdate ? { restartToUpdate } : {}),
  });
}
