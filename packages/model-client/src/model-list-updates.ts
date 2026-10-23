/**
 * Newer model lists, read from GitHub while the app runs (ADR 0031). A list
 * is taken only when its signature verifies against a key this version ships,
 * it reads in this version's format, and it is newer than the list in force;
 * otherwise the list in force stays. Nothing is sent while updates are off.
 *
 * Each look first asks for the small signature file, which names the version
 * it signs: when that is no newer than the list in force, nothing more is
 * asked. The version it names is only a hint; the list itself must carry the
 * same version, under the signature, to be taken.
 */

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceFile } from "@zhiyin/file-replacement";
import type { ModelListCheck, ModelListState } from "@zhiyin/contract";
import { nodeNetwork, type Network } from "./keyed-fetch.js";
import type { ModelListControl } from "./model-client.js";
import type { ModelList, ModelLists } from "./model-list.js";
import { readModelList, type ModelListFile } from "./model-list-format.js";
import { labPlatforms, shippedModelList } from "./shipped-model-list.js";

/** Where the list Zhiyin reads is published, on the repository's main branch. */
const MODEL_LIST_ADDRESSES = {
  list: "https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/model-client/model-list/models.json",
  signature:
    "https://raw.githubusercontent.com/ZhiyinAgent/Zhiyin/main/packages/model-client/model-list/models.json.sig",
} as const;

/** Larger than any list could honestly be; a bigger answer is not read. */
const LARGEST_LIST = 1_000_000;
const LARGEST_SIGNATURE = 4_096;

/**
 * The signature file: the key that signed, the version signed, and the
 * signature over the list's exact bytes.
 */
type Signature = {
  readonly key: string;
  readonly version: number;
  readonly signature: string;
};

/** A downloaded list as kept on disk: its text and its signature, together. */
type Kept = Signature & { readonly list: string };

/** What a look for a newer list came to; `off` when none was made. */
export type ModelListLook = ModelListCheck | { readonly outcome: "off" };

export type ModelListUpdatesOptions = {
  /** The folder its files are kept in, inside Zhiyin's data folder. */
  readonly directory: string;
  /**
   * The keys a list may be signed with, by key id: Ed25519 public keys,
   * SubjectPublicKeyInfo in DER, base64.
   */
  readonly keys: Readonly<Record<string, string>>;
  /** How it goes online: Chromium's in the app (ADR 0004). */
  readonly network?: Network;
  /** The list this version ships. Replaced in tests. */
  readonly shipped?: ModelListFile;
  /** Where the list and its signature are read. Replaced in tests. */
  readonly addresses?: { readonly list: string; readonly signature: string };
  readonly now?: () => Date;
};

/** Why a newer list was not taken, in words the person can read. */
class NotTaken extends Error {}

function signatureOf(text: string): Signature {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NotTaken("The newer list's signature file is unreadable.");
  }
  const fields = value as Record<string, unknown> | null;
  if (
    typeof fields !== "object" ||
    fields === null ||
    Object.keys(fields).sort().join() !== "key,signature,version" ||
    typeof fields["key"] !== "string" ||
    typeof fields["signature"] !== "string" ||
    typeof fields["version"] !== "number" ||
    !Number.isSafeInteger(fields["version"])
  )
    throw new NotTaken("The newer list's signature file is unreadable.");
  return {
    key: fields["key"],
    version: fields["version"],
    signature: fields["signature"],
  };
}

export class ModelListUpdates implements ModelLists, ModelListControl {
  readonly #directory: string;
  readonly #keys: ReadonlyMap<string, KeyObject>;
  readonly #network: Network;
  readonly #shipped: ModelListFile;
  readonly #addresses: { readonly list: string; readonly signature: string };
  readonly #now: () => Date;
  readonly #listeners: (() => void)[] = [];
  #inForce: ModelListFile;
  #downloaded = false;
  #updates = true;
  #lastCheck: ModelListCheck | undefined;
  /** Reading what was kept on disk, which every look waits for. */
  #loading: Promise<void> | undefined;
  /** The look under way, which a second asks to share. */
  #looking: Promise<ModelListLook> | undefined;
  #writes: Promise<unknown> = Promise.resolve();

  constructor(options: ModelListUpdatesOptions) {
    this.#directory = options.directory;
    this.#keys = new Map(
      Object.entries(options.keys).map(([id, spki]) => {
        const key = createPublicKey({
          key: Buffer.from(spki, "base64"),
          format: "der",
          type: "spki",
        });
        if (key.asymmetricKeyType !== "ed25519")
          throw new Error(`The model list key "${id}" is not an Ed25519 key.`);
        return [id, key] as const;
      }),
    );
    this.#network = options.network ?? nodeNetwork;
    this.#shipped = options.shipped ?? shippedModelList;
    this.#inForce = this.#shipped;
    this.#addresses = options.addresses ?? MODEL_LIST_ADDRESSES;
    this.#now = options.now ?? (() => new Date());
  }

  get #listFile() {
    return join(this.#directory, "downloaded.json");
  }

  get #updatesFile() {
    return join(this.#directory, "updates.json");
  }

  lab(provider: string): ModelList | undefined {
    return this.#inForce.labs[provider];
  }

  state(): ModelListState {
    return {
      source: this.#downloaded ? "downloaded" : "shipped",
      version: this.#inForce.version,
      published: this.#inForce.published,
      updates: this.#updates,
      ...(this.#lastCheck ? { lastCheck: this.#lastCheck } : {}),
    };
  }

  onChanged(listener: () => void): void {
    this.#listeners.push(listener);
  }

  /**
   * Reads what was kept: whether updates are on, and a list downloaded
   * before, verified again and taken only if newer than the shipped one.
   */
  load(): Promise<void> {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  async #load(): Promise<void> {
    const updates = await readFile(this.#updatesFile, "utf8")
      .then((text) => (JSON.parse(text) as { enabled?: unknown }).enabled)
      .catch(() => undefined);
    // On unless the person turned it off.
    this.#updates = updates !== false;
    const kept = await readFile(this.#listFile, "utf8").catch(() => undefined);
    if (kept === undefined) return;
    try {
      const { list, ...signature } = JSON.parse(kept) as Kept;
      if (typeof list !== "string") return;
      const trusted = this.#trusted(
        Buffer.from(list, "utf8"),
        signatureOf(JSON.stringify(signature)),
      );
      if (trusted.version > this.#inForce.version) this.#take(trusted);
    } catch {
      // A kept list that is damaged or no longer verifies is not used; the
      // next look replaces it.
    }
  }

  /**
   * Looks for a newer list unless updates are off. A look under way is
   * shared rather than repeated.
   */
  refresh(): Promise<ModelListLook> {
    this.#looking ??= this.#look().finally(() => {
      this.#looking = undefined;
    });
    return this.#looking;
  }

  async check(): Promise<ModelListState> {
    await this.refresh();
    return this.state();
  }

  async setUpdates(enabled: boolean): Promise<ModelListState> {
    await this.load();
    this.#updates = enabled;
    await this.#write(this.#updatesFile, JSON.stringify({ enabled }));
    return this.state();
  }

  async #look(): Promise<ModelListLook> {
    await this.load();
    if (!this.#updates) return { outcome: "off" };
    let check: ModelListCheck;
    try {
      check = await this.#fetchNewer();
    } catch (error) {
      check = {
        at: this.#now().toISOString(),
        outcome: "failed",
        reason:
          error instanceof NotTaken
            ? error.message
            : "The newer list could not be kept on this computer.",
      };
    }
    this.#lastCheck = check;
    return check;
  }

  async #fetchNewer(): Promise<ModelListCheck> {
    const signatureText = new TextDecoder().decode(
      await this.#get(this.#addresses.signature, LARGEST_SIGNATURE),
    );
    const signature = signatureOf(signatureText);
    if (signature.version <= this.#inForce.version)
      return { at: this.#now().toISOString(), outcome: "unchanged" };
    const bytes = await this.#get(this.#addresses.list, LARGEST_LIST);
    const list = this.#trusted(bytes, signature);
    if (list.version <= this.#inForce.version)
      throw new NotTaken("The newer list is no newer than the one in use.");
    await this.#write(
      this.#listFile,
      JSON.stringify({
        ...signature,
        list: new TextDecoder().decode(bytes),
      } satisfies Kept),
    );
    this.#take(list);
    return { at: this.#now().toISOString(), outcome: "updated" };
  }

  /** The list, if its signature holds and it reads in this version's form. */
  #trusted(bytes: Uint8Array, signature: Signature): ModelListFile {
    const key = this.#keys.get(signature.key);
    if (!key)
      throw new NotTaken(
        "The newer list is signed with a key this version does not know.",
      );
    if (!verify(null, bytes, key, Buffer.from(signature.signature, "base64")))
      throw new NotTaken("The newer list's signature does not match it.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new NotTaken("The newer list is not readable text.");
    }
    const reading = readModelList(parsed, labPlatforms);
    if (!reading.ok)
      throw new NotTaken(`The newer list is unreadable: ${reading.problem}`);
    if (reading.list.version !== signature.version)
      throw new NotTaken(
        "The newer list is not the version its signature names.",
      );
    return reading.list;
  }

  #take(list: ModelListFile): void {
    this.#inForce = list;
    this.#downloaded = true;
    for (const listener of this.#listeners) listener();
  }

  /**
   * One file from GitHub, with nothing of the person's: no cookies, no
   * stored credentials, no query, and no redirect followed.
   */
  async #get(address: string, largest: number): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      const response = await this.#network(address, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new NotTaken(`GitHub answered ${response.status}.`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof NotTaken) throw error;
      throw new NotTaken("GitHub could not be reached.");
    }
    if (bytes.byteLength > largest)
      throw new NotTaken("GitHub answered with more than a list can be.");
    return bytes;
  }

  /** Writes one at a time, each landing whole or not at all. */
  #write(path: string, contents: string): Promise<void> {
    const write = async () => {
      await mkdir(this.#directory, { recursive: true });
      await replaceFile(path, contents);
    };
    const next = this.#writes.then(write, write);
    this.#writes = next.catch(() => undefined);
    return next;
  }
}
