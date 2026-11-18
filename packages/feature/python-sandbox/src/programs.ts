import {
  windowsEnvironment,
  type ProcessRun as ProgramRun,
} from "@zhiyin/sandbox";

/**
 * Python on Windows reads and writes in the console's code page unless told
 * otherwise, so a script printing "é" or reading a UTF-8 file fails or garbles
 * it. These make UTF-8 its default for files and for what it prints, and
 * Matplotlib draws off screen, since a confined script can open no window. Of
 * Zhiyin's own variables, Python, pip and uv are given only those every
 * confined program is.
 */
export function pythonEnvironment(): Record<string, string | undefined> {
  return {
    ...windowsEnvironment(),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    MPLBACKEND: "Agg",
  };
}

/** The most a script may print, across both streams, before it is stopped. */
export const largestOutput = 64 * 1024 * 1024;

/** A time limit in the words the model reads: "5 minutes", "45 seconds". */
export function duration(timeoutMs: number): string {
  const minutes = timeoutMs / 60_000;
  if (Number.isInteger(minutes))
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const seconds = Math.round(timeoutMs / 1000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * Python warns that it cannot find where its own program lies on every start
 * in a container, which may not look up the drive it is on. It finds its
 * environment all the same, so the warning says nothing about the run.
 */
const containerWarning =
  /^Failed to find real location of [^\r\n]*(?:\r?\n|$)/gm;

/** A run as its program printed it, without the container's warning. */
export function withoutContainerWarning(run: ProgramRun): ProgramRun {
  return {
    ...run,
    stdout: run.stdout.replace(containerWarning, ""),
    stderr: run.stderr.replace(containerWarning, ""),
  };
}

/**
 * What a run printed, as whole as the process layer kept it: its start and its
 * end. What the model is shown of it is bounded where every tool's result is,
 * and the rest kept to read again; a cut here would lose a traceback's end.
 */
export function reported(run: ProgramRun): string {
  const { stdout, stderr } = withoutContainerWarning(run);
  return `${stdout}\n${stderr}`.trim();
}
