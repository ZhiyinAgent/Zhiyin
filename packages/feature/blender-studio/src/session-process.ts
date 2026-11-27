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
} from "@zhiyin/sandbox";
import type { KeptShaderCaches, Seeding } from "./shader-caches.js";

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
  /** Where the warm-up picture goes; it is removed once drawn. A sealed Blender draws none. */
  readonly warm?: string;
  /**
   * A Blender for one script: it runs that script in the scene file it names,
   * saves the scene and answers nothing else.
   */
  readonly sealed?: true;
  /**
   * A Blender that only finds out whether this PC's graphics card draws: it
   * draws its warm-up picture, says whether it could, and ends.
   */
  readonly probe?: true;
  /**
   * This PC's graphics card cannot draw: Blender draws every picture with
   * Cycles, none with EEVEE or the solid view.
   */
  readonly processor?: true;
};

export type LaunchSession = (
  options: SessionLaunchOptions,
) => Promise<SessionProcess>;

/**
 * What Blender printed over a whole session ends with why it stopped, so its
 * end is kept, and what is left out before it is counted.
 */
const printedTail = 4_000;

async function tail(path: string): Promise<string> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.length > printedTail
    ? `… ${text.length - printedTail} earlier characters left out …\n${text.slice(-printedTail)}`
    : text;
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
  if (await stat(copy).catch(() => undefined)) {
    // Something outside Zhiyin may have deleted or changed files in it: each
    // file not as shipped is copied again, by its size.
    for (const file of files) {
      const [kept, shipped] = await Promise.all([
        stat(join(copy, file)).catch(() => undefined),
        stat(join(source, file)),
      ]);
      if (kept?.size === shipped.size) continue;
      await mkdir(dirname(join(copy, file)), { recursive: true });
      await copyFile(join(source, file), join(copy, file));
    }
    return copy;
  }
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

/** Grants a program its folders: the sandbox's, unless a test stands in. */
type Confine = (confinement: Confinement) => Promise<Confined>;

/** The home a conversation's Blender runs with, in its folder. */
export const sessionHome = (directory: string) => join(directory, "home");

/**
 * Where a conversation's Blender writes a file that goes outside the
 * workspace, for Zhiyin to move into place: its confinement, fixed when it
 * starts, reaches no further.
 */
export const stagingFolder = (directory: string) => join(directory, "staging");

/** Whether a line a starting Blender sent says `field`, as `{"ready": true}`. */
function says(line: string, field: "ready" | "eevee"): boolean {
  try {
    return (JSON.parse(line) as Record<string, unknown>)[field] === true;
  } catch {
    return false;
  }
}

/** How long the Blender that makes a kept shader cache may run. */
const warmUpMs = 180_000;

/**
 * Starts a Blender with `start` in `directory`, a folder new for it, which
 * draws the warm-up picture as a session's start does. Settles once it is
 * ready or has ended, on whether it drew with EEVEE on the graphics card,
 * with a way to end it, which also ends it past its time.
 */
async function drawWarmUp(
  start: LaunchSession,
  executable: string,
  script: string,
  directory: string,
): Promise<{ readonly drew: boolean; end(): Promise<void> }> {
  const workspace = join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const drawing = await start({
    executable,
    script,
    directory,
    workspace,
    warm: join(directory, "previews", "warm.jpg"),
  });
  const timer = setTimeout(() => drawing.end(), warmUpMs);
  const end = async () => {
    clearTimeout(timer);
    drawing.end();
    await drawing.ended;
  };
  for (;;) {
    const line = await drawing.next();
    if (line === undefined) return { drew: false, end };
    if (says(line, "ready")) return { drew: says(line, "eevee"), end };
  }
}

/**
 * Starts Blender headless inside a process container, on its own settings,
 * reached over two pipes. Blender ignores the person's startup file,
 * preferences and add-ons, keeps its settings in Zhiyin's data, and never runs
 * scripts stored in a scene file.
 *
 * It runs confined (ADR 0006): it reads its own installation, a copy
 * of the session script kept in `scripts` and this conversation's folder,
 * changes only its home, caches, previews, pictures, the spec's verdicts, the lines of drawings
 * and the files it writes for outside the workspace there, and the
 * workspace, and has no internet.
 *
 * With `shaderCaches`, a Blender that draws on the graphics card starts in a
 * new container on a copy of the shader cache kept for it; when none is kept,
 * one is made in the background once it has started (ADR 0032).
 */
export function containedSessionLaunch(
  containment: ProcessContainment,
  options: {
    readonly scripts: string;
    readonly confine?: Confine;
    /**
     * Tests only: every Blender behaves as on a PC whose graphics card cannot
     * draw, where drawing on it ends Blender.
     */
    readonly withoutGraphicsCard?: boolean;
    readonly shaderCaches?: KeptShaderCaches;
  },
): LaunchSession {
  const confine = options.confine ?? confineProgram;
  /** A start, given the kept shader cache when `kept` is said. */
  const start = async (
    {
      executable,
      script,
      directory,
      workspace,
      warm,
      sealed,
      probe,
      processor,
    }: SessionLaunchOptions,
    kept: boolean,
  ): Promise<SessionProcess> => {
    await requireReachable(executable);
    const logs = join(directory, "logs");
    await mkdir(logs, { recursive: true });
    // Earlier sessions' logs go; one a running Blender still holds stays until next time.
    for (const old of await readdir(logs))
      await rm(join(logs, old), { force: true }).catch(() => {});
    const name = randomUUID();
    const stdout = join(logs, `${name}.out.txt`);
    const stderr = join(logs, `${name}.err.txt`);
    // Blender reads its settings, scripts and add-ons from these at start.
    // Each start has a folder of its own, new and only read by Blender, so
    // nothing a script leaves runs at a later start; earlier starts' go, and
    // one a running Blender holds stays until next time.
    const settingsFolders = join(directory, "blender-settings");
    await mkdir(settingsFolders, { recursive: true });
    for (const old of await readdir(settingsFolders))
      await rm(join(settingsFolders, old), {
        recursive: true,
        force: true,
      }).catch(() => {});
    const own = join(settingsFolders, name);
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
    const working = [
      ...["previews", "pictures", "spec", "lines"].map((name) =>
        join(directory, name),
      ),
      stagingFolder(directory),
    ];
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
      hosts: [],
    });
    // The container's folder is made as its folders are granted; the copy
    // goes in after, so it takes the container's access, and before Blender
    // starts. A Blender on the processor draws nothing the cache holds, and
    // one that only finds out how this PC draws starts as it would anywhere.
    // The Blender that makes the kept cache starts on none.
    const caches = kept ? options.shaderCaches : undefined;
    const seeding: Seeding | undefined =
      caches && !probe && !processor
        ? await caches
            .seed(sessionHome(directory), executable)
            .catch(() => ({ copied: false }))
        : undefined;
    let toMake = seeding && !seeding.copied ? seeding.missing : undefined;
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
          ...(sealed ? ["--sealed"] : []),
          ...(warm !== undefined ? ["--warm", warm] : []),
          ...(probe ? ["--probe"] : []),
          ...(processor ? ["--processor"] : []),
          ...(options.withoutGraphicsCard ? ["--no-graphics-card"] : []),
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
        const line = read.done ? undefined : read.value;
        // Made once this Blender has started, so it never holds up its start.
        if (caches && toMake !== undefined && line && says(line, "ready")) {
          caches.make(toMake, (folder) =>
            drawWarmUp(
              (options) => start(options, false),
              executable,
              script,
              folder,
            ),
          );
          toMake = undefined;
        }
        return line;
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
  return (options) => start(options, true);
}
