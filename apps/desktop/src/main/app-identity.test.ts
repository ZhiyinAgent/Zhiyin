/**
 * Windows draws a taskbar button, and names a notification's source, by the
 * process's app id. An installed Zhiyin must carry the id its installer's
 * shortcut carries; a development run needs one of its own. The executable's
 * path, Electron's suggested stand-in, makes Windows draw Electron's icon
 * there whatever icon the window carries. The taskbar itself is not checked
 * here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appUserModelId, developmentAppDetails } from "./app-identity.js";

const installerAppId = /^appId:\s*(\S+)\s*$/m.exec(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../electron-builder.yml"),
    "utf8",
  ),
)?.[1];

describe("the app id Windows knows Zhiyin by", () => {
  it("is the installer's own when installed, so the shortcut and the window are one app", () => {
    expect(installerAppId).toBeDefined();
    expect(appUserModelId(true)).toBe(installerAppId);
  });

  it("is a development run's own, neither the installed app's nor Electron's executable", () => {
    const development = appUserModelId(false);
    expect(development).not.toBe(installerAppId);
    expect(development).not.toMatch(/[\\/]|\.exe$/i);
  });
});

/**
 * With no shortcut, Windows names a development run's window by its
 * executable, so its taskbar button would say "Electron" and show Electron's
 * icon. The window's own relaunch details name it instead.
 */
describe("what the taskbar says a development run is", () => {
  const details = developmentAppDetails({
    executable: String.raw`C:\Program Files\node_modules\electron\dist\electron.exe`,
    app: String.raw`C:\Users\me\Zhiyin Code\apps\desktop`,
    icon: String.raw`C:\Users\me\Zhiyin Code\apps\desktop\build\icon.ico`,
  });

  it("names it Zhiyin with Zhiyin's icon, under the development run's own app id", () => {
    expect(details).toMatchObject({
      appId: appUserModelId(false),
      appIconPath: String.raw`C:\Users\me\Zhiyin Code\apps\desktop\build\icon.ico`,
      relaunchDisplayName: "Zhiyin (development)",
    });
  });

  // Windows uses the name only with a command, and runs the command as typed.
  it("gives a command that starts the same run again, with each path quoted", () => {
    expect(details.relaunchCommand).toBe(
      String.raw`"C:\Program Files\node_modules\electron\dist\electron.exe" "C:\Users\me\Zhiyin Code\apps\desktop"`,
    );
  });
});
