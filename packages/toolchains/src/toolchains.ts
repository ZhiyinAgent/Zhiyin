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
import type { ToolchainState } from "@zhiyin/contract";
import { staysInside } from "@zhiyin/workspace-containment";

/** One pinned release of one program. */
export type ToolchainSpec = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Where the download comes from, as a person would recognise it. */
  readonly source: string;
  /** The program's path inside the archive, with forward slashes. */
  readonly executable: string;
};

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

/** Unpacks a zip archive into an empty directory. */
export type Unpack = (archive: string, destination: string) => Promise<void>;

export const fetchDownload: Download = async (url, signal) => {
  const response = await fetch(url, { signal, redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`The download failed (HTTP ${response.status}).`);
  return response.body;
};

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

type Marker = {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
};

/** Refuses an unpacked tree holding links or anything outside its root. */
async function assertPlainTree(root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const status = await lstat(path);
      if (status.isSymbolicLink())
        throw new Error("The archive contains a link, which is not allowed.");
      if (!staysInside(canonicalRoot, await realpath(path)))
        throw new Error("The archive reaches outside its folder.");
      if (status.isDirectory()) await visit(path);
    }
  };
  await visit(canonicalRoot);
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError")
    return "The installation was stopped.";
  return error instanceof Error && error.message
    ? error.message
    : "The program could not be installed.";
}

export class DownloadedToolchains implements Toolchains {
  readonly #root: string;
  readonly #specs: ReadonlyMap<string, ToolchainSpec>;
  readonly #download: Download;
  readonly #unpack: Unpack;
  readonly #installing = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, string>();

  constructor(options: {
    readonly directory: string;
    readonly specs: readonly ToolchainSpec[];
    readonly download?: Download;
    readonly unpack?: Unpack;
  }) {
    this.#root = join(options.directory, "toolchains");
    this.#specs = new Map(options.specs.map((spec) => [spec.id, spec]));
    this.#download = options.download ?? fetchDownload;
    this.#unpack = options.unpack ?? windowsTarUnpack;
  }

  async state(id: string): Promise<ToolchainState> {
    const spec = this.#spec(id);
    if (this.#installing.has(id)) return { status: "installing" };
    if (await this.executable(id)) return { status: "ready" };
    const failure = this.#failures.get(id);
    if (failure) return { status: "failed", reason: failure };
    return {
      status: "missing",
      downloads: [
        {
          name: spec.name,
          version: spec.version,
          bytes: spec.bytes,
          source: spec.source,
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
      if (marker.version !== spec.version || marker.sha256 !== spec.sha256)
        return undefined;
      const program = join(directory, "files", ...spec.executable.split("/"));
      return (await lstat(program)).isFile() ? program : undefined;
    } catch {
      return undefined;
    }
  }

  install(id: string, signal?: AbortSignal): Promise<void> {
    const spec = this.#spec(id);
    const running = this.#installing.get(id);
    if (running) return running;
    const installation = this.#install(spec, signal)
      .then(() => {
        this.#failures.delete(id);
      })
      .catch((error: unknown) => {
        this.#failures.set(id, describe(error));
        throw error;
      })
      .finally(() => {
        this.#installing.delete(id);
      });
    this.#installing.set(id, installation);
    return installation;
  }

  async #install(spec: ToolchainSpec, signal?: AbortSignal): Promise<void> {
    if (await this.executable(spec.id)) return;
    const staging = join(this.#root, ".staging", randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      const archive = join(staging, "download.zip");
      await this.#fetchVerified(
        spec,
        archive,
        signal ?? new AbortController().signal,
      );
      const files = join(staging, "files");
      await mkdir(files);
      await this.#unpack(archive, files);
      await assertPlainTree(files);
      const program = join(files, ...spec.executable.split("/"));
      if (!(await lstat(program).catch(() => undefined))?.isFile())
        throw new Error(`The download does not contain ${spec.name}.`);
      await rm(archive);
      await writeFile(
        join(staging, "installed.json"),
        JSON.stringify({
          id: spec.id,
          version: spec.version,
          sha256: spec.sha256,
        } satisfies Marker),
        "utf8",
      );
      const target = this.#installed(spec);
      await rm(target, { recursive: true, force: true });
      await mkdir(join(this.#root, spec.id), { recursive: true });
      await rename(staging, target);
      await this.#removeOtherVersions(spec);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async #fetchVerified(
    spec: ToolchainSpec,
    destination: string,
    signal: AbortSignal,
  ): Promise<void> {
    const hash = createHash("sha256");
    let received = 0;
    const file = createWriteStream(destination);
    try {
      for await (const chunk of await this.#download(spec.url, signal)) {
        signal.throwIfAborted();
        received += chunk.byteLength;
        if (received > spec.bytes)
          throw new Error(
            `The download of ${spec.name} is larger than expected.`,
          );
        hash.update(chunk);
        if (!file.write(chunk))
          await new Promise<void>((drained) => file.once("drain", drained));
      }
    } finally {
      await new Promise<void>((closed) => file.end(closed));
    }
    signal.throwIfAborted();
    if (received !== spec.bytes || hash.digest("hex") !== spec.sha256)
      throw new Error(
        `The download of ${spec.name} did not match its published fingerprint, so it was discarded.`,
      );
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

/**
 * The pinned releases this build installs. Versions, sizes, and digests are
 * those each project publishes on its GitHub release.
 */
export const pinnedToolchains: readonly ToolchainSpec[] = [
  {
    id: "typst",
    name: "Typst",
    version: "0.15.1",
    url: "https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-pc-windows-msvc.zip",
    sha256: "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736",
    bytes: 22463684,
    source: "github.com/typst/typst",
    executable: "typst-x86_64-pc-windows-msvc/typst.exe",
  },
  {
    id: "tectonic",
    name: "Tectonic",
    version: "0.17.0",
    url: "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip",
    sha256: "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
    bytes: 21060223,
    source: "github.com/tectonic-typesetting/tectonic",
    executable: "tectonic.exe",
  },
  {
    id: "uv",
    name: "uv",
    version: "0.12.15",
    url: "https://github.com/astral-sh/uv/releases/download/0.12.15/uv-x86_64-pc-windows-msvc.zip",
    sha256: "477bd99a84e34891f2bd4c9152ddeb74e971accccbc59c0f0301f11f08a32d46",
    bytes: 17578593,
    source: "github.com/astral-sh/uv",
    executable: "uv.exe",
  },
];
