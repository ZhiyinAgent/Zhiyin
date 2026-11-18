/**
 * An app that hangs as a broken build can: it opens a window, starts a
 * program of its own, and never quits when asked to.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { app, BrowserWindow } from "electron";

app.on("before-quit", (event) => event.preventDefault());
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  await new BrowserWindow({ show: false }).loadURL("about:blank");
  const program = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore" },
  );
  writeFileSync(process.env["ZHIYIN_TEST_PROGRAM_FILE"], String(program.pid));
});
