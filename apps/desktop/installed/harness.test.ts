/**
 * The harness every installed test starts the app through. An app that hangs
 * must not outlive its test: one left running per test turns a broken build
 * into hours of waiting and a computer full of processes.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { closeEverything, launch, temporaryDataDirectory } from "./launch.js";

afterEach(() => closeEverything());

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it(
  "ends an app that does not close, with the programs it started",
  { timeout: 60_000 },
  async () => {
    const dataDirectory = await temporaryDataDirectory();
    const programFile = join(dataDirectory, "program.pid");
    const { app, close } = await launch({
      dataDirectory,
      main: fileURLToPath(
        new URL("fixtures/never-closes.mjs", import.meta.url),
      ),
      environment: { ZHIYIN_TEST_PROGRAM_FILE: programFile },
    });
    const main = app.process().pid!;
    await expect
      .poll(() => readFile(programFile, "utf8").catch(() => ""))
      .not.toBe("");
    const program = Number(await readFile(programFile, "utf8"));
    expect([running(main), running(program)]).toEqual([true, true]);

    await close();

    await expect
      .poll(() => [running(main), running(program)], { timeout: 10_000 })
      .toEqual([false, false]);
  },
);
