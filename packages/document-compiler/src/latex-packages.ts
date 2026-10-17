import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  openToLowIntegrity,
  type ProcessContainment,
  type RunProcess,
} from "@zhiyin/process-ownership";

/**
 * LaTeX's package cache. Tectonic fetches the packages a document uses and
 * keeps them, then reads what it kept without checking it, so a document
 * that changed a kept package would change every later document.
 *
 * The cache everyone reads stays at the person's own integrity. Each compile
 * runs at low integrity on a copy of its own, made of hard links: a link
 * keeps the file's label, so the compile reads every kept package but can
 * change none, and what it adds stays in its copy. A package it fetched
 * joins the shared cache by name only, fetched again by Zhiyin in a step
 * that runs no document.
 */
export type LatexPackages = {
  /** A compile's own folder, opened to low integrity, and its environment. */
  prepare(): Promise<{
    readonly folder: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
  }>;
  /**
   * Fetches into the shared cache, with this Tectonic, what the compile in
   * `folder` fetched.
   */
  adopt(folder: string, tectonic: string, signal?: AbortSignal): Promise<void>;
};

/** A TeX file's name, as the bundle names its files: never a path or a flag. */
const fileName = /^[A-Za-z0-9][\w.+-]*$/;
/** The most names one compile has fetched for it: the bundle's own are few. */
const mostFetched = 500;
/** Fetches at once: each waits on the network more than on the disk. */
const fetchesAtOnce = 4;
/** A compile that builds the format, which runs only what Zhiyin wrote. */
const formatDocument =
  "\\documentclass{article}\n\\begin{document}\nZhiyin.\n\\end{document}\n";

/** A compile folder this old was left by a run that never finished. */
const abandonedAfterMs = 60 * 60_000;

/** Removes compile folders that runs which never finished left behind. */
async function clearAbandoned(runs: string): Promise<void> {
  for (const entry of await readdir(runs).catch(() => [])) {
    const path = join(runs, entry);
    const status = await stat(path).catch(() => undefined);
    if (status?.isDirectory() && Date.now() - status.mtimeMs > abandonedAfterMs)
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Makes `to` a tree of hard links to the files of `from`. */
async function linkTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true }))
    if (entry.isDirectory())
      await linkTree(join(from, entry.name), join(to, entry.name));
    else await link(join(from, entry.name), join(to, entry.name));
}

/** Each bundle's folder of kept files, and the names in it. */
async function keptFiles(cache: string): Promise<Map<string, Set<string>>> {
  const data = join(cache, "bundles", "data");
  const kept = new Map<string, Set<string>>();
  for (const entry of await readdir(data, { withFileTypes: true }).catch(
    () => [],
  ))
    if (entry.isDirectory())
      kept.set(entry.name, new Set(await readdir(join(data, entry.name))));
  return kept;
}

export function latexPackages(options: {
  readonly cache: string;
  readonly run: RunProcess;
  readonly containment?: ProcessContainment;
}): LatexPackages {
  const shared = join(options.cache, "packages");
  const runs = join(options.cache, "runs");
  // One adoption at a time, so two never write the shared cache together.
  let adopting: Promise<void> = Promise.resolve();

  const trusted = (
    tectonic: string,
    args: readonly string[],
    signal?: AbortSignal,
  ) =>
    options.run({
      executable: tectonic,
      arguments: args,
      cwd: shared,
      timeoutMs: 10 * 60_000,
      environment: { ...process.env, TECTONIC_CACHE_DIR: shared },
      ...(signal ? { signal } : {}),
      ...(options.containment ? { containment: options.containment } : {}),
    });

  async function fetchNew(
    folder: string,
    tectonic: string,
    signal?: AbortSignal,
  ) {
    const before = await keptFiles(shared);
    const fetched = [...(await keptFiles(join(folder, "cache")))].flatMap(
      ([bundle, names]) =>
        [...names].filter(
          (name) => fileName.test(name) && !before.get(bundle)?.has(name),
        ),
    );
    const waiting = [...new Set(fetched)].slice(0, mostFetched);
    await Promise.all(
      Array.from({ length: fetchesAtOnce }, async () => {
        for (let name = waiting.shift(); name; name = waiting.shift())
          await trusted(tectonic, ["-X", "bundle", "cat", name], signal);
      }),
    );
    if ((await readdir(join(shared, "formats")).catch(() => [])).length) return;
    const building = await mkdtemp(join(options.cache, "format-"));
    try {
      const source = join(building, "format.tex");
      await writeFile(source, formatDocument);
      await trusted(
        tectonic,
        ["--untrusted", "--chatter", "minimal", "--outdir", building, source],
        signal,
      );
    } finally {
      await rm(building, { recursive: true, force: true });
    }
  }

  return {
    async prepare() {
      await mkdir(shared, { recursive: true });
      await mkdir(runs, { recursive: true });
      await openToLowIntegrity(runs);
      await clearAbandoned(runs);
      const folder = await mkdtemp(join(runs, "compile-"));
      const temporary = join(folder, "temporary");
      await linkTree(shared, join(folder, "cache"));
      await mkdir(temporary);
      return {
        folder,
        environment: {
          ...process.env,
          TECTONIC_CACHE_DIR: join(folder, "cache"),
          TEMP: temporary,
          TMP: temporary,
        },
      };
    },
    adopt(folder, tectonic, signal) {
      const next = adopting.then(() => fetchNew(folder, tectonic, signal));
      adopting = next.catch(() => undefined);
      return next;
    },
  };
}
