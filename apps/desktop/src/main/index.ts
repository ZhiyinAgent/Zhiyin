/**
 * The Electron main process: the window and the messages between the window
 * and the core. Which implementation each part uses is said in the composition
 * root, and what anything does is decided in the core, so this file holds
 * wiring only.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  Notification,
  shell,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { COMMAND_CHANNELS } from "@zhiyin/contract";
import {
  buildCore,
  debuggingRefusalOf,
  lookForNewerModelList,
  modelListOf,
  savedAppearance,
  startDiagnosticLog,
  testSwitchesOf,
  watchForCrashes,
} from "./composition.js";
import { drawingProcesses } from "./drawing-process.js";
import { fromOwnWindow } from "./ipc-policy.js";
import {
  appUserModelId,
  dataFolderName,
  developmentAppDetails,
} from "./app-identity.js";
import { iconCandidates } from "./icon.js";
import { titleBarOverlay, windowGround } from "./title-bar.js";
import { appFileOf, appPage, appScheme } from "./app-files.js";
import { electronSpellchecker, showTextMenus } from "./electron-spelling.js";

const here = dirname(fileURLToPath(import.meta.url));

// Where the development server serves the window. An installed app never
// reads it: its window comes only from its own files.
const developmentServer = app.isPackaged
  ? undefined
  : process.env["ELECTRON_RENDERER_URL"];

// The data folder is named after the app, and the name otherwise depends on
// how it was started: the package's name in development, Electron's own when
// the built file is run directly. A development run keeps a folder of its own.
// Said before anything reads the folder; a folder given on the command line
// still wins.
app.setName(dataFolderName(developmentServer !== undefined));

// Local only, beside the saved history, and started as soon as the main
// bundle's modules have loaded; a failure while loading them shows only in
// Electron's error box.
const log = startDiagnosticLog(join(app.getPath("userData"), "logs"));

// Ended here, in the first tick and before Chromium opens its debugging
// server, when the switches it was started with would let a program drive the
// window. Before the app is ready, exiting ends the process at once.
const refusal = debuggingRefusalOf(
  (name) => app.commandLine.hasSwitch(name),
  app.isPackaged,
);
if (refusal) {
  log.record({ level: "error", source: "startup", message: refusal });
  app.exit(1);
}

/**
 * No application menu at all. Every page is reached from the window itself, so
 * a menu bar would be a second way to the same places, and a strip of grey
 * above an app that is otherwise its own colours.
 *
 * Nothing is lost with it: Chromium keeps the editing shortcuts — copy, paste,
 * undo, select-all — in editable fields on Windows without a menu to hang the
 * roles on, and the app's own shortcuts are held by the window.
 */
Menu.setApplicationMenu(null);

// The window's own address, said before the app is ready as Electron asks. A
// standard, secure scheme gives the page an origin of its own, so its security
// policy's 'self' names its own files and not every file on the computer.
protocol.registerSchemesAsPrivileged([
  {
    scheme: appScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

app.setAppUserModelId(appUserModelId(app.isPackaged));

/**
 * The app's own mark, so the taskbar and the window show Zhiyin rather than
 * Electron's default. Read through Electron's image loader, which reads out of
 * the packaged archive as happily as off disk.
 */
function appIcon() {
  for (const candidate of iconCandidates(here)) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return undefined;
}

let activeCore: ReturnType<typeof buildCore> | undefined;
/** Whether a dialog covers the page, which dims the window controls too. */
let controlsDimmed = false;

function createWindow(): BrowserWindow {
  const icon = appIcon();
  const bar = titleBarOverlay(nativeTheme.shouldUseDarkColors);
  const window = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 720,
    minHeight: 480,
    title: "Zhiyin",
    ...(icon ? { icon } : {}),
    show: false,
    backgroundColor: windowGround(nativeTheme.shouldUseDarkColors),
    // The strip the window controls sit on belongs to the app; the controls
    // themselves stay Windows'.
    titleBarStyle: "hidden",
    titleBarOverlay: bar,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      // The renderer gets no Node and no direct Electron access. Everything it
      // can do arrives through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // A development run names itself to the taskbar, which would otherwise
  // name it after Electron's executable.
  const iconFile = iconCandidates(here)
    .map((candidate) => resolve(candidate))
    .find((candidate) => existsSync(candidate));
  if (!app.isPackaged && process.platform === "win32" && iconFile)
    window.setAppDetails(
      developmentAppDetails({
        executable: process.execPath,
        app: app.getAppPath(),
        icon: iconFile,
      }),
    );

  window.once("ready-to-show", () => window.show());

  // The page follows the theme by itself; the controls and the ground under
  // the page are told.
  const repaint = () => {
    const dark = nativeTheme.shouldUseDarkColors;
    window.setTitleBarOverlay(titleBarOverlay(dark, controlsDimmed));
    window.setBackgroundColor(windowGround(dark));
  };
  nativeTheme.on("updated", repaint);
  window.once("closed", () => nativeTheme.off("updated", repaint));

  // Developer tools opened where there is a developer. With no menu to hang a
  // role on, the key is read here; in a built app there is no way in at all,
  // which is the point.
  if (developmentServer)
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12")
        window.webContents.toggleDevTools();
    });

  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The window needs no camera, microphone, notification or any other
  // permission a page can ask for, so it is granted none.
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, answer) => answer(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);

  const load = (restarted: boolean) => {
    const query = restarted ? { restarted: "1" } : undefined;
    if (developmentServer) {
      const url = new URL(developmentServer);
      if (query) url.search = new URLSearchParams(query).toString();
      void window.loadURL(url.toString());
    } else {
      void window.loadURL(appPage(query));
    }
  };
  watchForCrashes(
    window,
    {
      load,
      stuck: async ({ title, detail }) =>
        (
          await dialog.showMessageBox(window, {
            type: "error",
            title,
            message: title,
            detail,
            buttons: ["Open it again", "Quit Zhiyin"],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          })
        ).response === 0,
      quit: () => app.quit(),
    },
    log,
  );
  load(false);

  return window;
}

/**
 * A second launch is turned back rather than allowed to run beside the first.
 * Two instances editing the same saved history would each replace the whole of
 * it, and whichever finished first would be erased without a trace. ADR 0007.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  const [existing] = BrowserWindow.getAllWindows();
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.focus();
});

void app.whenReady().then(async () => {
  const dataDirectory = app.getPath("userData");
  // Before the window exists, so its first frame is already the right theme.
  nativeTheme.themeSource = (await savedAppearance(dataDirectory)) ?? "system";
  const testing = testSwitchesOf(process.env, app.isPackaged);
  if (testing.dictionaryServer)
    session.defaultSession.setSpellCheckerDictionaryDownloadURL(
      testing.dictionaryServer,
    );
  const spellchecker = electronSpellchecker(session.defaultSession);
  const renderer = join(here, "../renderer");
  protocol.handle(appScheme, (request) => {
    const file = appFileOf(renderer, request.url);
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response(null, { status: 404 });
  });
  const window = createWindow();
  showTextMenus(window);

  // Kept in memory only: nothing a request leaves, such as a cookie, is
  // written to disk. Nothing is typed there, so it checks no spelling and
  // downloads no dictionary.
  const online = session.fromPartition("zhiyin-network");
  online.setSpellCheckerEnabled(false);
  online.setSpellCheckerLanguages([]);
  // A test switch leaves the features Node's own fetch, for tools that trace
  // or replay a run by replacing it.
  const network = testing.nodeNetwork
    ? undefined
    : (url: string, init: RequestInit) => online.fetch(url, init);
  const modelList = modelListOf({
    dataDirectory,
    ...(network ? { network } : {}),
    ...(testing.modelListServer ? { server: testing.modelListServer } : {}),
  });
  const core = buildCore({
    dataDirectory,
    ...(network ? { network } : {}),
    modelList,
    // Resolved from this file rather than from the app path, which differs
    // between a packaged app, `pnpm dev`, and a bare `electron out/main`.
    builtInPluginsDirectory: app.isPackaged
      ? join(process.resourcesPath, "plugins")
      : join(here, "../../../../packages/plugins/built-in"),
    blenderSessionScript: app.isPackaged
      ? join(process.resourcesPath, "blender-session", "start.py")
      : join(here, "../../../../packages/blender-studio/src/session/start.py"),
    workspaceDirectory:
      testing.workspace ??
      (developmentServer ? join(app.getAppPath(), "../..") : undefined),
    version: app.getVersion(),
    packaged: app.isPackaged,
    send: (channel, payload) => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    },
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "Choose a folder for Zhiyin",
        properties: ["openDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    chooseSaveLocation: async (title, suggestedName) => {
      const result = await dialog.showSaveDialog(window, {
        title,
        defaultPath: suggestedName,
      });
      return result.canceled ? undefined : result.filePath;
    },
    openExternal: (url) => shell.openExternal(url),
    recycle: (path) => shell.trashItem(path),
    // Answers why it could not open, or nothing when it did.
    openPath: async (path) => {
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
    },
    showInFolder: async (path) => shell.showItemInFolder(path),
    log,
    // When to notify is the core's; this only shows one, and brings the
    // window forward when it is clicked.
    notifier: {
      focused: () =>
        BrowserWindow.getAllWindows().some((open) => open.isFocused()),
      notify: (notice, open) => {
        if (window.isDestroyed() || !Notification.isSupported()) return;
        const shown = new Notification({
          title: notice.title,
          body: notice.body,
        });
        shown.on("click", () => {
          if (window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
          open();
        });
        shown.show();
        window.flashFrame(true);
        window.once("focus", () => window.flashFrame(false));
      },
    },
    appearance: {
      apply: (appearance) => {
        nativeTheme.themeSource = appearance;
      },
    },
    windowControls: {
      dim: (dimmed) => {
        controlsDimmed = dimmed;
        if (window.isDestroyed()) return;
        window.setTitleBarOverlay(
          titleBarOverlay(nativeTheme.shouldUseDarkColors, dimmed),
        );
      },
    },
    spelling: {
      engine: spellchecker,
      bundled: app.isPackaged
        ? join(process.resourcesPath, "dictionaries")
        : join(here, "../../dictionaries"),
      installed: join(app.getPath("sessionData"), "Dictionaries"),
      systemLanguages: app.getPreferredSystemLanguages(),
    },
    connectionsNeverClose: testing.connectionsNeverClose,
    // Built beside this file, as an entry of its own.
    startDrawing: drawingProcesses(join(here, "drawing.js")),
    pixelDensity: () =>
      window.isDestroyed()
        ? screen.getPrimaryDisplay().scaleFactor
        : screen.getDisplayMatching(window.getBounds()).scaleFactor,
    ...(testing.credentialsUnavailable
      ? {
          credentialEntry: () => ({
            getPassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
            setPassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
            deletePassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
          }),
        }
      : {}),
  });
  activeCore = core;
  core.start();
  // At every start, and again whenever the Model page opens (ADR 0031).
  lookForNewerModelList(modelList, log);

  // Every command is answered only for this app's own window, from its own
  // top frame; what it carries is then checked by the core.
  for (const channel of Object.values(COMMAND_CHANNELS))
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromOwnWindow(event, window))
        throw new Error("This window cannot send commands.");
      return core.receive(channel, args);
    });

  window.on("closed", () => core.windowClosed());
});

app.on("child-process-gone", (_event, details) => {
  if (details.reason === "clean-exit") return;
  log.record({
    level: "warn",
    source: details.name ?? details.type,
    message: `A helper process ended: ${details.reason}, exit code ${details.exitCode}.`,
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (!activeCore) return;
  event.preventDefault();
  const core = activeCore;
  activeCore = undefined;
  // Bounded by the core: what has not closed in time is named here and left
  // behind, and the Job Objects end any process it still owned.
  void core
    .shutdown()
    .then(
      (unfinished) => {
        if (unfinished.length)
          log.record({
            level: "warn",
            source: "shutdown",
            message: `Quit without waiting any longer for: ${unfinished.join(", ")}.`,
          });
      },
      (error: unknown) =>
        log.record({
          level: "error",
          source: "shutdown",
          message: "Shutting down failed.",
          error,
        }),
    )
    .finally(() => app.quit());
});
