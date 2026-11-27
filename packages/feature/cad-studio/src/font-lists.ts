/**
 * The list of the system's fonts that ezdxf, which build123d loads, reads as
 * it starts, kept for every build's runs. Without it, each run, in a home of
 * its own, lists the fonts again, about 0.3 s of its start.
 *
 * One list is kept for the CAD packages this release ships and the system's
 * fonts folder as it is, named by that folder's time of change, which moves
 * on as a font is added or removed. Only a run started for that alone makes
 * it: isolated, in a folder new for it and removed after, it lists the fonts
 * and runs nothing else, so nothing a conversation ran is ever in it. Zhiyin
 * writes what it listed into the kept folder, which a build's runs may only
 * read. A build that finds no list for the fonts as they are now lists them
 * itself, as before, and a list is made beside it for the builds after.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CadPython } from "./cad-python.js";
import { cadEnvironment } from "./cad-environment.js";

export type KeptFontListsOptions = {
  /** Where the lists are kept, in Zhiyin's data, outside every conversation's folder. */
  readonly directory: string;
  readonly python: CadPython;
  /** The harness the studio runs, `run.py`; the font listing is beside it. */
  readonly harness: string;
  /** The system's fonts folder, which ezdxf lists: Windows' own unless a test sets it. */
  readonly fonts?: string;
  /** What the CAD environment's packages are: its lock's digest unless a test sets it. */
  readonly packages?: string;
};

/** Where ezdxf reads its list, below the folder its cache is in. */
const listFile = join("ezdxf", "font_manager_cache.json");

/** The folder each listing runs in, beside the kept lists. */
const makingFolder = "making";

/** The longest a listing may take. */
const listingMs = 60_000;

/** The largest list kept: ezdxf's for a few hundred fonts is about 40 KB. */
const largestList = 16 * 1024 * 1024;

const removed = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});

/** Whether `text` is a list as ezdxf writes it, holding at least one font. */
function isList(text: string): boolean {
  try {
    const list = JSON.parse(text) as Record<string, unknown>;
    const faces = list["font-faces"];
    return (
      typeof list["version"] === "number" &&
      Array.isArray(faces) &&
      faces.length > 0 &&
      faces.every(
        (face) =>
          Array.isArray(face) &&
          face.length === 5 &&
          typeof face[0] === "string",
      )
    );
  } catch {
    return false;
  }
}

/** The font lists kept for the CAD studio's runs. */
export class KeptFontLists {
  readonly #options: KeptFontListsOptions;
  readonly #packages: string;
  /** The lists whose making has been tried in this run of the app. */
  readonly #tried = new Set<string>();
  #making: Promise<void> = Promise.resolve();
  #cleared = false;

  constructor(options: KeptFontListsOptions) {
    this.#options = options;
    this.#packages =
      options.packages ??
      createHash("sha256")
        .update(JSON.stringify(cadEnvironment.lock))
        .digest("hex")
        .slice(0, 16);
  }

  /**
   * The folder holding the list for the fonts as they are now, for a run to
   * read; or nothing, when none is kept, and then one is made in the
   * background, once in this run of the app.
   */
  async folder(): Promise<string | undefined> {
    const name = await this.#name();
    if (name === undefined) return undefined;
    const folder = join(this.#options.directory, name);
    if ((await stat(join(folder, listFile)).catch(() => undefined))?.isFile())
      return folder;
    this.#make(name);
    return undefined;
  }

  /** Settles once every making asked for so far has ended. */
  settled(): Promise<void> {
    return this.#making;
  }

  /** The list's name: the packages, and the fonts folder's time of change. */
  async #name(): Promise<string | undefined> {
    const fonts =
      this.#options.fonts ??
      join(process.env["SystemRoot"] ?? "C:\\Windows", "Fonts");
    const found = await stat(fonts).catch(() => undefined);
    if (!found?.isDirectory()) return undefined;
    return `${this.#packages}-${Math.trunc(found.mtimeMs)}`;
  }

  #make(name: string): void {
    if (this.#tried.has(name)) return;
    this.#tried.add(name);
    this.#making = this.#making.then(() => this.#list(name).catch(() => {}));
  }

  async #list(name: string): Promise<void> {
    const { directory, python, harness } = this.#options;
    const throwaways = join(directory, makingFolder);
    if (!this.#cleared) {
      this.#cleared = true;
      // What a listing left when the app ended during it.
      for (const left of await readdir(throwaways).catch(() => []))
        await removed(join(throwaways, left));
    }
    // Short, as a container's home must be.
    const folder = join(throwaways, randomUUID().slice(0, 8));
    const out = join(folder, "list");
    const keeping = join(directory, `.keeping-${randomUUID()}`);
    try {
      await mkdir(out, { recursive: true });
      const ran = await python.run({
        // Isolated: nothing of a workspace on its path, nor of its environment.
        arguments: [
          "-I",
          "-X",
          "utf8",
          join(dirname(harness), "font_list.py"),
          out,
        ],
        cwd: out,
        read: [dirname(harness)],
        write: [out],
        home: join(folder, "home"),
        homeLastsOneRun: true,
        timeoutMs: listingMs,
      });
      if (!ran.ok || ran.run.exitCode !== 0) return;
      const listed = join(out, listFile);
      const size = (await stat(listed).catch(() => undefined))?.size;
      if (size === undefined || size > largestList) return;
      const text = await readFile(listed, "utf8");
      if (!isList(text)) return;
      // Written by Zhiyin, in a folder of its own: nothing of the run's
      // folder, nor what it was given to write, comes with the list.
      await mkdir(join(keeping, "ezdxf"), { recursive: true });
      await writeFile(join(keeping, listFile), text, "utf8");
      await rename(keeping, join(directory, name));
      // A list of other packages or of the fonts as they were matches no run.
      for (const entry of await readdir(directory))
        if (entry !== name && entry !== makingFolder)
          await removed(join(directory, entry));
    } finally {
      await removed(keeping);
      await removed(folder);
    }
  }
}
