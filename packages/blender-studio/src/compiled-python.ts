/**
 * Blender's own Python, compiled once when Blender is installed.
 *
 * Blender's archive carries its scripts as source, and a Blender compiles
 * what it imports each time it starts unless it can keep the result beside
 * them. Zhiyin's Blender cannot: it runs at low integrity and may not write in
 * its own installation (ADR 0028). So the installation is given its compiled
 * files before any conversation uses it, by the Python that ships inside it.
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  runProcess,
  type ProcessContainment,
  type RunProcess,
} from "@zhiyin/process-ownership";

/** Compiling several thousand files takes seconds; this is for a PC that is busy. */
const compileTimeoutMs = 5 * 60_000;

const notCompiled = "Blender's Python was not compiled.";

/** The versioned folder that holds Blender's scripts and its Python. */
async function pythonHome(home: string): Promise<string | undefined> {
  for (const entry of await readdir(home, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(home, entry.name);
    const python = join(folder, "python", "bin", "python.exe");
    if ((await stat(python).catch(() => undefined))?.isFile()) return folder;
  }
  return undefined;
}

/**
 * Compiles the scripts and the library of the Blender at `executable`, with
 * that Blender's own Python and nothing of the person's. The compiled files
 * name their sources as they will be once Blender is at `installed`, so an
 * error Blender reports later points at a file that exists.
 */
export function compiledBlenderPython(
  options: {
    readonly containment?: ProcessContainment;
    readonly run?: RunProcess;
  } = {},
): (
  program: { readonly executable: string; readonly installed: string },
  signal: AbortSignal,
) => Promise<void> {
  const run = options.run ?? runProcess;
  return async ({ executable, installed }, signal) => {
    const home = dirname(executable);
    const folder = await pythonHome(home);
    if (!folder) throw new Error(notCompiled);
    const result = await run({
      executable: join(folder, "python", "bin", "python.exe"),
      arguments: [
        // Isolated: no variable or folder of the person's changes what runs.
        "-I",
        "-m",
        "compileall",
        "-q",
        // As many at once as the PC has processors.
        "-j",
        "0",
        "-s",
        home,
        "-p",
        dirname(installed),
        join(folder, "scripts"),
        join(folder, "python", "lib"),
      ],
      cwd: home,
      timeoutMs: compileTimeoutMs,
      signal,
      ...(options.containment ? { containment: options.containment } : {}),
    });
    if (result.exitCode !== 0 || result.ending || result.failure)
      throw new Error(notCompiled);
  };
}
