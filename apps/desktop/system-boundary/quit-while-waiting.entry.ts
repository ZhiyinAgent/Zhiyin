/**
 * An Electron main process that quits as Zhiyin does while it waits for the
 * processes it started: eight contained processes that would run for good,
 * each waited on, then `app.quit()`. Their pids are written beside the folder
 * it is given.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { openProcessContainer } from "@zhiyin/process-ownership";

const directory = process.argv.at(-1) ?? "";

void app.whenReady().then(() => {
  const container = openProcessContainer();
  const running = Array.from({ length: 8 }, (_, index) =>
    container.launch({
      executable: process.execPath,
      arguments: ["-e", "setInterval(() => {}, 1000)"],
      cwd: directory,
      stdout: join(directory, `stdout-${index}.txt`),
      stderr: join(directory, `stderr-${index}.txt`),
      environment: { ELECTRON_RUN_AS_NODE: "1" },
    }),
  );
  for (const child of running) void child.wait();
  writeFileSync(
    join(directory, "running.json"),
    JSON.stringify(running.map((child) => child.pid)),
  );
  app.quit();
});
