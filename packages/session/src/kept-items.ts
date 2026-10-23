/**
 * What a conversation keeps beside itself rather than inside it: the pictures
 * its tools and connectors produced, the long texts and the pictures a person
 * pasted, and the full output a tool answered with when only part of it was
 * sent.
 *
 * One folder per kind, each with its own limits, so one kind filling up never
 * removes another's items: screenshots arriving by the dozen must not push out
 * something a person pasted. Inside each, one folder per conversation, so a
 * deleted conversation takes its items with it. What a person pasted or
 * attached has no age limit, only a size limit: it is their material, not a
 * tool's by-product.
 *
 * An item removed to stay inside a limit leaves a small note in its place, so
 * whatever refers to it can say why it is gone instead of showing a gap.
 */

import {
  constants,
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { replaceFile } from "@zhiyin/file-replacement";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type {
  FileRead,
  MessageAttachment,
  PictureToKeep,
} from "@zhiyin/contract";
import { isRecord } from "./saved-values.js";
import { folderName } from "./history-store.js";
import { KeptTotals } from "./kept-totals.js";

export type KeptKind =
  | "toolPictures"
  | "connectorPictures"
  | "pastedText"
  | "pastedPictures"
  | "output";

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

// Pictures are measured on their stored form, which is base64: a 12 MB
// picture is 16 MB.
export const defaultKeptLimits: Readonly<Record<KeptKind, KeptLimits>> = {
  toolPictures: {
    itemBytes: 16 * mib,
    totalBytes: 128 * mib,
    maximumAgeMs: days(30),
  },
  connectorPictures: {
    itemBytes: 16 * mib,
    totalBytes: 64 * mib,
    maximumAgeMs: days(30),
  },
  pastedText: { itemBytes: 50 * mib, totalBytes: 256 * mib },
  pastedPictures: { itemBytes: 16 * mib, totalBytes: 256 * mib },
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
  pastedPictures: "pasted-pictures",
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
  pastedPictures: {
    evicted: "This picture was deleted to save disk space.",
    oversize: "This picture is larger than 12 MB, so it was not kept.",
    unknown: "This picture is no longer stored with the conversation.",
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
  /** Each conversation's record of reads, written one change at a time. */
  readonly #noting = new Map<string, Promise<void>>();
  /** What each kind holds, read once at the first keep of that kind. */
  readonly #totals = new Map<KeptKind, Promise<KeptTotals>>();

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
    const bytes =
      "text" in source
        ? Buffer.byteLength(source.text, "utf8")
        : (await stat(source.file)).size;
    if (bytes > this.#limits[kind].itemBytes) {
      const id = await this.#named(kind, folder, (path) =>
        this.#noteRemoval(kind, path, reasons[kind].oversize, "wx"),
      );
      return { status: "refused", id, reason: reasons[kind].oversize };
    }
    const id = await this.#named(kind, folder, (path) =>
      "text" in source
        ? writeFile(path, source.text, { encoding: "utf8", flag: "wx" })
        : copyFile(source.file, path, constants.COPYFILE_EXCL),
    );
    // Stamped with the store's clock, by which its age is counted.
    const at = this.#now();
    await utimes(join(folder, id), at, at).catch(() => undefined);
    // After the write, so the item just kept is never the one removed to make
    // room for itself.
    await this.#cleanup(kind, join(folder, id), bytes);
    return { status: "kept", id, bytes };
  }

  /**
   * Takes a name no other item of the folder has, by creating the item (or
   * its note) under it exclusively: two keeps at the same moment never share
   * one. A paste is named by when it was made, with a suffix when taken.
   */
  async #named(
    kind: KeptKind,
    folder: string,
    create: (path: string) => Promise<void>,
  ): Promise<string> {
    const base = pasteName(this.#now());
    for (let suffix = 1; ; suffix += 1) {
      const id =
        kind !== "pastedText"
          ? randomUUID()
          : suffix === 1
            ? base
            : base.replace(/\.txt$/, `-${suffix}.txt`);
      // A name an item removed earlier still answers for is not reused.
      if (await exists(join(folder, `${id}${removedSuffix}`))) continue;
      try {
        await create(join(folder, id));
        return id;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
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
   * Moves draft pastes and pictures into the conversation their message was
   * sent in. A name already taken there is kept apart with a suffix, and the
   * answer says what each paste is called now, how large it is and how many
   * lines it has, and what each picture is. One already in this conversation,
   * from a message rewound and sent again, stays where it is. One that is in
   * neither is left out.
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
      const picture = await this.#claimPicture(conversationId, id);
      if (picture) {
        claimed.push(picture);
        continue;
      }
      let target = id;
      if (await exists(join(from, id))) {
        // Linked under a name no item there has or had, then let go of in
        // the drafts: a name taken meanwhile is never written over.
        for (let suffix = 2; ; suffix += 1) {
          if (!(await exists(join(to, `${target}${removedSuffix}`))))
            try {
              await link(join(from, id), join(to, target));
              break;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                throw error;
            }
          target = id.replace(/(\.txt)?$/, `-${suffix}$1`);
        }
        await rm(join(from, id), { force: true });
        await this.#followed("pastedText", (totals) =>
          totals.moved(join(from, id), join(to, target)),
        );
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

  /** A picture, drafted until its message is sent, as `keep` keeps a paste. */
  keepPicture(picture: PictureToKeep): Promise<KeptItem> {
    return this.keep("pastedPictures", undefined, {
      text: JSON.stringify(picture),
    });
  }

  async #claimPicture(
    conversationId: string,
    id: string,
  ): Promise<MessageAttachment | undefined> {
    const draft = join(this.#folder("pastedPictures", undefined), id);
    const owned = join(this.#folder("pastedPictures", conversationId), id);
    if (await exists(draft)) {
      await mkdir(join(owned, ".."), { recursive: true });
      await rename(draft, owned);
      await this.#followed("pastedPictures", (totals) =>
        totals.moved(draft, owned),
      );
    } else if (!(await exists(owned))) return undefined;
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(owned, "utf8"));
    } catch {
      return undefined;
    }
    if (
      !isRecord(stored) ||
      typeof stored.name !== "string" ||
      typeof stored.mediaType !== "string" ||
      typeof stored.data !== "string"
    )
      return undefined;
    return {
      kind: "picture",
      id,
      name: stored.name,
      mediaType: stored.mediaType,
      bytes: Buffer.byteLength(stored.data, "base64"),
      source: this.source("pastedPictures", conversationId, id),
    };
  }

  /** A composer's unsent pastes do not outlive the app that held them. */
  async clearDrafts(): Promise<void> {
    await Promise.all(
      (["pastedText", "pastedPictures"] as const).map(async (kind) => {
        const folder = this.#folder(kind, undefined);
        await rm(folder, { recursive: true, force: true });
        await this.#followed(kind, (totals) => totals.removedUnder(folder));
      }),
    );
  }

  /** Everything a deleted conversation kept goes with it. */
  async forget(conversationId: string): Promise<void> {
    await Promise.all([
      ...(Object.keys(folders) as KeptKind[]).map(async (kind) => {
        const folder = this.#folder(kind, conversationId);
        await rm(folder, { recursive: true, force: true });
        await this.#followed(kind, (totals) => totals.removedUnder(folder));
      }),
      rm(this.#readsFile(conversationId), { force: true }),
    ]);
    const pending = await this.#pending();
    if (pending.includes(conversationId))
      await this.#writePending(pending.filter((id) => id !== conversationId));
  }

  /**
   * Notes, on disk, a deleted conversation whose kept items are cleared once
   * its folder is gone, so Zhiyin closing in between does not strand them.
   */
  async willForget(conversationId: string): Promise<void> {
    const pending = await this.#pending();
    if (!pending.includes(conversationId))
      await this.#writePending([...pending, conversationId]);
  }

  /**
   * Finishes what an earlier run noted: a conversation whose folder is gone
   * has its kept items cleared, and one whose folder is still there came back
   * whole, with them.
   */
  async finishForgetting(
    holds: (conversationId: string) => Promise<boolean>,
  ): Promise<void> {
    for (const id of await this.#pending())
      if (await holds(id)) {
        const pending = await this.#pending();
        await this.#writePending(pending.filter((other) => other !== id));
      } else await this.forget(id);
  }

  #pendingFile(): string {
    return join(this.#root, "forgetting.json");
  }

  async #pending(): Promise<string[]> {
    try {
      const stored: unknown = JSON.parse(
        await readFile(this.#pendingFile(), "utf8"),
      );
      return Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  }

  async #writePending(ids: readonly string[]): Promise<void> {
    if (!ids.length) {
      await rm(this.#pendingFile(), { force: true });
      return;
    }
    await mkdir(this.#root, { recursive: true });
    await replaceFile(this.#pendingFile(), JSON.stringify(ids));
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

  /**
   * Adds one read to the conversation's record. Reads that finish together
   * are added in turn, so none replaces another, and the record is swapped in
   * whole, so a crash leaves the old one or the new.
   */
  noteRead(
    conversationId: string,
    path: string,
    read: FileRead,
  ): Promise<void> {
    const noted = (this.#noting.get(conversationId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const reads = { ...(await this.#reads(conversationId)), [path]: read };
        const file = this.#readsFile(conversationId);
        await mkdir(join(this.#root, "file-reads"), { recursive: true });
        await replaceFile(file, JSON.stringify(reads));
      });
    this.#noting.set(conversationId, noted);
    void noted
      .finally(() => {
        if (this.#noting.get(conversationId) === noted)
          this.#noting.delete(conversationId);
      })
      .catch(() => {});
    return noted;
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

  /**
   * Leaves the note saying why an item is gone. Created exclusively (`wx`)
   * when it stands for a name being taken; otherwise a note that cannot be
   * written is let go, since whatever refers to the item still says it is
   * gone.
   */
  async #noteRemoval(
    kind: KeptKind,
    path: string,
    reason: string,
    flag: "w" | "wx" = "w",
  ): Promise<void> {
    const now = this.#now();
    const removal: Removal = { reason, at: now.toISOString() };
    const note = `${path}${removedSuffix}`;
    try {
      await writeFile(note, JSON.stringify(removal), { flag });
    } catch (error) {
      if (flag === "wx") throw error;
      return;
    }
    await utimes(note, now, now).catch(() => undefined);
    await this.#followed(kind, (totals) => totals.noted(note, now.getTime()));
  }

  /** What a kind holds, read from its folder the first time it is asked for. */
  #totalsOf(kind: KeptKind): Promise<KeptTotals> {
    let totals = this.#totals.get(kind);
    if (!totals) {
      totals = KeptTotals.read(join(this.#root, folders[kind]), (name) =>
        name.endsWith(removedSuffix),
      );
      this.#totals.set(kind, totals);
      totals.catch(() => this.#totals.delete(kind));
    }
    return totals;
  }

  /** Tells a kind's totals of a change, when they have been read. */
  async #followed(
    kind: KeptKind,
    change: (totals: KeptTotals) => void,
  ): Promise<void> {
    const totals = this.#totals.get(kind);
    if (totals) change(await totals);
  }

  /**
   * Age first, then size, oldest going first, across every conversation's
   * folder of the kind. `keep` is the item this cleanup was triggered by,
   * of `bytes`; it is never the one removed.
   */
  async #cleanup(kind: KeptKind, keep: string, bytes: number): Promise<void> {
    const limits = this.#limits[kind];
    const totals = await this.#totalsOf(kind);
    totals.kept(keep, bytes, this.#now().getTime());
    if (limits.maximumAgeMs !== undefined) {
      const old = totals.olderThan(
        this.#now().getTime() - limits.maximumAgeMs,
        keep,
      );
      // The note outlives the item, but not past the item's own age limit. One
      // another program holds is tried again at the next keep.
      for (const note of old.notes) {
        try {
          await rm(note, { force: true });
        } catch {
          continue;
        }
        totals.removed(note);
      }
      for (const item of old.items) await this.#evict(kind, totals, item);
    }
    for (const item of totals.oldestBeyond(limits.totalBytes, keep))
      await this.#evict(kind, totals, item);
  }

  async #evict(kind: KeptKind, totals: KeptTotals, path: string) {
    // One another program holds stays counted, and is tried again at the
    // next keep; the item being kept does not wait on it.
    try {
      await rm(path, { force: true });
    } catch {
      return;
    }
    totals.removed(path);
    await this.#noteRemoval(kind, path, reasons[kind].evicted);
  }
}
