/**
 * The app id Windows knows this process by: it groups and draws the taskbar
 * button by it, and names a notification's source by it.
 *
 * An installed app carries the installer's id, which its Start-menu shortcut
 * carries too, so notifications show. A development run gets one of its own.
 * Electron's suggested stand-in, the executable's path, makes Windows draw
 * Electron's icon on the button whatever the window's icon is; it shows
 * notifications only once electron.exe itself is pinned to Start.
 */
export function appUserModelId(packaged: boolean): string {
  return packaged ? "com.zhiyin.desktop" : "com.zhiyin.desktop.dev";
}

/**
 * The name the data folder takes, and with it the lock that keeps one Zhiyin
 * open. A run served by the development server keeps its own, so a build in
 * progress never opens, or updates the format of, the history an installed
 * Zhiyin reads. Keys are not in the folder, and stay shared.
 */
export function dataFolderName(development: boolean): string {
  return development ? "Zhiyin Development" : "Zhiyin";
}

/**
 * What a development run's window tells the taskbar about itself. With no
 * shortcut to read, Windows names a window by its executable, which in
 * development is Electron's, so right-clicking the button would show
 * "Electron" and its icon. A window's relaunch name and icon replace that;
 * Windows uses the name only together with a command, which starts the same
 * run again. The installed app is named by its own executable and shortcut
 * instead.
 */
export function developmentAppDetails(paths: {
  readonly executable: string;
  readonly app: string;
  readonly icon: string;
}) {
  return {
    appId: appUserModelId(false),
    appIconPath: paths.icon,
    relaunchCommand: `"${paths.executable}" "${paths.app}"`,
    relaunchDisplayName: "Zhiyin (development)",
  };
}
