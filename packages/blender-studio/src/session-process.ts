import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ProcessContainment } from "@zhiyin/process-ownership";

/** A running Blender session, as the scene sees it: lines in, lines out. */
export type SessionProcess = {
  send(line: string): void;
  /** The next line the session answered, or nothing once it has ended. */
  next(): Promise<string | undefined>;
  /** Settles when the process has ended, however it ended. */
  readonly ended: Promise<void>;
  /** Ends the process and everything it started. */
  end(): void;
  /** The end of what it printed, to say why it stopped. */
  printed(): Promise<string>;
};

export type SessionLaunchOptions = {
  readonly executable: string;
  /** The session script Blender runs. */
  readonly script: string;
  /** This conversation's folder in the app's data. */
  readonly directory: string;
  /** Where the warm-up picture goes; it is removed once drawn. */
  readonly warm: string;
};

export type LaunchSession = (
  options: SessionLaunchOptions,
) => Promise<SessionProcess>;

/**
 * Opens a folder, with all it holds and will hold, to the contained Blender,
 * which may write nowhere else. Throws when the folder cannot be opened.
 */
export type OpenFolder = (folder: string) => Promise<void>;

const printedTail = 4_000;

async function tail(path: string): Promise<string> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.length > printedTail ? `…${text.slice(-printedTail)}` : text;
}

/**
 * The longest path Blender can open. It is not marked as able to use long
 * paths, so Windows' long-path setting does not reach it, and it finds its
 * own scripts, fonts and render kernels beside its executable.
 */
const longestPathBlenderOpens = 259;

const deepestFiles = new Map<string, Promise<number>>();

/** The length of the longest path among the files in Blender's folder. */
function deepestFile(folder: string): Promise<number> {
  let found = deepestFiles.get(folder);
  if (!found) {
    found = readdir(folder, { recursive: true }).then((entries) =>
      Math.max(0, ...entries.map((entry) => join(folder, entry).length)),
    );
    deepestFiles.set(folder, found);
  }
  return found;
}

/**
 * Refuses a Blender installed so deep that some of its own files lie past
 * the paths it can open: it would start, then fail to load them.
 */
async function requireReachable(executable: string): Promise<void> {
  const folder = dirname(executable);
  const deepest = await deepestFile(folder).catch(() => 0);
  if (deepest > longestPathBlenderOpens)
    throw new Error(
      `Blender cannot run from ${folder}: some of its own files there have paths of ${deepest} characters, longer than the ${longestPathBlenderOpens + 1} characters Blender can open.`,
    );
}

/** What Zhiyin sets for Blender itself, whatever its own environment holds. */
const set = ["TEMP", "TMP", "OPTIX_CACHE_PATH"];

/**
 * Starts Blender headless inside a process container, on its own settings,
 * reached over two pipes. Blender ignores the person's startup file,
 * preferences and add-ons, keeps its settings in Zhiyin's data, and never runs
 * scripts stored in a scene file.
 *
 * It runs at low integrity (ADR 0028): it reads what the person can read, and
 * Windows refuses it every write outside the folders opened to it, which are
 * this conversation's own folder and the workspace.
 */
export function containedSessionLaunch(
  containment: ProcessContainment,
  open: OpenFolder,
): LaunchSession {
  return async ({ executable, script, directory, warm }) => {
    await requireReachable(executable);
    const logs = join(directory, "logs");
    await mkdir(logs, { recursive: true });
    // Earlier sessions' logs go; one a stopped Blender still holds stays until next time.
    for (const old of await readdir(logs))
      await rm(join(logs, old), { force: true }).catch(() => {});
    const name = randomUUID();
    const stdout = join(logs, `${name}.out.txt`);
    const stderr = join(logs, `${name}.err.txt`);
    const own = join(directory, "blender-settings");
    const temporary = join(directory, "temp");
    // What an earlier session left there goes.
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    await mkdir(temporary, { recursive: true });
    await open(directory);
    const container = containment.open();
    let child;
    try {
      child = container.launch({
        executable,
        arguments: [
          "--background",
          "--factory-startup",
          "--disable-autoexec",
          "--quiet",
          "--python",
          script,
          "--",
          "--warm",
          warm,
        ],
        cwd: directory,
        stdout,
        stderr,
        environment: {
          // Blender's own variables can point it at scripts it runs on
          // start, and USD's at plugins it loads and folders it reads
          // models from; only the ones Zhiyin sets reach it.
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) =>
                !name.toUpperCase().startsWith("BLENDER_") &&
                !name.toUpperCase().startsWith("PXR_") &&
                !set.includes(name.toUpperCase()),
            ),
          ),
          // What Blender and its graphics driver keep goes where Blender
          // may write: temporary files, and the render kernels OptiX builds,
          // which it would otherwise build again for every picture.
          TEMP: temporary,
          TMP: temporary,
          OPTIX_CACHE_PATH: join(directory, "cache", "optix"),
          BLENDER_USER_CONFIG: join(own, "config"),
          BLENDER_USER_SCRIPTS: join(own, "scripts"),
          BLENDER_USER_DATAFILES: join(own, "datafiles"),
          BLENDER_USER_EXTENSIONS: join(own, "extensions"),
        },
        pipes: (ends) => ["--pipes", `${ends.reads},${ends.writes}`],
        // A render on the processor can take every core for minutes; below
        // normal priority, it takes only what the person's own work leaves.
        priority: "below-normal",
        integrity: "low",
      });
    } catch (error) {
      container.close();
      throw error;
    }
    const pipes = child.pipes;
    if (!pipes) {
      container.close();
      throw new Error("Blender was started without its pipes.");
    }
    const lines = createInterface({
      input: pipes.fromProcess,
      crlfDelay: Infinity,
    })[Symbol.asyncIterator]();
    const ended = child.wait().then(
      () => undefined,
      () => undefined,
    );
    void ended.then(() => container.close());
    pipes.toProcess.on("error", () => {});
    return {
      send: (line) => {
        pipes.toProcess.write(`${line}\n`);
      },
      next: async () => {
        const read = await lines.next().catch(() => ({
          done: true as const,
          value: undefined,
        }));
        return read.done ? undefined : read.value;
      },
      ended,
      end: () => container.close(),
      printed: async () =>
        [await tail(stderr), await tail(stdout)]
          .map((text) => text.trim())
          .filter(Boolean)
          .join("\n"),
    };
  };
}

/** Whether opening a folder would open a whole drive, or the person's whole user folder. */
function tooWide(folder: string): boolean {
  if (parse(folder).root === folder) return true;
  const home = relative(folder, homedir());
  return home === "" || (!home.startsWith("..") && !isAbsolute(home));
}

/**
 * Lets the contained Blender write in a workspace, opening each once. It
 * answers nothing when the folder is open, or why Windows would not open it:
 * some places take no such mark and need none, so the work goes on, and the
 * reason is said if a write then fails. A whole drive, or a folder that holds
 * the person's user folder, is refused: opening it would open all of it.
 */
export function workspaceOpening(
  open: OpenFolder,
): (workspace: string) => Promise<string | undefined> {
  const opened = new Set<string>();
  return async (workspace) => {
    const folder = resolve(workspace);
    if (opened.has(folder)) return undefined;
    if (tooWide(folder))
      throw new Error(
        `Blender writes only in a folder Zhiyin opens to it, and Zhiyin opens neither a whole drive nor a whole user folder. Choose a folder inside ${folder} as the workspace.`,
      );
    try {
      await open(folder);
    } catch (error) {
      return `Zhiyin could not let Blender write in ${folder}: ${error instanceof Error ? error.message : String(error)}`;
    }
    opened.add(folder);
    return undefined;
  };
}
