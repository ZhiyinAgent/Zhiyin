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
import type { ProcessContainment, RunProcess } from "@zhiyin/process-ownership";

/**
 * LaTeX's package cache. Tectonic fetches the packages a document uses and
 * keeps them, then reads what it kept without checking it, so a document
 * that changed a kept package would change every later document.
 *
 * LaTeX may read the cache everyone reads and change none of it. Each compile
 * works on a copy of its own, made of hard links: a link shares the kept
 * file's permissions, so the compile reads every kept package but can change
 * none, and what it adds stays in its copy. The copy's folder is granted to
 * the compile while it is still empty, since granting a folder that holds
 * links would change the permissions of the files they lead to. A package it
 * fetched joins the shared cache by name only, fetched again by Zhiyin in a
 * step that runs no document.
 *
 * The format LaTeX starts from is built by Zhiyin, from a document it writes,
 * into the shared cache: before the first compile that finds none, and again
 * once a compile had to build one the shared cache lacks, as after a new
 * Tectonic or bundle. Building it fetches the packages it is built from in
 * one process, so they are not fetched again one by one.
 */
export type LatexPackages = {
  /**
   * A compile's own folder, granted to it before the copy is made, the shared
   * cache it reads, and its environment. With no format kept, this Tectonic
   * builds one first.
   */
  prepare(
    tectonic: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly folder: string;
    readonly shared: string;
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
async function clearAbandoned(
  runs: string,
  release: (folder: string) => void,
): Promise<void> {
  for (const entry of await readdir(runs).catch(() => [])) {
    const path = join(runs, entry);
    const status = await stat(path).catch(() => undefined);
    if (
      status?.isDirectory() &&
      Date.now() - status.mtimeMs > abandonedAfterMs
    ) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
      release(path);
    }
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

/** The names of the formats kept in a cache. */
async function formatsIn(cache: string): Promise<Set<string>> {
  return new Set(await readdir(join(cache, "formats")).catch(() => []));
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
  /** Grants a compile's own folder to LaTeX, which may change it. */
  readonly grant: (folder: string) => Promise<void>;
  /** Lets go of what granting a compile's folder made, once it is gone. */
  readonly release: (folder: string) => void;
}): LatexPackages {
  const shared = join(options.cache, "packages");
  const runs = join(options.cache, "runs");
  // One change of the shared cache at a time, so two never write it together.
  let changing: Promise<void> = Promise.resolve();
  const serialized = (step: () => Promise<void>): Promise<void> => {
    const next = changing.then(step);
    changing = next.catch(() => undefined);
    return next;
  };

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

  async function buildFormat(tectonic: string, signal?: AbortSignal) {
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

  /** Whether a compile's cache holds a format or a package the shared one lacks. */
  async function holdsNew(folder: string): Promise<boolean> {
    const kept = await formatsIn(shared);
    if (
      [...(await formatsIn(join(folder, "cache")))].some(
        (name) => !kept.has(name),
      )
    )
      return true;
    const before = await keptFiles(shared);
    return [...(await keptFiles(join(folder, "cache")))].some(
      ([bundle, names]) =>
        [...names].some(
          (name) => fileName.test(name) && !before.get(bundle)?.has(name),
        ),
    );
  }

  async function fetchNew(
    folder: string,
    tectonic: string,
    signal?: AbortSignal,
  ) {
    // Tectonic names a format by its bundle and version and uses only the
    // one that matches, so a compile that built one found none of its own.
    const kept = await formatsIn(shared);
    if (
      [...(await formatsIn(join(folder, "cache")))].some(
        (name) => !kept.has(name),
      )
    )
      await buildFormat(tectonic, signal);
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
  }

  return {
    async prepare(tectonic, signal) {
      await mkdir(shared, { recursive: true });
      await mkdir(runs, { recursive: true });
      await clearAbandoned(runs, options.release);
      // A compile that cannot start from it builds its own, as before. With a
      // format kept, a compile does not wait for another's packages to be kept.
      if (!(await formatsIn(shared)).size)
        await serialized(async () => {
          if (!(await formatsIn(shared)).size)
            await buildFormat(tectonic, signal);
        }).catch(() => undefined);
      const folder = await mkdtemp(join(runs, "compile-"));
      try {
        await options.grant(folder);
        await linkTree(shared, join(folder, "cache"));
      } catch (error) {
        await rm(folder, { recursive: true, force: true }).catch(
          () => undefined,
        );
        options.release(folder);
        throw error;
      }
      return {
        folder,
        shared,
        environment: {
          ...process.env,
          TECTONIC_CACHE_DIR: join(folder, "cache"),
        },
      };
    },
    // A compile that fetched nothing new does not wait for another's to be kept.
    async adopt(folder, tectonic, signal) {
      if (await holdsNew(folder))
        await serialized(() => fetchNew(folder, tectonic, signal));
    },
  };
}
