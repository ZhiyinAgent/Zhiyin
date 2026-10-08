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
  screen,
  session,
  Notification,
  shell,
} from "electron";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { COMMAND_CHANNELS } from "@zhiyin/contract";
import { buildCore, savedAppearance } from "./composition.js";
import { drawingProcesses } from "./drawing-process.js";
import { DiagnosticLog, recordCrashes } from "./diagnostic-log.js";
import { fromOwnWindow } from "./ipc-policy.js";
import { appUserModelId, developmentAppDetails } from "./app-identity.js";
import { iconCandidates } from "./icon.js";
import { titleBarOverlay } from "./title-bar.js";
import { electronSpellchecker, showTextMenus } from "./electron-spelling.js";
import { reloadAfterCrash } from "./window-recovery.js";

const here = dirname(fileURLToPath(import.meta.url));

// The data folder is named after the app, and the name otherwise depends on
// how it was started: the package's name in development, Electron's own when
// the built file is run directly. Said before anything reads the folder; a
// folder given on the command line still wins.
app.setName("Zhiyin");

/**
 * Local only, beside the saved history. Started before anything else so that
 * whatever fails from here on leaves a line behind, and the main process keeps
 * running rather than dying on an error nobody caught.
 */
const log = new DiagnosticLog(join(app.getPath("userData"), "logs"));
log.prune();
recordCrashes(process, log);

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
    backgroundColor: bar.color,
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
    const theme = titleBarOverlay(nativeTheme.shouldUseDarkColors);
    window.setTitleBarOverlay(theme);
    window.setBackgroundColor(theme.color);
  };
  nativeTheme.on("updated", repaint);
  window.once("closed", () => nativeTheme.off("updated", repaint));

  // Developer tools opened where there is a developer. With no menu to hang a
  // role on, the key is read here; in a built app there is no way in at all,
  // which is the point.
  if (process.env["ELECTRON_RENDERER_URL"])
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12")
        window.webContents.toggleDevTools();
    });

  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const load = (restarted: boolean) => {
    const query = restarted ? { restarted: "1" } : undefined;
    if (process.env["ELECTRON_RENDERER_URL"]) {
      const url = new URL(process.env["ELECTRON_RENDERER_URL"]);
      if (query) url.search = new URLSearchParams(query).toString();
      void window.loadURL(url.toString());
    } else {
      void window.loadFile(join(here, "../renderer/index.html"), {
        ...(query ? { query } : {}),
      });
    }
  };
  reloadAfterCrash(window, load, log);
  load(false);

  return window;
}

/**
 * A second launch is turned back rather than allowed to run beside the first.
 * Two instances editing the same saved history would each replace the whole of
 * it, and whichever finished first would be erased without a trace. ADR 0005.
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
  // Tests only: where a dictionary that is not bundled would be fetched from.
  const dictionaryServer = process.env["ZHIYIN_TEST_DICTIONARY_SERVER"];
  if (dictionaryServer)
    session.defaultSession.setSpellCheckerDictionaryDownloadURL(
      dictionaryServer,
    );
  const spellchecker = electronSpellchecker(session.defaultSession);
  const window = createWindow();
  showTextMenus(window);

  const core = buildCore({
    dataDirectory,
    // Resolved from this file rather than from the app path, which differs
    // between a packaged app, `pnpm dev`, and a bare `electron out/main`.
    builtInPluginsDirectory: app.isPackaged
      ? join(process.resourcesPath, "plugins")
      : join(here, "../../../../packages/plugins/built-in"),
    workspaceDirectory:
      process.env["ZHIYIN_WORKSPACE"] ??
      (process.env["ELECTRON_RENDERER_URL"]
        ? join(app.getAppPath(), "../..")
        : undefined),
    version: app.getVersion(),
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
    spelling: {
      engine: spellchecker,
      bundled: app.isPackaged
        ? join(process.resourcesPath, "dictionaries")
        : join(here, "../../dictionaries"),
      installed: join(app.getPath("sessionData"), "Dictionaries"),
      systemLanguages: app.getPreferredSystemLanguages(),
    },
    connectionsNeverClose:
      process.env["ZHIYIN_TEST_CONNECTIONS_NEVER_CLOSE"] === "1",
    // Built beside this file, as an entry of its own.
    startDrawing: drawingProcesses(join(here, "drawing.js")),
    pixelDensity: () =>
      window.isDestroyed()
        ? screen.getPrimaryDisplay().scaleFactor
        : screen.getDisplayMatching(window.getBounds()).scaleFactor,
    ...(process.env["ZHIYIN_TEST_CREDENTIALS_UNAVAILABLE"] === "1"
      ? {
          credentialEntry: {
            getPassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
            setPassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
            deletePassword: async () => {
              throw new Error("Credential storage unavailable in this test.");
            },
          },
        }
      : {}),
  });
  activeCore = core;
  core.start();

  // Every command is answered only for this app's own window, from its own
  // top frame; what it carries is then checked by the core.
  for (const channel of Object.values(COMMAND_CHANNELS))
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!fromOwnWindow(event, window))
        throw new Error("This window cannot send commands.");
      return core.receive(channel, args);
    });

  window.on("closed", () => core.windowClosed());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
