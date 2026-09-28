/**
 * What a conversation keeps beside itself rather than inside it: the pictures
 * its tools and connectors produced, the long texts a person pasted, and the
 * full output a tool answered with when only part of it was sent.
 *
 * One folder per kind, each with its own limits, so one kind filling up never
 * removes another's items: screenshots arriving by the dozen must not push out
 * something a person pasted. Inside each, one folder per conversation, so a
 * deleted conversation takes its items with it. What a person pasted has no age
 * limit, only a size limit: it is their material, not a tool's by-product.
 *
 * An item removed to stay inside a limit leaves a small note in its place, so
 * whatever refers to it can say why it is gone instead of showing a gap.
 */

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { MessageAttachment } from "@zhiyin/contract";
import { isRecord } from "./saved-values.js";
import { folderName } from "./history-store.js";

export type KeptKind =
  "toolPictures" | "connectorPictures" | "pastedText" | "output";

export type KeptLimits = {
  /** The largest one item may be. A larger one is not kept at all. */
  readonly itemBytes: number;
  /** The whole folder. The oldest items go first when this is exceeded. */
  readonly totalBytes: number;
  /** How long an item is kept however much room there is; absent, for ever. */
  readonly maximumAgeMs?: number;
};

const mib = 1024 * 1024;
const days = (count: number) => count * 24 * 60 * 60 * 1000;

export const defaultKeptLimits: Readonly<Record<KeptKind, KeptLimits>> = {
  toolPictures: {
    itemBytes: 12 * mib,
    totalBytes: 128 * mib,
    maximumAgeMs: days(30),
  },
  connectorPictures: {
    itemBytes: 12 * mib,
    totalBytes: 64 * mib,
    maximumAgeMs: days(30),
  },
  pastedText: { itemBytes: 50 * mib, totalBytes: 256 * mib },
  output: {
    itemBytes: 50 * mib,
    totalBytes: 256 * mib,
    maximumAgeMs: days(30),
  },
};

const folders: Readonly<Record<KeptKind, string>> = {
  toolPictures: "tool-pictures",
  connectorPictures: "connector-pictures",
  pastedText: "pasted-text",
  output: "output",
};

type Reasons = {
  readonly evicted: string;
  readonly oversize: string;
  readonly unknown: string;
};

const reasons: Readonly<Record<KeptKind, Reasons>> = {
  toolPictures: {
    evicted: "This screenshot was deleted to save disk space.",
    oversize: "This screenshot was too large to keep.",
    unknown: "This picture is no longer stored with the conversation.",
  },
  connectorPictures: {
    evicted: "This picture was deleted to save disk space.",
    oversize: "This picture was too large to keep.",
    unknown: "This picture is no longer stored with the conversation.",
  },
  pastedText: {
    evicted: "This pasted text was deleted to save disk space.",
    oversize: "This pasted text is larger than 50 MB, so it was not kept.",
    unknown: "This pasted text is no longer stored with the conversation.",
  },
  output: {
    evicted: "This saved output was deleted to save disk space.",
    oversize: "This output was too large to keep.",
    unknown: "This output is no longer stored with the conversation.",
  },
};

/** Pastes made before their conversation exists wait here until it does. */
const drafts = "drafts";
const removedSuffix = ".removed";
/** Generated here, never taken from a model or a server, so no id names a path. */
const itemId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

type Removal = { readonly reason: string; readonly at: string };

export type KeptSource = { readonly text: string } | { readonly file: string };

export type KeptItem =
  | { readonly status: "kept"; readonly id: string; readonly bytes: number }
  | {
      readonly status: "refused";
      readonly id: string;
      readonly reason: string;
    };

export type LocatedItem =
  | { readonly status: "ready"; readonly path: string; readonly bytes: number }
  | { readonly status: "missing"; readonly reason: string };

/** When a file was last read for a conversation, as it was then. */
export type FileRead = {
  readonly modifiedMs: number;
  readonly size: number;
  readonly readAt: string;
  readonly digest?: string;
  readonly ranges?: readonly {
    readonly first: number;
    readonly last: number;
  }[];
  readonly totalLines?: number;
  readonly whole?: boolean;
};

/** Lines as a reader numbers them: a final line needs no line break. */
async function lineCount(path: string): Promise<number> {
  let breaks = 0;
  let last: number | undefined;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    for (const byte of chunk) if (byte === 0x0a) breaks += 1;
    last = chunk.at(-1);
  }
  return last === undefined || last === 0x0a ? breaks : breaks + 1;
}

function validId(id: string): boolean {
  return itemId.test(id) && !id.endsWith(removedSuffix);
}

/** `pasted-2026-09-23-140512.txt`: a paste has no name, so it is named by when. */
function pasteName(now: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `pasted-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.txt`;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export class KeptItems {
  readonly #root: string;
  readonly #limits: Readonly<Record<KeptKind, KeptLimits>>;
  readonly #now: () => Date;

  constructor(
    root: string,
    limits: Partial<Record<KeptKind, Partial<KeptLimits>>>,
    now: () => Date,
  ) {
    this.#root = root;
    this.#limits = Object.fromEntries(
      (Object.keys(defaultKeptLimits) as KeptKind[]).map((kind) => [
        kind,
        { ...defaultKeptLimits[kind], ...limits[kind] },
      ]),
    ) as Record<KeptKind, KeptLimits>;
    this.#now = now;
  }

  #folder(kind: KeptKind, conversationId: string | undefined): string {
    return join(
      this.#root,
      folders[kind],
      conversationId === undefined ? drafts : folderName(conversationId),
    );
  }

  /**
   * An item named on its own, as a picture is named by the record that shows
   * it: the kind, the conversation and the item, as `tool-pictures/c-…/<id>`.
   */
  source(kind: KeptKind, conversationId: string, id: string): string {
    return `${folders[kind]}/${folderName(conversationId)}/${id}`;
  }

  /** The item a source names, or why it is not there. */
  async locateSource(
    source: string,
    fallback: KeptKind,
  ): Promise<LocatedItem & { readonly kind: KeptKind }> {
    const [folder, owner, id, ...rest] = source.split("/");
    const kind = (Object.keys(folders) as KeptKind[]).find(
      (candidate) => folders[candidate] === folder,
    );
    if (
      !kind ||
      rest.length ||
      !owner ||
      !/^[ch]-[A-Za-z0-9_-]{1,64}$/.test(owner) ||
      !id ||
      !validId(id)
    )
      return {
        status: "missing",
        reason: reasons[fallback].unknown,
        kind: fallback,
      };
    const path = join(this.#root, folders[kind], owner, id);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile())
      return { status: "ready", path, bytes: info.size, kind };
    return {
      status: "missing",
      reason: await this.#removalReason(kind, path),
      kind,
    };
  }

  /**
   * Keeps one item for a conversation, or as a draft paste when the
   * conversation does not exist yet. An item past its kind's per-item limit is
   * refused whole rather than kept and then removed: one oversized item must
   * not push out everything kept before it.
   */
  async keep(
    kind: KeptKind,
    conversationId: string | undefined,
    source: KeptSource,
  ): Promise<KeptItem> {
    const folder = this.#folder(kind, conversationId);
    await mkdir(folder, { recursive: true });
    const id = await this.#freshId(kind, folder);
    const bytes =
      "text" in source
        ? Buffer.byteLength(source.text, "utf8")
        : (await stat(source.file)).size;
    if (bytes > this.#limits[kind].itemBytes) {
      await this.#noteRemoval(join(folder, id), reasons[kind].oversize);
      return { status: "refused", id, reason: reasons[kind].oversize };
    }
    if ("text" in source)
      await writeFile(join(folder, id), source.text, "utf8");
    else await copyFile(source.file, join(folder, id));
    // After the write, so the item just kept is never the one removed to make
    // room for itself.
    await this.#cleanup(kind, join(folder, id));
    return { status: "kept", id, bytes };
  }

  async #freshId(kind: KeptKind, folder: string): Promise<string> {
    if (kind !== "pastedText") return randomUUID();
    const base = pasteName(this.#now());
    for (let suffix = 1; ; suffix += 1) {
      const id = suffix === 1 ? base : base.replace(/\.txt$/, `-${suffix}.txt`);
      if (
        !(await exists(join(folder, id))) &&
        !(await exists(join(folder, `${id}${removedSuffix}`)))
      )
        return id;
    }
  }

  /** Where an item is, or why it is not there — never a guess. */
  async locate(
    kind: KeptKind,
    conversationId: string | undefined,
    id: string,
  ): Promise<LocatedItem> {
    if (!validId(id))
      return { status: "missing", reason: reasons[kind].unknown };
    const path = join(this.#folder(kind, conversationId), id);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) return { status: "ready", path, bytes: info.size };
    return { status: "missing", reason: await this.#removalReason(kind, path) };
  }

  /**
   * Moves draft pastes into the conversation their message was sent in. A
   * name already taken there is kept apart with a suffix, and the answer says
   * what each paste is called now, how large it is and how many lines it has.
   * A paste already in this conversation, from a message rewound and sent
   * again, stays where it is. One that is in neither is left out.
   */
  async claimDrafts(
    conversationId: string,
    ids: readonly string[],
  ): Promise<readonly MessageAttachment[]> {
    const from = this.#folder("pastedText", undefined);
    const to = this.#folder("pastedText", conversationId);
    await mkdir(to, { recursive: true });
    const claimed: MessageAttachment[] = [];
    for (const id of ids) {
      if (!validId(id)) continue;
      let target = id;
      if (await exists(join(from, id))) {
        for (let suffix = 2; await exists(join(to, target)); suffix += 1)
          target = id.replace(/(\.txt)?$/, `-${suffix}$1`);
        await rename(join(from, id), join(to, target));
      }
      // Otherwise it may already be this conversation's: a message rewound
      // and sent again.
      else if (!(await exists(join(to, id)))) continue;
      claimed.push({
        kind: "pastedText",
        id: target,
        bytes: (await stat(join(to, target))).size,
        lines: await lineCount(join(to, target)),
      });
    }
    return claimed;
  }

  /** A composer's unsent pastes do not outlive the app that held them. */
  async clearDrafts(): Promise<void> {
    await rm(this.#folder("pastedText", undefined), {
      recursive: true,
      force: true,
    });
  }

  /** Everything a deleted conversation kept goes with it. */
  async forget(conversationId: string): Promise<void> {
    await Promise.all([
      ...(Object.keys(folders) as KeptKind[]).map((kind) =>
        rm(this.#folder(kind, conversationId), {
          recursive: true,
          force: true,
        }),
      ),
      rm(this.#readsFile(conversationId), { force: true }),
    ]);
  }

  #readsFile(conversationId: string): string {
    return join(this.#root, "file-reads", `${folderName(conversationId)}.json`);
  }

  async #reads(conversationId: string): Promise<Record<string, FileRead>> {
    try {
      const stored: unknown = JSON.parse(
        await readFile(this.#readsFile(conversationId), "utf8"),
      );
      return isRecord(stored) ? (stored as Record<string, FileRead>) : {};
    } catch {
      return {};
    }
  }

  async lastRead(
    conversationId: string,
    path: string,
  ): Promise<FileRead | undefined> {
    const read = (await this.#reads(conversationId))[path];
    return read &&
      typeof read.modifiedMs === "number" &&
      typeof read.size === "number" &&
      typeof read.readAt === "string"
      ? read
      : undefined;
  }

  async noteRead(
    conversationId: string,
    path: string,
    read: FileRead,
  ): Promise<void> {
    const reads = { ...(await this.#reads(conversationId)), [path]: read };
    await mkdir(join(this.#root, "file-reads"), { recursive: true });
    await writeFile(this.#readsFile(conversationId), JSON.stringify(reads));
  }

  async #removalReason(kind: KeptKind, path: string): Promise<string> {
    try {
      const stored: unknown = JSON.parse(
        await readFile(`${path}${removedSuffix}`, "utf8"),
      );
      if (isRecord(stored) && typeof stored.reason === "string")
        return stored.reason;
    } catch {
      // No note: the item was never here.
    }
    return reasons[kind].unknown;
  }

  async #noteRemoval(path: string, reason: string): Promise<void> {
    const removal: Removal = { reason, at: this.#now().toISOString() };
    await writeFile(`${path}${removedSuffix}`, JSON.stringify(removal)).catch(
      () => {
        // Whatever refers to an item that cannot say why it is gone still
        // says it is gone.
      },
    );
  }

  /**
   * Age first, then size, oldest going first, across every conversation's
   * folder of the kind. `keep` is the item this cleanup was triggered by.
   */
  async #cleanup(kind: KeptKind, keep: string): Promise<void> {
    const limits = this.#limits[kind];
    const cutoff =
      limits.maximumAgeMs === undefined
        ? undefined
        : this.#now().getTime() - limits.maximumAgeMs;
    const kindFolder = join(this.#root, folders[kind]);
    const owners = await readdir(kindFolder).catch(() => [] as string[]);
    const kept: { path: string; bytes: number; at: number }[] = [];
    for (const owner of owners) {
      const folder = join(kindFolder, owner);
      for (const name of await readdir(folder).catch(() => [] as string[])) {
        const path = join(folder, name);
        const info = await stat(path).catch(() => undefined);
        if (!info?.isFile()) continue;
        if (name.endsWith(removedSuffix)) {
          // The note outlives the item, but not past the item's own age limit.
          if (cutoff !== undefined && info.mtimeMs < cutoff)
            await rm(path, { force: true });
          continue;
        }
        if (path !== keep && cutoff !== undefined && info.mtimeMs < cutoff) {
          await rm(path, { force: true });
          await this.#noteRemoval(path, reasons[kind].evicted);
          continue;
        }
        kept.push({ path, bytes: info.size, at: info.mtimeMs });
      }
    }
    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of kept.sort((a, b) => a.at - b.at)) {
      if (total <= limits.totalBytes) break;
      if (entry.path === keep) continue;
      await rm(entry.path, { force: true });
      await this.#noteRemoval(entry.path, reasons[kind].evicted);
      total -= entry.bytes;
    }
  }
}
