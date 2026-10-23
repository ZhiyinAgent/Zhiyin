import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import {
  confine as confineProgram,
  windowsEnvironment,
  type Confined,
  type Confinement,
  type ProcessContainment,
} from "@zhiyin/process-ownership";

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
  /** The workspace this Blender works in, the only folder besides its own it may change. */
  readonly workspace: string;
  /** Where the warm-up picture goes; it is removed once drawn. */
  readonly warm: string;
};

export type LaunchSession = (
  options: SessionLaunchOptions,
) => Promise<SessionProcess>;

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

/** The session script's own files, as the paths below its folder. */
async function scriptFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true });
  const files: string[] = [];
  for (const entry of entries.sort())
    if (
      entry.endsWith(".py") &&
      !entry.split(/[\\/]/).includes("__pycache__") &&
      (await stat(join(folder, entry))).isFile()
    )
      files.push(entry);
  return files;
}

/** Folders of copies this session of the app has cleared of older copies. */
const cleared = new Set<string>();

/**
 * A copy of the session script's folder in `copies`, named by what it holds,
 * so Blender runs a script it may read and not change, wherever the app is
 * installed. Copies of another version are removed the first time a session
 * starts in each session of the app, before any Blender runs one.
 */
async function sessionScriptCopy(
  copies: string,
  script: string,
): Promise<string> {
  const source = dirname(script);
  const files = await scriptFiles(source);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(source, file)));
  }
  const name = hash.digest("hex").slice(0, 32);
  const copy = join(copies, name);
  await mkdir(copies, { recursive: true });
  if (!cleared.has(copies)) {
    cleared.add(copies);
    for (const entry of await readdir(copies))
      if (entry !== name)
        await rm(join(copies, entry), { recursive: true, force: true }).catch(
          () => {},
        );
  }
  if (await stat(copy).catch(() => undefined)) return copy;
  const making = join(copies, `.making-${randomUUID()}`);
  for (const file of files) {
    await mkdir(dirname(join(making, file)), { recursive: true });
    await copyFile(join(source, file), join(making, file));
  }
  // Another start may have made the same copy meanwhile; either is the same.
  await rename(making, copy).catch(async () => {
    await rm(making, { recursive: true, force: true });
  });
  return copy;
}

/** Grants a program its folders: process ownership's, unless a test stands in. */
type Confine = (confinement: Confinement) => Promise<Confined>;

/** The home a conversation's Blender runs with, in its folder. */
export const sessionHome = (directory: string) => join(directory, "home");

/**
 * Starts Blender headless inside a process container, on its own settings,
 * reached over two pipes. Blender ignores the person's startup file,
 * preferences and add-ons, keeps its settings in Zhiyin's data, and never runs
 * scripts stored in a scene file.
 *
 * It runs confined (ADR 0006): it reads its own installation, a copy
 * of the session script kept in `scripts` and this conversation's folder,
 * changes only its home, caches, previews and pictures there and the
 * workspace, and has no internet.
 */
export function containedSessionLaunch(
  containment: ProcessContainment,
  options: { readonly scripts: string; readonly confine?: Confine },
): LaunchSession {
  const confine = options.confine ?? confineProgram;
  return async ({ executable, script, directory, workspace, warm }) => {
    await requireReachable(executable);
    const logs = join(directory, "logs");
    await mkdir(logs, { recursive: true });
    // Earlier sessions' logs go; one a stopped Blender still holds stays until next time.
    for (const old of await readdir(logs))
      await rm(join(logs, old), { force: true }).catch(() => {});
    const name = randomUUID();
    const stdout = join(logs, `${name}.out.txt`);
    const stderr = join(logs, `${name}.err.txt`);
    // Blender reads its settings, scripts and add-ons from these at start.
    // They are emptied before each start and Blender may only read them, so
    // nothing a script leaves runs at a later start.
    const own = join(directory, "blender-settings");
    await rm(own, { recursive: true, force: true });
    const settings = {
      BLENDER_USER_CONFIG: join(own, "config"),
      BLENDER_USER_SCRIPTS: join(own, "scripts"),
      BLENDER_USER_DATAFILES: join(own, "datafiles"),
      BLENDER_USER_EXTENSIONS: join(own, "extensions"),
    };
    for (const folder of Object.values(settings))
      await mkdir(folder, { recursive: true });
    // OptiX would make its cache folder by looking at each folder above it,
    // which a confined Blender may not; without it, OptiX keeps no cache.
    const optixCache = join(directory, "cache", "optix");
    const working = ["previews", "pictures"].map((name) =>
      join(directory, name),
    );
    for (const folder of [optixCache, ...working])
      await mkdir(folder, { recursive: true });
    const copy = await sessionScriptCopy(options.scripts, script);
    const confined = await confine({
      purpose: "blender",
      home: sessionHome(directory),
      // It reads the conversation's folder: its settings are there, and USD
      // packs a file only where it may look at every folder above.
      read: [dirname(executable), copy, directory],
      write: [join(directory, "cache"), ...working, workspace],
      network: false,
    });
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
          join(copy, relative(dirname(script), script)),
          "--",
          "--warm",
          warm,
        ],
        // Its own home: the conversation's folder itself is not Blender's to reach.
        cwd: sessionHome(directory),
        stdout,
        stderr,
        environment: {
          // Of Zhiyin's own variables, only those every confined program
          // has: Blender's own could point it at scripts it runs on start,
          // USD's and MaterialX's at plugins and folders it reads, and a key
          // kept in one would reach a script.
          ...windowsEnvironment(),
          // The render kernels OptiX builds go where Blender may write, or
          // it would build them again for every picture.
          OPTIX_CACHE_PATH: optixCache,
          ...settings,
        },
        pipes: (ends) => ["--pipes", `${ends.reads},${ends.writes}`],
        // A render on the processor can take every core for minutes; below
        // normal priority, it takes only what the person's own work leaves.
        priority: "below-normal",
        confined,
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
