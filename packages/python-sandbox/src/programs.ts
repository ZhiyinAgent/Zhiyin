import {
  windowsEnvironment,
  type ProcessRun as ProgramRun,
} from "@zhiyin/process-ownership";

/**
 * Python on Windows reads and writes in the console's code page unless told
 * otherwise, so a script printing "é" or reading a UTF-8 file fails or garbles
 * it. These make UTF-8 its default for files and for what it prints. Of
 * Zhiyin's own variables, Python, pip and uv are given only those every
 * confined program is.
 */
export function pythonEnvironment(): Record<string, string | undefined> {
  return {
    ...windowsEnvironment(),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

/**
 * Python warns that it cannot find where its own program lies on every start
 * in a container, which may not look up the drive it is on. It finds its
 * environment all the same, so the warning says nothing about the run.
 */
const containerWarning =
  /^Failed to find real location of [^\r\n]*(?:\r?\n|$)/gm;

/**
 * What a run printed, as whole as the process layer kept it: its start and its
 * end. What the model is shown of it is bounded where every tool's result is,
 * and the rest kept to read again; a cut here would lose a traceback's end.
 */
export function reported(run: ProgramRun): string {
  const stdout = run.stdout.replace(containerWarning, "");
  const stderr = run.stderr.replace(containerWarning, "");
  return `${stdout}\n${stderr}`.trim();
}
