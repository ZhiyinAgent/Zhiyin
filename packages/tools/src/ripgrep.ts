/**
 * The bundled ripgrep, which both searches run on: by content and by name.
 *
 * ripgrep reads ignore files, skips binary files and runs in parallel, so a
 * whole folder is searched, even a synced document folder of tens of
 * thousands of files, and the count it reports is real.
 *
 * Every invocation is an argument list, never a command line, and what the
 * model asked for travels after an option that takes it, or after `--`, so it
 * can never be read as an option of its own.
 */

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { runProcess, type ProcessContainment } from "@zhiyin/process-ownership";

/**
 * Where the bundled ripgrep is, or nothing when this machine's build of it is
 * not installed. A program inside Electron's packed archive cannot be started,
 * so packaging unpacks it beside the archive, and the path follows.
 */
export function bundledRipgrep(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const wrapper = require.resolve("@vscode/ripgrep");
    const binary = createRequire(wrapper).resolve(
      `@vscode/ripgrep-${process.platform}-${process.arch}/bin/${process.platform === "win32" ? "rg.exe" : "rg"}`,
    );
    return binary.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
  } catch {
    return undefined;
  }
}

/**
 * Folders whose contents are machine-generated or private to a tool. Searching
 * them buries the answer rather than finding it, so they are left out even when
 * ignore files are not followed, and the result names them.
 */
export const skippedFolders = [
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "out",
];

/**
 * How ripgrep chooses files: the folder's own ignore files and no others, so a
 * global or parent setting the person never sees cannot hide their files; and
 * neither those nor hidden files when everything was asked for. The skipped
 * folders are left out either way.
 */
export function selection(includeIgnored: boolean): string[] {
  return [
    "--no-require-git",
    "--no-ignore-global",
    "--no-ignore-parent",
    ...(includeIgnored ? ["--no-ignore", "--hidden"] : []),
    ...skippedFolders.flatMap((name) => ["--glob", `!${name}/`]),
  ];
}

export type RipgrepRun = {
  /** False when the run was cut short, so what was read is only part. */
  readonly complete: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  readonly errors: string;
};

/** What a search needs to run ripgrep, supplied by whoever offers it. */
export type RipgrepContext = {
  readonly rg: string;
  readonly containment?: ProcessContainment | undefined;
  /** Bytes printed before a run is cut short; the process default if absent. */
  readonly maximumOutputBytes?: number | undefined;
};

/**
 * Runs ripgrep in `cwd` and hands each line it printed to `line`, in order,
 * once it has ended. A run that takes too long or prints more than a run may is
 * stopped, and what it printed until then is still handed over, except a last
 * line it was stopped in the middle of.
 */
export async function ripgrep(
  options: RipgrepContext & {
    readonly args: readonly string[];
    readonly cwd: string;
    readonly signal?: AbortSignal | undefined;
    readonly line: (text: string) => void;
  },
): Promise<RipgrepRun> {
  const run = await runProcess({
    executable: options.rg,
    arguments: options.args,
    cwd: options.cwd,
    timeoutMs: 60_000,
    maximumOutputCharacters: 20_000,
    ...(options.maximumOutputBytes === undefined
      ? {}
      : { maximumOutputBytes: options.maximumOutputBytes }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.containment ? { containment: options.containment } : {}),
    keep: async (files) => {
      const whole = await endsWithNewline(files.stdout);
      const lines = createInterface({
        input: createReadStream(files.stdout, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      let previous: string | undefined;
      for await (const text of lines) {
        if (previous !== undefined) options.line(previous);
        previous = text;
      }
      if (previous !== undefined && whole) options.line(previous);
    },
  });
  return {
    complete: run.ending === undefined && run.failure === undefined,
    cancelled: run.ending === "stopped",
    exitCode: run.exitCode,
    errors: run.stderr,
  };
}

/** ripgrep ends every line it prints, so a file without an end was cut. */
async function endsWithNewline(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size === 0) return true;
    const last = Buffer.alloc(1);
    await file.read(last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    await file.close();
  }
}

/** Paths compared folder by folder, as a person reads a listing. */
const collator = new Intl.Collator(undefined, { sensitivity: "base" });
export function byPath(left: string, right: string): number {
  const a = left.split("/");
  const b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = collator.compare(a[index]!, b[index]!);
    if (order) return order;
  }
  return a.length - b.length;
}

/** A path as ripgrep printed it, from the folder it was run in. */
export function printedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
