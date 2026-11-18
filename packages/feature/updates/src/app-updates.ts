/**
 * Zhiyin updating itself (ADR 0027). A round looks at each place in turn for
 * a release newer than the version running, reads its signature before
 * anything large is downloaded, downloads it, and measures the file against
 * the signature; only then is the update ready. It installs only when the
 * person restarts into it, measured again first. While looking is off,
 * nothing is sent.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import type {
  AppUpdateLook,
  AppUpdatePhase,
  AppUpdateState,
} from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import {
  checkSignature,
  LARGEST_SIGNATURE_FILE,
  NotUsable,
  readReleaseSignature,
  releaseKeysOf,
  type SignedRelease,
} from "./release-signature.js";
import {
  signatureAddress,
  updatePlaces,
  type UpdatePlace,
} from "./update-places.js";
import { compareVersions } from "./versions.js";

/**
 * How the feature goes online: a request in the standard `fetch` shape,
 * handed in by the composition root. In the app it is Chromium's (ADR 0004).
 */
export type Network = (url: string, init: RequestInit) => Promise<Response>;

/**
 * What finds, downloads and starts installers: electron-updater in the app,
 * handed in by the composition root. It decides nothing; every check is here.
 */
export interface UpdateSource {
  /**
   * The release the place offers as newest for this version, if it is
   * newer. Throws when the place cannot be reached or read; a `NotUsable`
   * error's message is shown as it is.
   */
  look(
    place: UpdatePlace,
    signal: AbortSignal,
  ): Promise<SignedRelease | undefined>;
  /**
   * Downloads the installer the last look at that place offered, and
   * answers where it is.
   */
  download(
    place: UpdatePlace,
    release: SignedRelease,
    progress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<string>;
  /** Starts the installer. Zhiyin has shut down before this is called. */
  install(path: string): void;
}

export type AppUpdatesOptions = {
  /** The folder its setting is kept in, inside Zhiyin's data folder. */
  readonly directory: string;
  /** The version running. */
  readonly version: string;
  /**
   * The keys a release may be signed with, by key id: Ed25519 public keys,
   * SubjectPublicKeyInfo in DER, base64.
   */
  readonly keys: Readonly<Record<string, string>>;
  readonly source: UpdateSource;
  readonly network: Network;
  /** Where releases are read, in order. Replaced in tests. */
  readonly places?: readonly UpdatePlace[];
  readonly now?: () => Date;
  /** How long after `start` the first look is made, in milliseconds. */
  readonly firstLookAfter?: number;
  /** How long after one round ends the next starts, in milliseconds. */
  readonly every?: number;
  /** How long a place has to say what it offers, in milliseconds. */
  readonly lookLimit?: number;
  /** How long a download may send nothing before it is given up, in milliseconds. */
  readonly downloadSilence?: number;
};

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;

/** A downloaded installer, measured and held to its signature. */
type Ready = { readonly path: string; readonly release: SignedRelease };

/** The installer's size and SHA-512, base64, read from the file. */
async function measure(
  path: string,
): Promise<{ size: number; sha512: string }> {
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    size += chunk.byteLength;
  }
  return { size, sha512: hash.digest("base64") };
}

/** Holds when the file at the path is the installer the release names. */
async function heldTo(path: string, release: SignedRelease): Promise<void> {
  let measured: { size: number; sha512: string };
  try {
    measured = await measure(path);
  } catch {
    throw new NotUsable("The downloaded update could not be read.");
  }
  if (measured.size !== release.size || measured.sha512 !== release.sha512)
    throw new NotUsable(
      "The downloaded installer is not the one the release's signature names.",
    );
}

function reasonOf(place: UpdatePlace, error: unknown): string {
  return error instanceof NotUsable
    ? `${place.name}: ${error.message}`
    : `${place.name} could not be reached.`;
}

export class AppUpdates {
  readonly #directory: string;
  readonly #version: string;
  readonly #keys: ReturnType<typeof releaseKeysOf>;
  readonly #source: UpdateSource;
  readonly #network: Network;
  readonly #places: readonly UpdatePlace[];
  readonly #now: () => Date;
  readonly #firstLookAfter: number;
  readonly #every: number;
  readonly #lookLimit: number;
  readonly #downloadSilence: number;
  readonly #listeners = new Set<(state: AppUpdateState) => void>();
  #checks = true;
  #phase: AppUpdatePhase = { kind: "idle" };
  #lastLook: AppUpdateLook | undefined;
  #ready: Ready | undefined;
  #loading: Promise<void> | undefined;
  /** The round under way, which a second asks to share. */
  #round: Promise<void> | undefined;
  #controller: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #stopped = false;
  readonly #writes = new Serial();

  constructor(options: AppUpdatesOptions) {
    this.#directory = options.directory;
    this.#version = options.version;
    this.#keys = releaseKeysOf(options.keys);
    this.#source = options.source;
    this.#network = options.network;
    this.#places = options.places ?? updatePlaces;
    this.#now = options.now ?? (() => new Date());
    this.#firstLookAfter = options.firstLookAfter ?? 10 * SECOND;
    this.#every = options.every ?? 6 * HOUR;
    this.#lookLimit = options.lookLimit ?? 60 * SECOND;
    this.#downloadSilence = options.downloadSilence ?? 60 * SECOND;
  }

  get #settingFile() {
    return join(this.#directory, "updates.json");
  }

  state(): AppUpdateState {
    return {
      version: this.#version,
      checks: this.#checks,
      phase: this.#phase,
      ...(this.#lastLook ? { lastLook: this.#lastLook } : {}),
    };
  }

  onChanged(listener: (state: AppUpdateState) => void): void {
    this.#listeners.add(listener);
  }

  /**
   * Reads whether looking is on, on unless the person turned it off, and
   * whether an update started at the last restart did not install, which
   * the state then says once.
   */
  load(): Promise<void> {
    this.#loading ??= readFile(this.#settingFile, "utf8")
      .then(
        (text) =>
          JSON.parse(text) as { checks?: unknown; installing?: unknown },
      )
      .catch(() => ({}) as { checks?: unknown; installing?: unknown })
      .then(async ({ checks, installing }) => {
        this.#checks = checks !== false;
        if (typeof installing !== "string") return;
        if (compareVersions(installing, this.#version) > 0)
          this.#lastLook = {
            at: this.#now().toISOString(),
            outcome: "failed",
            reason: `The update to version ${installing} did not install.`,
          };
        await this.#write(JSON.stringify({ checks: this.#checks })).catch(
          () => undefined,
        );
      });
    return this.#loading;
  }

  /** Looks a little after now, then again after each round ends. */
  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#schedule(this.#firstLookAfter);
  }

  /**
   * Ends what is under way and makes no more looks. An update already
   * downloaded stays ready to install.
   */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
  }

  /**
   * Looks now, unless looking is off, and answers once the look has ended:
   * with nothing newer, nothing usable, or a download under way.
   */
  async check(): Promise<AppUpdateState> {
    await this.load();
    // A download under way is not waited for.
    if (this.#round && this.#phase.kind !== "looking") return this.state();
    const round = this.#startRound();
    await new Promise<void>((settled) => {
      const watch = (state: AppUpdateState) => {
        if (state.phase.kind !== "looking") done();
      };
      const done = () => {
        this.#listeners.delete(watch);
        settled();
      };
      this.#listeners.add(watch);
      void round.then(done, done);
    });
    return this.state();
  }

  async setChecks(enabled: boolean): Promise<AppUpdateState> {
    await this.load();
    this.#checks = enabled;
    await this.#write(JSON.stringify({ checks: enabled }));
    if (!enabled) this.#controller?.abort();
    this.#changed();
    if (enabled) void this.#startRound();
    return this.state();
  }

  /**
   * Measures the downloaded installer once more, and holds the update for
   * installing. Throws, saying why, when there is nothing it can install.
   */
  async prepareRestart(): Promise<void> {
    const ready = this.#ready;
    if (!ready || this.#phase.kind !== "ready")
      throw new NotUsable("No update is ready to install.");
    try {
      await heldTo(ready.path, ready.release);
    } catch (error) {
      this.#ready = undefined;
      this.#set({ kind: "idle" });
      throw error;
    }
    this.#set({ kind: "restarting", version: ready.release.version });
  }

  /**
   * Starts the installer once Zhiyin has shut down, measured again first,
   * since it was last measured before the shutdown.
   */
  async install(): Promise<void> {
    const ready = this.#ready;
    if (!ready || this.#phase.kind !== "restarting")
      throw new NotUsable("No update is being installed.");
    await heldTo(ready.path, ready.release);
    // Kept so the next start can say when the installer failed or was cancelled.
    await this.#write(
      JSON.stringify({
        checks: this.#checks,
        installing: ready.release.version,
      }),
    );
    this.#source.install(ready.path);
  }

  #schedule(after: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#startRound().finally(() => this.#schedule(this.#every));
    }, after);
  }

  #startRound(): Promise<void> {
    this.#round ??= this.#run().finally(() => {
      this.#round = undefined;
    });
    return this.#round;
  }

  async #run(): Promise<void> {
    await this.load();
    const busy =
      this.#phase.kind === "downloading" || this.#phase.kind === "restarting";
    if (!this.#checks || this.#stopped || busy) return;
    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    const settled: AppUpdatePhase = this.#ready
      ? { kind: "ready", version: this.#ready.release.version }
      : { kind: "idle" };
    const newest = this.#ready?.release.version ?? this.#version;
    this.#set({ kind: "looking" });
    const reasons: string[] = [];
    try {
      for (const place of this.#places) {
        if (signal.aborted) return;
        let release: SignedRelease;
        try {
          // A place that does not answer in time passes the look on.
          const offered = await this.#source.look(
            place,
            AbortSignal.any([signal, AbortSignal.timeout(this.#lookLimit)]),
          );
          if (!offered || compareVersions(offered.version, newest) <= 0) {
            // A release refused at an earlier place is still newer: saying
            // there is none would not be true.
            this.#ended(
              reasons.length
                ? { outcome: "failed", reason: reasons.join(" ") }
                : { outcome: "current" },
              settled,
            );
            return;
          }
          await this.#signatureFor(place, offered, signal);
          release = offered;
        } catch (error) {
          if (signal.aborted) return;
          reasons.push(reasonOf(place, error));
          continue;
        }
        this.#lastLook = {
          at: this.#now().toISOString(),
          outcome: "found",
          version: release.version,
        };
        this.#set({ kind: "downloading", version: release.version });
        // A download that sends nothing for a while is given up, and the next place tried.
        const quiet = new AbortController();
        let silence = setTimeout(() => quiet.abort(), this.#downloadSilence);
        const heard = () => {
          clearTimeout(silence);
          silence = setTimeout(() => quiet.abort(), this.#downloadSilence);
        };
        try {
          const path = await this.#source.download(
            place,
            release,
            (fraction) => {
              heard();
              this.#progress(release.version, fraction);
            },
            AbortSignal.any([signal, quiet.signal]),
          );
          clearTimeout(silence);
          await heldTo(path, release);
          this.#ready = { path, release };
          this.#set({ kind: "ready", version: release.version });
          return;
        } catch (error) {
          if (signal.aborted) return;
          reasons.push(
            quiet.signal.aborted
              ? `${place.name}: the download stopped sending.`
              : error instanceof NotUsable
                ? `${place.name}: ${error.message}`
                : `${place.name}: the download did not finish.`,
          );
        } finally {
          clearTimeout(silence);
        }
      }
      this.#ended({ outcome: "failed", reason: reasons.join(" ") }, settled);
    } finally {
      if (this.#controller === controller) this.#controller = undefined;
      if (signal.aborted && this.#phase.kind !== "ready") this.#set(settled);
    }
  }

  /** Reads and checks the signature beside the installer offered. */
  async #signatureFor(
    place: UpdatePlace,
    offered: SignedRelease,
    signal: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.#network(signatureAddress(place, offered), {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        // GitHub sends a release's files on from another host.
        redirect: "follow",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30 * SECOND)]),
      });
    } catch {
      throw new NotUsable("its release's signature could not be read.");
    }
    if (response.status === 404)
      throw new NotUsable(`${offered.version} has no signature.`);
    if (!response.ok)
      throw new NotUsable(
        `it answered ${response.status} for the release's signature.`,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > LARGEST_SIGNATURE_FILE)
      throw new NotUsable("The release's signature is unreadable.");
    const signature = readReleaseSignature(new TextDecoder().decode(bytes));
    checkSignature(signature, offered, this.#version, this.#keys);
  }

  #ended(
    look: { outcome: "current" } | { outcome: "failed"; reason: string },
    settled: AppUpdatePhase,
  ): void {
    this.#lastLook = { at: this.#now().toISOString(), ...look };
    this.#set(settled);
  }

  #progress(version: string, fraction: number): void {
    const current = this.#phase;
    if (current.kind !== "downloading" || current.version !== version) return;
    const rounded = Math.floor(Math.min(Math.max(fraction, 0), 1) * 100) / 100;
    if (current.fraction === rounded) return;
    this.#set({ kind: "downloading", version, fraction: rounded });
  }

  #set(phase: AppUpdatePhase): void {
    this.#phase = phase;
    this.#changed();
  }

  #changed(): void {
    const state = this.state();
    for (const listener of [...this.#listeners]) listener(state);
  }

  /** Writes one at a time, each landing whole or not at all. */
  #write(contents: string): Promise<void> {
    return this.#writes.run(async () => {
      await mkdir(this.#directory, { recursive: true });
      await replaceFile(this.#settingFile, contents);
    });
  }
}
