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
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * Folders whose contents are most often machine-generated or private to a
 * tool. Searching them buries the answer rather than finding it, so they are
 * left out, whatever their letter case, unless everything was asked for or
 * the folder searched is one of them; the result names them. `.git` is left
 * out even when everything was asked for, unless it is the folder searched.
 */
const skippedFolders = [
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "out",
];

/** The folders a search of `folder` leaves out. */
function skipped(folder: string, includeIgnored: boolean): string[] {
  const named = new Set(
    folder
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase()),
  );
  return (includeIgnored ? [".git"] : skippedFolders).filter(
    (name) => !named.has(name),
  );
}

/**
 * How ripgrep chooses files in a search of `folder`, a path from the
 * workspace folder, "" for the whole of it: the workspace's own ignore files
 * and no others, so a global or parent setting the person never sees cannot
 * hide their files; and neither those nor hidden files when everything was
 * asked for.
 */
export function selection(includeIgnored: boolean, folder = ""): string[] {
  return [
    "--no-require-git",
    "--no-ignore-global",
    "--no-ignore-parent",
    ...(includeIgnored ? ["--no-ignore", "--hidden"] : []),
    ...skipped(folder, includeIgnored).flatMap((name) => [
      "--iglob",
      `!${name}/`,
    ]),
  ];
}

/** What a search of `folder` says it did not search. */
export function notSearchedIn(
  folder: string,
  includeIgnored: boolean,
): string[] {
  return [
    ...skipped(folder, includeIgnored),
    ...(includeIgnored ? [] : ["files .gitignore lists", "hidden files"]),
  ];
}

/** A folder's name as an ignore file reads it, its own characters only. */
const literal = (name: string) =>
  name.replace(/[\\[\]{}*?!#]/g, (character) => `\\${character}`);

/**
 * Runs a search of `folder` with the workspace's own ignore files above it
 * applied. ripgrep reads the ignore files of the folders it walks through,
 * not of those above where it starts, so the search starts at the workspace
 * folder, and an ignore file of its own keeps it on the way to `folder`.
 * That file ranks below the person's, so a path outside `folder` that one of
 * theirs lets through is left out of what is read: `inside` says which are
 * in it. A hidden folder on the way is let through by that file, which
 * ripgrep reads before it looks at whether a file is hidden.
 */
export async function searchingFolder<T>(
  folder: string,
  includeIgnored: boolean,
  run: (search: {
    readonly args: readonly string[];
    readonly path: string;
    readonly inside: (printed: string) => boolean;
  }) => Promise<T>,
): Promise<T> {
  const args = selection(includeIgnored, folder);
  const segments = folder.split("/").filter(Boolean);
  if (!segments.length || includeIgnored)
    return run({ args, path: folder || ".", inside: () => true });
  const route = segments.flatMap((segment, index) => {
    const above = segments.slice(0, index).map(literal).join("/");
    const at = above ? `/${above}` : "";
    return [`${at}/*`, `!${at}/${literal(segment)}/`];
  });
  const place = await mkdtemp(join(tmpdir(), "zhiyin-search-"));
  try {
    const ignore = join(place, "route.ignore");
    await writeFile(ignore, `${route.join("\n")}\n`, "utf8");
    return await run({
      args: [...args, "--ignore-file", ignore],
      path: ".",
      inside: (printed) =>
        printed === folder || printed.startsWith(`${folder}/`),
    });
  } finally {
    await rm(place, { recursive: true, force: true });
  }
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
