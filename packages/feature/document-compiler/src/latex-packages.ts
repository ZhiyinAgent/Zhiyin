import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import type { ProcessContainment, RunProcess } from "@zhiyin/sandbox";
import { clearAbandoned } from "./abandoned-folders.js";

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
  /** What a compile is given to read the bundle in use: none for Tectonic's own. */
  bundleArguments(): readonly string[];
  /**
   * Moves to Zhiyin's copy of the bundle when what Tectonic printed says its
   * own server could not be reached, and answers whether it did, so the
   * compile is run again from the copy. Later compiles start from it.
   */
  fallBack(output: string): boolean;
};

/**
 * Zhiyin's unchanged copy of the bundle Tectonic 0.17.0 reads by default,
 * which its own address sends on to: `relay.fullyjustified.net`'s
 * `default_bundle_v33.tar` is `data1b.fullyjustified.net`'s
 * `tlextras-2022.0r0.tar`. Tectonic reads its index at the same address with
 * `.index.gz` added, and keeps what it reads under the bundle's own digest,
 * so files from the copy and from the original are one cache (ADR 0027).
 * Tectonic checks no fingerprint of what it reads; the size and SHA-256 here
 * are what the scripts that upload and check the copy hold it to.
 */
export const tectonicBundleCopy = {
  url: "https://media.zhiyinagent.app/toolchains/tectonic-bundle/2022.0r0/tlextras-2022.0r0.tar",
  original: "https://data1b.fullyjustified.net/tlextras-2022.0r0.tar",
  bytes: 2_881_562_112,
  sha256: "425685e124746c15ba9bb8e0596bdaad98fce886afa347fbcf9ec0e9acd7fe79",
  index: {
    bytes: 1_276_215,
    sha256: "979a52178eb353c803dde1f66efe43ff7ae2ab908000323d4fef29e98e382ebd",
  },
} as const;

/** How Tectonic 0.17.0 says its bundle's server did not answer. */
const bundleUnreachable =
  /from network \(\d+\/\d+\)|couldn't get it from the internet|please check your network connection/;

/** A TeX file's name, as the bundle names its files: never a path or a flag. */
const fileName = /^[A-Za-z0-9][\w.+-]*$/;
/** The most names one compile has fetched for it: the bundle's own are few. */
const mostFetched = 500;
/** Fetches at once: each waits on the network more than on the disk. */
const fetchesAtOnce = 4;
/** A compile that builds the format, which runs only what Zhiyin wrote. */
const formatDocument =
  "\\documentclass{article}\n\\begin{document}\nZhiyin.\n\\end{document}\n";

/**
 * Makes `to` a tree of hard links to the files of `from`, which a compile
 * reads and may not change, except the record of when each bundle was last
 * checked: Tectonic writes it again when it checks, so each compile has a
 * copy of its own.
 */
async function linkTree(from: string, to: string, within = ""): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const path = within ? `${within}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      await linkTree(join(from, entry.name), join(to, entry.name), path);
    else if (within === "bundles/hashes")
      await copyFile(join(from, entry.name), join(to, entry.name));
    else await link(join(from, entry.name), join(to, entry.name));
  }
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
  /** The copy of the bundle read when Tectonic's own server cannot be. */
  readonly bundleCopy?: string;
}): LatexPackages {
  const shared = join(options.cache, "packages");
  const runs = join(options.cache, "runs");
  const copy = options.bundleCopy ?? tectonicBundleCopy.url;
  /** Once Tectonic's own server could not be reached, until Zhiyin closes. */
  let fromCopy = false;
  /**
   * Fetching a file by name takes no bundle argument in Tectonic 0.17.0: it
   * reads the bundle a `Tectonic.toml` in its working folder names, and
   * otherwise its own. It looks in that folder and each one above, so the
   * file is kept beside the shared cache, never above it.
   */
  const copySettings = join(options.cache, "bundle-copy");
  const bundleSettings = async () => {
    await mkdir(copySettings, { recursive: true });
    await writeFile(
      join(copySettings, "Tectonic.toml"),
      `[doc]\nname = "zhiyin"\nbundle = ${JSON.stringify(copy)}\n\n[[output]]\nname = "default"\ntype = "pdf"\n`,
    );
    return copySettings;
  };
  // One change of the shared cache at a time, so two never write it together.
  const changing = new Serial();
  const serialized = (step: () => Promise<void>): Promise<void> =>
    changing.run(step);

  const trusted = (
    tectonic: string,
    args: readonly string[],
    signal?: AbortSignal,
    cwd = shared,
  ) =>
    options.run({
      executable: tectonic,
      arguments: args,
      cwd,
      timeoutMs: 10 * 60_000,
      environment: { ...process.env, TECTONIC_CACHE_DIR: shared },
      ...(signal ? { signal } : {}),
      ...(options.containment ? { containment: options.containment } : {}),
    });

  const bundleArguments = () => (fromCopy ? ["--bundle", copy] : []);
  const fallBack = (output: string) => {
    if (fromCopy || !bundleUnreachable.test(output)) return false;
    fromCopy = true;
    return true;
  };

  async function buildFormat(tectonic: string, signal?: AbortSignal) {
    const building = await mkdtemp(join(options.cache, "format-"));
    try {
      const source = join(building, "format.tex");
      await writeFile(source, formatDocument);
      const build = () =>
        trusted(
          tectonic,
          [
            ...bundleArguments(),
            "--untrusted",
            "--chatter",
            "minimal",
            "--outdir",
            building,
            source,
          ],
          signal,
        );
      const built = await build();
      if (fallBack(`${built.stdout}\n${built.stderr}`)) await build();
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
    const from = fromCopy ? await bundleSettings() : shared;
    await Promise.all(
      Array.from({ length: fetchesAtOnce }, async () => {
        for (let name = waiting.shift(); name; name = waiting.shift())
          await trusted(tectonic, ["-X", "bundle", "cat", name], signal, from);
      }),
    );
  }

  return {
    async prepare(tectonic, signal) {
      await mkdir(shared, { recursive: true });
      await mkdir(runs, { recursive: true });
      // Every folder there is a compile's.
      await clearAbandoned(runs, () => true, options.release);
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
    bundleArguments,
    fallBack,
  };
}
