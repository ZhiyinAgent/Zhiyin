/**
 * An Electron main process that runs a confined program naming one host, as
 * Zhiyin's features do through `runProcess`, so the proxy and its pipe's
 * permissions run in Electron, as they do in the app. The program is Electron
 * run as Node, which the development build allows. What the run answered is
 * written beside the folder it is given.
 *
 * Arguments: the folder, the stand-in proxy's port, the program's script.
 */

import { realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  openProcessContainer,
  runProcess,
  windowsEnvironment,
} from "@zhiyin/sandbox";

const [directory = "", port = "", script = ""] = process.argv.slice(-3);

void app.whenReady().then(async () => {
  const ran = await runProcess({
    executable: process.execPath,
    arguments: [
      "--no-stdio-init",
      "--preserve-symlinks-main",
      "--preserve-symlinks",
      script,
    ],
    cwd: directory,
    timeoutMs: 60_000,
    containment: {
      open: openProcessContainer,
      route: async () => `PROXY 127.0.0.1:${port}`,
    },
    environment: { ...windowsEnvironment(), ELECTRON_RUN_AS_NODE: "1" },
    confinement: {
      purpose: "test-electron-network",
      home: join(directory, "home"),
      read: [join(script, ".."), realpathSync(dirname(process.execPath))],
      write: [],
      hosts: ["pypi.org"],
    },
  });
  writeFileSync(join(directory, "ran.json"), JSON.stringify(ran));
  app.quit();
});
