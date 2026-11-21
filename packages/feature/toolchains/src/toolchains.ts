import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { ToolchainState } from "@zhiyin/contract";
import { realStaysInside } from "@zhiyin/workspace-containment";
import { nodeNetwork, type Network } from "./network.js";

/**
 * One place a pinned program is downloaded from. A copy elsewhere may be
 * packed otherwise, so each place has its own fingerprint, size and path.
 */
export type ToolchainSource = {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  /** The program's path inside the archive, with forward slashes. */
  readonly executable: string;
  /**
   * Where the download comes from, as a person would recognise it, then each
   * host the address sends the download on to.
   */
  readonly hosts: readonly string[];
};

/** One pinned release of one program. */
export type ToolchainSpec = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Tried in this order until one gives the pinned file. */
  readonly sources: readonly ToolchainSource[];
};

/**
 * How long a download may wait: for its site to answer and send the first
 * bytes, and between two arrivals once it has begun. A slow download goes on;
 * one that stops arriving is given up, for the next place.
 */
export type DownloadLimits = {
  readonly answerMs: number;
  readonly stallMs: number;
};

/** Chosen, not measured: long enough for a slow link, short enough to move on. */
const defaultLimits: DownloadLimits = { answerMs: 30_000, stallMs: 30_000 };

export interface Toolchains {
  state(id: string): Promise<ToolchainState>;
  install(id: string, signal?: AbortSignal): Promise<void>;
  /** The installed program, or nothing when it is not installed. */
  executable(id: string): Promise<string | undefined>;
}

/** Streams a download. Replaceable so tests never reach the network. */
export type Download = (
  url: string,
  signal: AbortSignal,
) => Promise<AsyncIterable<Uint8Array>>;

/**
 * Makes an unpacked program ready to use, once, before it is moved into
 * place: `executable` is where the program is now, `installed` where it
 * will be. What it writes beside the program is installed with it.
 */
export type Ready = (
  program: { readonly executable: string; readonly installed: string },
  signal: AbortSignal,
) => Promise<void>;

/** Unpacks a zip archive into an empty directory. */
export type Unpack = (archive: string, destination: string) => Promise<void>;

/** A download over `network`, following the redirects release sites send. */
function downloadOver(network: Network): Download {
  return async (url, signal) => {
    let response: Response;
    try {
      response = await network(url, { signal, redirect: "follow" });
    } catch (error) {
      // Before any of it arrived, the site was not reached.
      const code = chromiumCode(error);
      if (!code) throw error;
      throw new Error(
        code.startsWith("ERR_CERT_")
          ? "The download site's certificate is not trusted on this computer."
          : "The download could not be reached. Check the internet connection.",
        { cause: error },
      );
    }
    if (!response.ok || !response.body)
      throw new Error(`The download failed (HTTP ${response.status}).`);
    return response.body;
  };
}

/** The same download over Node's own `fetch`, for scripts run outside the app. */
export const fetchDownload: Download = downloadOver(nodeNetwork);

/**
 * Windows ships bsdtar, which reads zip archives and by default refuses entry
 * paths that are absolute or climb out with `..`. It is reached by its full
 * path so nothing earlier on `PATH` can stand in for it.
 */
export const windowsTarUnpack: Unpack = (archive, destination) =>
  new Promise((resolveUnpack, reject) => {
    const tar = join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "tar.exe",
    );
    const child = spawn(tar, ["-xf", archive, "-C", destination], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolveUnpack()
        : reject(new Error(errors.trim() || `tar exited with ${code}.`)),
    );
  });

/**
 * What an install keeps beside the program: the version, and the place it
 * came from, named by its address and known by its fingerprint.
 */
type Marker = {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  readonly url?: string;
};

/** One place failed to give the pinned file; the next may. */
class SourceFailed extends Error {}

/**
 * Waits for `step` no longer than `ms`, nor past the attempt being stopped.
 * When the time is up, the attempt is stopped and the wait fails at once,
 * whether or not the step heeds it.
 */
async function within<T>(
  step: Promise<T>,
  ms: number,
  attempt: AbortController,
  reason: string,
): Promise<T> {
  // A step given up on may still fail later, which nothing waits for then.
  step.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = () => {};
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const failure = new SourceFailed(reason);
      reject(failure);
      attempt.abort(failure);
    }, ms);
    stopped = () => reject(attempt.signal.reason);
    if (attempt.signal.aborted) stopped();
    else attempt.signal.addEventListener("abort", stopped, { once: true });
  });
  try {
    return await Promise.race([step, late]);
  } finally {
    clearTimeout(timer);
    attempt.signal.removeEventListener("abort", stopped);
  }
}

/** Refuses an unpacked tree holding links or anything outside its root. */
async function assertPlainTree(root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const status = await lstat(path);
      if (status.isSymbolicLink())
        throw new Error("The archive contains a link, which is not allowed.");
      if (!realStaysInside(canonicalRoot, await realpath(path)))
        throw new Error("The archive reaches outside its folder.");
      if (status.isDirectory()) await visit(path);
    }
  };
  await visit(canonicalRoot);
}

/** How Chromium's network fails (ADR 0004): an error named for its code. */
function chromiumCode(error: unknown): string | undefined {
  return error instanceof Error
    ? /^net::(ERR_[A-Z0-9_]+)$/.exec(error.message)?.[1]
    : undefined;
}

function describe(error: unknown): string {
  if (error instanceof SourceFailed) return error.message;
  if (error instanceof Error && error.name === "AbortError")
    return "The installation was stopped.";
  // Chromium's network failing once the download had begun.
  if (chromiumCode(error))
    return "The download was interrupted. Check the internet connection, then try again.";
  return error instanceof Error && error.message
    ? error.message
    : "The program could not be installed.";
}

export class DownloadedToolchains implements Toolchains {
  readonly #root: string;
  readonly #specs: ReadonlyMap<string, ToolchainSpec>;
  readonly #download: Download;
  readonly #unpack: Unpack;
  readonly #ready: Readonly<Record<string, Ready>>;
  readonly #limits: DownloadLimits;
  readonly #installing = new Map<string, Promise<void>>();
  /** What stops each install under way. */
  readonly #stoppedBy = new Map<string, AbortSignal | undefined>();
  /** How many bytes of each download under way have arrived, of how many. */
  readonly #received = new Map<
    string,
    { readonly received: number; readonly bytes: number }
  >();
  readonly #failures = new Map<string, string>();
  /**
   * What installs cut short by Zhiyin closing left, cleared once before this
   * run's first install begins, so no install of this run is under way.
   */
  #leftovers: Promise<void> | undefined;

  constructor(options: {
    readonly directory: string;
    readonly specs: readonly ToolchainSpec[];
    /**
     * How downloads go online: Chromium's in the app (ADR 0004), Node's own
     * `fetch` when absent.
     */
    readonly network?: Network;
    /** The download itself, in place of `network`. Replaced in tests. */
    readonly download?: Download;
    readonly unpack?: Unpack;
    /** By program id: what readies each one, where its owner has something to. */
    readonly ready?: Readonly<Record<string, Ready>>;
    /** How long a download may wait; shortened in tests. */
    readonly limits?: DownloadLimits;
  }) {
    this.#root = join(options.directory, "toolchains");
    this.#specs = new Map(options.specs.map((spec) => [spec.id, spec]));
    this.#download =
      options.download ?? downloadOver(options.network ?? nodeNetwork);
    this.#unpack = options.unpack ?? windowsTarUnpack;
    this.#ready = options.ready ?? {};
    this.#limits = options.limits ?? defaultLimits;
  }

  async state(id: string): Promise<ToolchainState> {
    const spec = this.#spec(id);
    if (this.#installing.has(id)) {
      const progress = this.#received.get(id);
      return {
        status: "installing",
        received: progress?.received ?? 0,
        bytes: progress?.bytes ?? (spec.sources[0]?.bytes as number),
      };
    }
    if (await this.executable(id)) return { status: "ready" };
    const failure = this.#failures.get(id);
    if (failure) return { status: "failed", reason: failure };
    return {
      status: "missing",
      downloads: [
        {
          name: spec.name,
          version: spec.version,
          bytes: Math.max(...spec.sources.map((source) => source.bytes)),
          sources: [...new Set(spec.sources.flatMap((source) => source.hosts))],
        },
      ],
    };
  }

  async executable(id: string): Promise<string | undefined> {
    const spec = this.#spec(id);
    const directory = this.#installed(spec);
    try {
      const marker = JSON.parse(
        await readFile(join(directory, "installed.json"), "utf8"),
      ) as Marker;
      // The place it came from, known by the file it gave.
      const source = spec.sources.find(
        (candidate) => candidate.sha256 === marker.sha256,
      );
      if (marker.version !== spec.version || !source) return undefined;
      const program = join(directory, "files", ...source.executable.split("/"));
      return (await lstat(program)).isFile() ? program : undefined;
    } catch {
      return undefined;
    }
  }

  install(id: string, signal?: AbortSignal): Promise<void> {
    const spec = this.#spec(id);
    const running = this.#installing.get(id);
    // One being stopped is not joined: this one starts once it has ended.
    if (running && this.#stoppedBy.get(id)?.aborted)
      return running.then(
        () => this.install(id, signal),
        () => this.install(id, signal),
      );
    if (running) return running;
    const installation = this.#install(spec, signal)
      .then(() => {
        this.#failures.delete(id);
      })
      .catch((error: unknown) => {
        // Stopped on purpose is not a failure: it is offered as before.
        if (signal?.aborted) this.#failures.delete(id);
        else this.#failures.set(id, describe(error));
        throw error;
      })
      .finally(() => {
        this.#installing.delete(id);
        this.#stoppedBy.delete(id);
        this.#received.delete(id);
      });
    this.#installing.set(id, installation);
    this.#stoppedBy.set(id, signal);
    return installation;
  }

  async #install(spec: ToolchainSpec, signal?: AbortSignal): Promise<void> {
    if (await this.executable(spec.id)) return;
    await (this.#leftovers ??= rm(join(this.#root, ".staging"), {
      recursive: true,
      force: true,
    }).catch(() => {}));
    // Short, so the longest path in a large archive stays within Windows'
    // 260-character limit where long paths are not enabled.
    const staging = join(this.#root, ".staging", randomUUID().slice(0, 8));
    await mkdir(staging, { recursive: true });
    const stopped = signal ?? new AbortController().signal;
    try {
      const archive = join(staging, "download.zip");
      const source = await this.#fetchFromAny(spec, archive, stopped);
      const files = join(staging, "files");
      await mkdir(files);
      await this.#unpack(archive, files);
      await assertPlainTree(files);
      const inside = source.executable.split("/");
      const program = join(files, ...inside);
      if (!(await lstat(program).catch(() => undefined))?.isFile())
        throw new Error(`The download does not contain ${spec.name}.`);
      await rm(archive);
      const target = this.#installed(spec);
      // The program works without it, so a readying that fails costs only
      // what it would have saved; one that was stopped stops the install.
      await this.#ready
        [spec.id]?.(
          { executable: program, installed: join(target, "files", ...inside) },
          stopped,
        )
        .catch(() => {});
      stopped.throwIfAborted();
      await writeFile(
        join(staging, "installed.json"),
        JSON.stringify({
          id: spec.id,
          version: spec.version,
          sha256: source.sha256,
          url: source.url,
        } satisfies Marker),
        "utf8",
      );
      await rm(target, { recursive: true, force: true });
      await mkdir(join(this.#root, spec.id), { recursive: true });
      await rename(staging, target);
      await this.#removeOtherVersions(spec);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Downloads from each place in turn until one gives the pinned file, and
   * answers which. Only a place's own failure moves on: a stop asked for, or
   * a write that fails, such as on a full disk, ends the install.
   */
  async #fetchFromAny(
    spec: ToolchainSpec,
    destination: string,
    signal: AbortSignal,
  ): Promise<ToolchainSource> {
    const failures: { readonly from: string; readonly reason: string }[] = [];
    for (const source of spec.sources) {
      try {
        await this.#fetchFrom(spec, source, destination, signal);
        return source;
      } catch (error) {
        if (signal.aborted || !(error instanceof SourceFailed)) throw error;
        failures.push({
          from: source.hosts[0] ?? source.url,
          reason: error.message,
        });
      }
    }
    throw new SourceFailed(
      failures.length === 1
        ? (failures[0] as { reason: string }).reason
        : `${spec.name} could not be downloaded from any of the places it comes from. ${failures
            .map(({ from, reason }) => `${from}: ${reason}`)
            .join(" ")}`,
    );
  }

  async #fetchFrom(
    spec: ToolchainSpec,
    source: ToolchainSource,
    destination: string,
    signal: AbortSignal,
  ): Promise<void> {
    // This place's own attempt, stopped by the person's stop or a time limit.
    const attempt = new AbortController();
    const stop = () => attempt.abort(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    const { answerMs, stallMs } = this.#limits;
    const unanswered = "The download site did not answer in time.";
    /** A failure of this place, unless it is the person's stop. */
    const failed = (error: unknown) =>
      error instanceof SourceFailed || signal.aborted
        ? error
        : new SourceFailed(describe(error), { cause: error });
    const hash = createHash("sha256");
    const progress = this.#received;
    let received = 0;
    progress.set(spec.id, { received, bytes: source.bytes });
    try {
      let chunks: AsyncIterable<Uint8Array>;
      try {
        chunks = await within(
          this.#download(source.url, attempt.signal),
          answerMs,
          attempt,
          unanswered,
        );
      } catch (error) {
        throw failed(error);
      }
      const iterator = chunks[Symbol.asyncIterator]();
      async function* arriving() {
        try {
          // The first bytes are waited for as the answer is; then each next.
          for (let first = true; ; first = false) {
            let next: IteratorResult<Uint8Array>;
            try {
              next = await within(
                iterator.next(),
                first ? answerMs : stallMs,
                attempt,
                first ? unanswered : "The download stopped arriving.",
              );
            } catch (error) {
              throw failed(error);
            }
            if (next.done) return;
            signal.throwIfAborted();
            received += next.value.byteLength;
            progress.set(spec.id, { received, bytes: source.bytes });
            if (received > source.bytes)
              throw new SourceFailed(
                `The download of ${spec.name} is larger than expected.`,
              );
            hash.update(next.value);
            yield next.value;
          }
        } finally {
          // Not waited for: a download that stopped arriving may never end.
          void iterator.return?.().catch(() => {});
        }
      }
      await pipeline(arriving(), createWriteStream(destination));
      signal.throwIfAborted();
      if (received !== source.bytes || hash.digest("hex") !== source.sha256)
        throw new SourceFailed(
          `The download of ${spec.name} did not match its published fingerprint, so it was discarded.`,
        );
    } finally {
      signal.removeEventListener("abort", stop);
      attempt.abort();
    }
  }

  async #removeOtherVersions(spec: ToolchainSpec): Promise<void> {
    const directory = join(this.#root, spec.id);
    for (const entry of await readdir(directory))
      if (entry !== spec.version)
        await rm(join(directory, entry), { recursive: true, force: true });
  }

  #installed(spec: ToolchainSpec): string {
    return join(this.#root, spec.id, spec.version);
  }

  #spec(id: string): ToolchainSpec {
    const spec = this.#specs.get(id);
    if (!spec) throw new Error(`No program “${id}” is known.`);
    return spec;
  }
}

/** GitHub sends each release download on to this host. */
const githubAssets = "release-assets.githubusercontent.com";

/** Zhiyin's unchanged copy of a release file, on its own host. */
function zhiyinCopy(
  id: string,
  version: string,
  original: ToolchainSource,
): ToolchainSource {
  const file = decodeURIComponent(
    new URL(original.url).pathname.split("/").at(-1) as string,
  );
  return {
    ...original,
    url: `https://media.zhiyinagent.app/toolchains/${id}/${version}/${file}`,
    hosts: ["media.zhiyinagent.app"],
  };
}

const typst: ToolchainSource = {
  url: "https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-pc-windows-msvc.zip",
  sha256: "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736",
  bytes: 22463684,
  executable: "typst-x86_64-pc-windows-msvc/typst.exe",
  hosts: ["github.com/typst/typst", githubAssets],
};

const tectonic: ToolchainSource = {
  url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip",
  sha256: "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
  bytes: 21060223,
  executable: "tectonic.exe",
  hosts: ["github.com/tectonic-typesetting/tectonic", githubAssets],
};

/**
 * The pinned releases this build installs, each first from its own project:
 * the project's GitHub release, or Blender's own download site. Versions,
 * sizes and digests are those each project publishes with its release. When
 * the project's site cannot be reached, as from many networks in mainland
 * China, the same release comes from a mirror: Tsinghua University's for
 * Blender, and for uv Astral's own wheel of it on Tsinghua's copy of the
 * Python Package Index, which holds the same uv.exe; Zhiyin's own unchanged
 * copies for Typst and Tectonic, which no large mirror in China keeps. A
 * mirror is trusted by the fingerprint pinned here, never by its host
 * (ADR 0027).
 */
export const pinnedToolchains: readonly ToolchainSpec[] = [
  {
    id: "typst",
    name: "Typst",
    version: "0.15.1",
    sources: [typst, zhiyinCopy("typst", "0.15.1", typst)],
  },
  {
    id: "tectonic",
    name: "Tectonic",
    version: "0.17.0",
    sources: [tectonic, zhiyinCopy("tectonic", "0.17.0", tectonic)],
  },
  {
    id: "blender",
    name: "Blender",
    version: "5.2.2",
    sources: [
      {
        url: "https://download.blender.org/release/Blender5.2/blender-5.2.2-windows-x64.zip",
        sha256:
          "3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535",
        bytes: 404453484,
        executable: "blender-5.2.2-windows-x64/blender.exe",
        hosts: ["download.blender.org"],
      },
      {
        url: "https://mirrors.tuna.tsinghua.edu.cn/blender/release/Blender5.2/blender-5.2.2-windows-x64.zip",
        sha256:
          "3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535",
        bytes: 404453484,
        executable: "blender-5.2.2-windows-x64/blender.exe",
        hosts: ["mirrors.tuna.tsinghua.edu.cn"],
      },
    ],
  },
  {
    id: "uv",
    name: "uv",
    version: "0.12.15",
    sources: [
      {
        url: "https://github.com/astral-sh/uv/releases/download/0.12.15/uv-x86_64-pc-windows-msvc.zip",
        sha256:
          "477bd99a84e34891f2bd4c9152ddeb74e971accccbc59c0f0301f11f08a32d46",
        bytes: 17578593,
        executable: "uv.exe",
        hosts: ["github.com/astral-sh/uv", githubAssets],
      },
      {
        url: "https://pypi.tuna.tsinghua.edu.cn/packages/ac/d8/0b4fdfb56c79a307237295f8a0f7c64a34d5d1e8c090fab0bc1201cab2a8/uv-0.12.15-py3-none-win_amd64.whl",
        sha256:
          "39af7d437b6d1f962f11c0b77f891d302ea675a0ebbcfe9792f633d843740a25",
        bytes: 17674023,
        executable: "uv-0.12.15.data/scripts/uv.exe",
        hosts: ["pypi.tuna.tsinghua.edu.cn"],
      },
    ],
  },
  {
    // The Node and npm sealed-off commands run (ADR 0029): the current LTS,
    // by the digest in the release's SHASUMS256.txt.
    id: "node",
    name: "Node.js",
    version: "26.13.1",
    sources: [
      {
        url: "https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip",
        sha256:
          "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7",
        bytes: 41166246,
        executable: "node-v26.13.1-win-x64/node.exe",
        hosts: ["nodejs.org"],
      },
      {
        url: "https://cdn.npmmirror.com/binaries/node/v26.13.1/node-v26.13.1-win-x64.zip",
        sha256:
          "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7",
        bytes: 41166246,
        executable: "node-v26.13.1-win-x64/node.exe",
        hosts: ["cdn.npmmirror.com"],
      },
    ],
  },
];
