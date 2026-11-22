/**
 * The store every kept version of a file goes into, as shared pieces.
 *
 * A file is cut into pieces of about 256 KiB by its content, and each piece
 * is kept once however many files and versions hold it. A piece that is new
 * in a version of a file the store already holds is kept as a zstd delta
 * against the matching piece of that earlier version, with its neighbours as
 * the reference, when that is much smaller; other new pieces are compressed
 * together in frames of about 4 MiB. Frames are appended to a few large pack
 * files, so the disk sees few files.
 *
 * A version is a list of its pieces with the whole file's SHA-256, by which
 * it is named. Writing one puts its frames on disk and flushes them before
 * the catalog names them, and the catalog names the version only after its
 * frames, so a crash leaves either the whole version or none of it.
 *
 * Alternate data streams are kept as versions of their own, named by the
 * file's version.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { constants, zstdCompress, zstdDecompress } from "node:zlib";
import { replaceFile } from "@zhiyin/files";
import { Serial } from "@zhiyin/one-at-a-time";
import { Chunker } from "./chunking.js";

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

const level = 3;
const blockBytes = 16 * 1024 * 1024;
/** About 16 pieces a frame. */
const frameBytes = 4 * 1024 * 1024;
const packBytes = 1024 * 1024 * 1024;
/** How many deltas a piece may stand on, one on another. */
const deepestDelta = 8;
/** A delta is kept when it is under this share of its piece. */
const worthADelta = 0.25;
/** Frames kept decompressed for reading, the most recently read. */
const cachedFrames = 8;

/** The bytes a version holds were not what it was kept as. */
export class DamagedVersionError extends Error {}

type Frame = {
  readonly pack: number;
  readonly offset: number;
  readonly length: number;
  /** Each piece in it, by digest, with where it lies once decompressed. */
  readonly pieces: readonly (readonly [string, number, number])[];
  /** For a delta: the pieces whose bytes, in order, are its dictionary. */
  readonly refs?: readonly string[];
  readonly depth: number;
};

type Version = {
  readonly bytes: number;
  readonly pieces: readonly string[];
  /** The file's alternate data streams, each by name and the version of its bytes. */
  readonly streams?: readonly (readonly [string, string])[];
};

type Line =
  | {
      readonly f: number;
      readonly p: number;
      readonly o: number;
      readonly n: number;
      readonly c: readonly (readonly [string, number, number])[];
      readonly d?: readonly string[];
      readonly h?: number;
    }
  | {
      readonly v: string;
      readonly b: number;
      readonly p: readonly string[];
      readonly s?: readonly (readonly [string, string])[];
    }
  | { readonly x: string };

/** How a file is kept: against a version of it the store holds, and with which alternate streams. */
type PutOptions = {
  readonly earlier?: string;
  readonly streams?: readonly string[];
  /**
   * Whether the file opened, or each stream of it, is the one meant, asked
   * before anything of it is read; when it is not, nothing of it is kept.
   */
  readonly opened?: (file: FileHandle) => Promise<boolean>;
};

/** What `opened` said is not the file meant. */
class UnexpectedFileError extends Error {
  constructor() {
    super(
      "It is not the file its path names through real folders: a junction or symbolic link is on its way.",
    );
    this.name = "UnexpectedFileError";
  }
}

/** Catalog lines named at once when many files are kept together. */
const batchLines = 4096;
/** The most pieces one frame holds, so its catalog line stays short. */
const piecesAFrame = 1024;

/**
 * Pieces read but not yet written, to go into one frame together, and the
 * versions made of them, which the catalog names only after that frame.
 */
type Pending = {
  group: { readonly digest: string; readonly bytes: Buffer }[];
  grouped: number;
  readonly digests: Set<string>;
  readonly versions: Line[];
  /** How many frames were written from it. */
  flushes: number;
};

const waiting = (): Pending => ({
  group: [],
  grouped: 0,
  digests: new Set(),
  versions: [],
  flushes: 0,
});

/** A file kept: the version's digest and size. */
export type Kept = {
  readonly digest: string;
  readonly bytes: number;
};

const digestOf = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

export class PieceStore {
  readonly #folder: string;
  readonly #serial = new Serial();
  #loaded: Promise<void> | undefined;
  readonly #frames = new Map<number, Frame>();
  /** Each piece's frame. */
  readonly #pieces = new Map<string, number>();
  readonly #versions = new Map<string, Version>();
  readonly #cache = new Map<number, Buffer>();
  /** How many puts were done, and when, by that count, each version was last put. */
  #puts = 0;
  readonly #putAt = new Map<string, number>();
  /** What a file is read into, made once. */
  #block: Buffer | undefined;
  #nextFrame = 1;
  #pack = 0;
  #packLength = 0;
  #writer: FileHandle | undefined;
  #catalog: FileHandle | undefined;

  constructor(folder: string) {
    this.#folder = folder;
  }

  /** Whether a version of these contents is kept. */
  async has(digest: string): Promise<boolean> {
    await this.#load();
    return this.#versions.has(digest);
  }

  /** The size of the file each kept version is of. */
  async versions(): Promise<ReadonlyMap<string, number>> {
    await this.#load();
    return new Map(
      [...this.#versions].map(([digest, version]) => [digest, version.bytes]),
    );
  }

  /**
   * What the versions take on disk: their packs. The catalog beside them,
   * a line for each frame, is not counted.
   */
  async used(): Promise<number> {
    await this.#load();
    let total = 0;
    for (const name of await readdir(this.#folder).catch(() => [] as string[]))
      if (/^\d+\.pack$/.test(name))
        total +=
          (await stat(join(this.#folder, name)).catch(() => undefined))?.size ??
          0;
    return total;
  }

  /**
   * Keeps the file at `source` and its alternate data streams, reading it
   * once in blocks. `earlier`, a version of the same file the store holds, is
   * what its new pieces are compared against. Answers the version's digest
   * and size; one already kept costs nothing more.
   */
  put(source: string, options: PutOptions = {}): Promise<Kept> {
    return this.#serial.run(async () => {
      await this.#load();
      const lines: Line[] = [];
      const pending = waiting();
      try {
        const kept = await this.#keepWhole(source, options, lines, pending);
        await this.#flush(pending, lines);
        await this.#commit(lines);
        return kept;
      } catch (error) {
        this.#unwind([...lines, ...pending.versions]);
        throw error;
      }
    });
  }

  /**
   * Keeps many files at once, as `put` keeps one, their pieces sharing
   * frames and named in the catalog a batch at a time, so the disk is
   * flushed once a batch rather than once a file. A file that cannot be read
   * is answered with why, and the others are kept.
   */
  putAll(
    files: readonly (PutOptions & { readonly source: string })[],
  ): Promise<(Kept | { readonly failed: string })[]> {
    return this.#serial.run(async () => {
      await this.#load();
      const answers: (Kept | { readonly failed: string })[] = [];
      let named: Line[] = [];
      const pending = waiting();
      for (const file of files) {
        const mark = {
          flushes: pending.flushes,
          pieces: pending.group.length,
          versions: pending.versions.length,
        };
        try {
          answers.push(
            await this.#keepWhole(file.source, file, named, pending),
          );
        } catch (error) {
          // What only this file put in the group goes; a frame written
          // already stays, named, for the files beside it.
          const flushed = pending.flushes !== mark.flushes;
          const dropped = pending.group.splice(flushed ? 0 : mark.pieces);
          for (const piece of dropped) {
            pending.digests.delete(piece.digest);
            pending.grouped -= piece.bytes.length;
          }
          this.#unwind(pending.versions.splice(flushed ? 0 : mark.versions));
          answers.push({
            failed: error instanceof Error ? error.message : String(error),
          });
        }
        if (named.length + pending.versions.length >= batchLines) {
          await this.#flush(pending, named);
          await this.#commit(named);
          named = [];
        }
      }
      await this.#flush(pending, named);
      await this.#commit(named);
      return answers;
    });
  }

  /**
   * Keeps a file and its streams, adding to `lines` the frames the catalog
   * is to name, and to `pending` its pieces and versions, which wait to be
   * framed.
   */
  async #keepWhole(
    source: string,
    options: PutOptions,
    lines: Line[],
    pending: Pending,
  ): Promise<Kept> {
    const kept = await this.#keep(
      source,
      options.earlier,
      lines,
      pending,
      options.opened,
    );
    this.#putAt.set(kept.digest, ++this.#puts);
    const streams: [string, string][] = [];
    for (const name of options.streams ?? []) {
      const stream = await this.#keep(
        `${source}:${name}`,
        undefined,
        lines,
        pending,
        options.opened,
      );
      streams.push([name, stream.digest]);
    }
    if (streams.length && !this.#versions.get(kept.digest)?.streams) {
      const version = this.#versions.get(kept.digest)!;
      this.#versions.set(kept.digest, { ...version, streams });
      pending.versions.push({
        v: kept.digest,
        b: version.bytes,
        p: version.pieces,
        s: streams,
      });
    }
    return kept;
  }

  /**
   * Writes the pieces waiting as one frame, then adds the versions that
   * waited on them, so the catalog names a version only after its pieces.
   */
  async #flush(pending: Pending, lines: Line[]): Promise<void> {
    if (pending.group.length) {
      const raw = Buffer.concat(pending.group.map((piece) => piece.bytes));
      let start = 0;
      const pieces = pending.group.map(({ digest, bytes }) => {
        const at = [digest, start, bytes.length] as const;
        start += bytes.length;
        return at;
      });
      lines.push(
        await this.#frame(await compress(raw, params(raw.length)), pieces),
      );
      pending.group = [];
      pending.grouped = 0;
      pending.digests.clear();
      pending.flushes += 1;
    }
    lines.push(...pending.versions.splice(0));
  }

  /** What was written for a version not named is as if never written. */
  #unwind(lines: readonly Line[]): void {
    for (const line of lines)
      if ("f" in line) {
        this.#frames.delete(line.f);
        this.#cache.delete(line.f);
        for (const [piece] of line.c)
          if (this.#pieces.get(piece) === line.f) this.#pieces.delete(piece);
      } else if ("v" in line && !line.s) {
        this.#versions.delete(line.v);
        this.#putAt.delete(line.v);
      }
  }

  /**
   * Writes a kept version to `target`, its streams with it, checking that
   * what was written is what was kept, and flushes it to disk.
   */
  materialize(digest: string, target: string): Promise<void> {
    return this.#serial.run(async () => {
      await this.#load();
      const version = this.#versions.get(digest);
      if (!version)
        throw new DamagedVersionError(`No version ${digest} is kept.`);
      await this.#write(digest, version, target);
      for (const [name, stream] of version.streams ?? []) {
        const kept = this.#versions.get(stream);
        if (kept) await this.#write(stream, kept, `${target}:${name}`);
      }
    });
  }

  /** A kept version's bytes, whole, for a file small enough to show. */
  read(digest: string): Promise<Buffer> {
    return this.#serial.run(async () => {
      await this.#load();
      const version = this.#versions.get(digest);
      if (!version)
        throw new DamagedVersionError(`No version ${digest} is kept.`);
      const parts: Buffer[] = [];
      for (const piece of version.pieces) parts.push(await this.#piece(piece));
      const whole = Buffer.concat(parts);
      if (digestOf(whole) !== digest)
        throw new DamagedVersionError(`The version ${digest} is damaged.`);
      return whole;
    });
  }

  /**
   * Lets go of every version but those `live` names, and of the pieces only
   * they held; a pack left mostly empty is written again without them.
   * `purge` takes their bytes out of the store's files at once: a frame
   * that held any of them is written again without them, a piece kept as a
   * delta against one of them is kept whole, and every pack that held them
   * is written again.
   */
  retain(
    live: { has(digest: string): boolean },
    {
      purge = false,
      compact = purge,
    }: {
      readonly purge?: boolean;
      /** Writes again every pack that held what goes, so its room is free at once. */
      readonly compact?: boolean;
    } = {},
  ): Promise<void> {
    // A version put after this was asked for is one `live` could not name.
    const asked = this.#puts;
    return this.#serial.run(async () => {
      await this.#load();
      const kept = new Set<string>();
      for (const [digest, version] of this.#versions) {
        if (!live.has(digest) && !((this.#putAt.get(digest) ?? 0) > asked))
          continue;
        kept.add(digest);
        for (const [, stream] of version.streams ?? []) kept.add(stream);
      }
      const dropped = [...this.#versions.keys()].filter(
        (digest) => !kept.has(digest),
      );
      if (!dropped.length && !compact) return;
      for (const digest of dropped) {
        this.#versions.delete(digest);
        this.#putAt.delete(digest);
      }
      if (purge) await this.#separate();
      await this.#collect(compact);
    });
  }

  /** The pieces no kept version holds. */
  #loose(): Set<string> {
    const held = new Set<string>();
    for (const version of this.#versions.values())
      for (const piece of version.pieces) held.add(piece);
    return new Set(
      [...this.#pieces.keys()].filter((piece) => !held.has(piece)),
    );
  }

  /**
   * Keeps whole, in frames of their own, the held pieces that share a frame
   * with a loose one or are deltas against one, so no frame a kept version
   * needs holds a loose piece's bytes.
   */
  async #separate(): Promise<void> {
    const loose = this.#loose();
    if (!loose.size) return;
    const moving: string[] = [];
    for (const [id, frame] of this.#frames) {
      const tainted =
        frame.pieces.some(([piece]) => loose.has(piece)) ||
        (frame.refs ?? []).some((ref) => loose.has(ref));
      if (!tainted) continue;
      for (const [piece] of frame.pieces)
        if (!loose.has(piece) && this.#pieces.get(piece) === id)
          moving.push(piece);
    }
    const lines: Line[] = [];
    let group: { digest: string; bytes: Buffer }[] = [];
    let grouped = 0;
    const flush = async () => {
      if (!group.length) return;
      const raw = Buffer.concat(group.map((piece) => piece.bytes));
      let start = 0;
      const pieces = group.map(({ digest, bytes }) => {
        const at = [digest, start, bytes.length] as const;
        start += bytes.length;
        return at;
      });
      lines.push(
        await this.#frame(await compress(raw, params(raw.length)), pieces),
      );
      group = [];
      grouped = 0;
    };
    for (const piece of moving) {
      // Read before it moves: its old frame and references still hold.
      const bytes = Buffer.from(await this.#piece(piece));
      group.push({ digest: piece, bytes });
      grouped += bytes.length;
      if (grouped >= frameBytes) await flush();
    }
    await flush();
    await this.#writer?.sync();
  }

  /** Closes the files the store writes to. */
  close(): Promise<void> {
    return this.#serial.run(async () => {
      await this.#writer?.close();
      await this.#catalog?.close();
      this.#writer = undefined;
      this.#catalog = undefined;
    });
  }

  async #keep(
    source: string,
    earlier: string | undefined,
    lines: Line[],
    pending: Pending,
    opened?: (file: FileHandle) => Promise<boolean>,
  ): Promise<Kept> {
    const before = earlier ? this.#versions.get(earlier) : undefined;
    // A delta is made against pieces in frames.
    if (before?.pieces.some((piece) => !this.#pieces.has(piece)))
      await this.#flush(pending, lines);
    const file = await open(source, "r");
    if (opened && !(await opened(file).catch(() => false))) {
      await file.close();
      throw new UnexpectedFileError();
    }
    const whole = createHash("sha256");
    const order: string[] = [];
    const reference = before ? await this.#reference(before) : undefined;
    const fresh = new Set<string>();
    let bytes = 0;
    try {
      const chunker = new Chunker();
      // One file is read at a time, into the same block: the chunker copies
      // what it holds over, and each piece kept is copied.
      const block = (this.#block ??= Buffer.allocUnsafe(blockBytes));
      for (;;) {
        const { bytesRead } = await file.read(block, 0, blockBytes, null);
        const last = bytesRead < blockBytes;
        const data = block.subarray(0, bytesRead);
        whole.update(data);
        const offset = bytes;
        bytes += bytesRead;
        let at = offset;
        for (const piece of chunker.push(data, last)) {
          const digest = digestOf(piece);
          const position = at;
          at += piece.length;
          order.push(digest);
          if (
            this.#pieces.has(digest) ||
            fresh.has(digest) ||
            pending.digests.has(digest)
          )
            continue;
          fresh.add(digest);
          const delta = reference
            ? await this.#delta(piece, reference.near(position))
            : undefined;
          if (delta) {
            lines.push(
              await this.#frame(
                delta.bytes,
                [[digest, 0, piece.length]],
                delta.refs,
              ),
            );
            continue;
          }
          pending.group.push({ digest, bytes: Buffer.from(piece) });
          pending.digests.add(digest);
          pending.grouped += piece.length;
          if (
            pending.grouped >= frameBytes ||
            pending.group.length >= piecesAFrame
          )
            await this.#flush(pending, lines);
        }
        if (last) break;
      }
    } finally {
      await file.close();
    }
    const digest = whole.digest("hex");
    if (!this.#versions.has(digest)) {
      this.#versions.set(digest, { bytes, pieces: order });
      pending.versions.push({ v: digest, b: bytes, p: order });
    }
    return { digest, bytes };
  }

  /**
   * Where each piece of an earlier version lies in it, so a new piece is
   * compared with the pieces about the same place.
   */
  async #reference(version: Version) {
    const starts: number[] = [];
    let at = 0;
    for (const piece of version.pieces) {
      starts.push(at);
      const frame = this.#frames.get(this.#pieces.get(piece)!);
      at += frame?.pieces.find(([digest]) => digest === piece)?.[2] ?? 0;
    }
    return {
      /** The pieces of the earlier version around `position`: the one there and its neighbours. */
      near: (position: number): string[] => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
          const middle = (low + high + 1) >> 1;
          if (starts[middle]! <= position) low = middle;
          else high = middle - 1;
        }
        return version.pieces.slice(Math.max(0, low - 1), low + 2);
      },
    };
  }

  async #delta(
    piece: Uint8Array,
    refs: readonly string[],
  ): Promise<{ bytes: Buffer; refs: readonly string[] } | undefined> {
    if (!refs.length) return undefined;
    const depth = Math.max(
      ...refs.map(
        (ref) => this.#frames.get(this.#pieces.get(ref)!)?.depth ?? 0,
      ),
    );
    if (depth + 1 > deepestDelta) return undefined;
    const dictionary = Buffer.concat(
      await Promise.all(refs.map((ref) => this.#piece(ref))),
    );
    const bytes = await compress(piece, {
      ...params(dictionary.length + piece.length),
      dictionary,
    });
    return bytes.length < piece.length * worthADelta
      ? { bytes, refs }
      : undefined;
  }

  /** Appends a compressed frame to the pack, and answers its catalog line. */
  async #frame(
    compressed: Buffer,
    pieces: readonly (readonly [string, number, number])[],
    refs?: readonly string[],
  ): Promise<Line> {
    if (!this.#writer || this.#packLength + compressed.length > packBytes) {
      if (this.#writer) {
        await this.#writer.sync();
        await this.#writer.close();
        this.#pack += 1;
        this.#packLength = 0;
      }
      await mkdir(this.#folder, { recursive: true });
      this.#writer = await open(this.#packPath(this.#pack), "a");
    }
    const offset = this.#packLength;
    await this.#writer.write(compressed, 0, compressed.length, null);
    this.#packLength += compressed.length;
    const id = this.#nextFrame++;
    const depth = refs
      ? 1 +
        Math.max(
          ...refs.map(
            (ref) => this.#frames.get(this.#pieces.get(ref)!)?.depth ?? 0,
          ),
        )
      : 0;
    const frame: Frame = {
      pack: this.#pack,
      offset,
      length: compressed.length,
      pieces,
      ...(refs ? { refs } : {}),
      depth,
    };
    this.#frames.set(id, frame);
    for (const [digest] of pieces) this.#pieces.set(digest, id);
    return {
      f: id,
      p: frame.pack,
      o: offset,
      n: compressed.length,
      c: pieces,
      ...(refs ? { d: refs } : {}),
      ...(depth ? { h: depth } : {}),
    };
  }

  /** Flushes the frames, then names them and the versions in the catalog. */
  async #commit(lines: readonly Line[]): Promise<void> {
    if (!lines.length) return;
    await this.#writer?.sync();
    await mkdir(this.#folder, { recursive: true });
    this.#catalog ??= await open(join(this.#folder, "catalog.log"), "a");
    await this.#catalog.write(
      lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    );
    await this.#catalog.sync();
  }

  async #write(
    digest: string,
    version: Version,
    target: string,
  ): Promise<void> {
    const out = await open(target, "w");
    const whole = createHash("sha256");
    try {
      for (const piece of version.pieces) {
        const bytes = await this.#piece(piece);
        whole.update(bytes);
        await out.write(bytes, 0, bytes.length, null);
      }
      await out.sync();
    } finally {
      await out.close();
    }
    if (whole.digest("hex") !== digest)
      throw new DamagedVersionError(`The version ${digest} is damaged.`);
  }

  /** One piece's bytes. */
  async #piece(digest: string): Promise<Buffer> {
    const id = this.#pieces.get(digest);
    const frame = id === undefined ? undefined : this.#frames.get(id);
    const at = frame?.pieces.find(([piece]) => piece === digest);
    if (id === undefined || !frame || !at)
      throw new DamagedVersionError(`The piece ${digest} is not kept.`);
    const raw = await this.#frameBytes(id, frame);
    return raw.subarray(at[1], at[1] + at[2]);
  }

  async #frameBytes(id: number, frame: Frame): Promise<Buffer> {
    const cached = this.#cache.get(id);
    if (cached) {
      this.#cache.delete(id);
      this.#cache.set(id, cached);
      return cached;
    }
    const pack = await open(this.#packPath(frame.pack), "r");
    const compressed = Buffer.alloc(frame.length);
    try {
      await pack.read(compressed, 0, frame.length, frame.offset);
    } finally {
      await pack.close();
    }
    let raw: Buffer;
    try {
      raw = frame.refs
        ? await decompress(compressed, {
            dictionary: Buffer.concat(
              await Promise.all(frame.refs.map((ref) => this.#piece(ref))),
            ),
            params: { [constants.ZSTD_d_windowLogMax]: 31 },
          })
        : await decompress(compressed, {
            params: { [constants.ZSTD_d_windowLogMax]: 31 },
          });
    } catch {
      throw new DamagedVersionError("A frame of the store could not be read.");
    }
    for (const [piece, start, length] of frame.pieces)
      if (digestOf(raw.subarray(start, start + length)) !== piece)
        throw new DamagedVersionError(`The piece ${piece} is damaged.`);
    this.#cache.set(id, raw);
    while (this.#cache.size > cachedFrames)
      this.#cache.delete(this.#cache.keys().next().value!);
    return raw;
  }

  /**
   * Drops the frames no kept version needs, directly or as a delta's
   * reference; writes again each pack left less than half full, or with
   * `compact` each pack holding any bytes no frame needs, then the catalog,
   * and removes the packs nothing names.
   */
  async #collect(compact = false): Promise<void> {
    const needed = new Set<string>();
    const pending = [...this.#versions.values()].flatMap(
      (version) => version.pieces,
    );
    while (pending.length) {
      const piece = pending.pop()!;
      if (needed.has(piece)) continue;
      needed.add(piece);
      const frame = this.#frames.get(this.#pieces.get(piece) ?? -1);
      for (const ref of frame?.refs ?? []) pending.push(ref);
    }
    for (const [id, frame] of [...this.#frames])
      if (
        !frame.pieces.some(
          ([piece]) => needed.has(piece) && this.#pieces.get(piece) === id,
        )
      ) {
        this.#frames.delete(id);
        this.#cache.delete(id);
        for (const [piece] of frame.pieces)
          if (this.#pieces.get(piece) === id) this.#pieces.delete(piece);
      }
    const live = new Map<number, number>();
    for (const frame of this.#frames.values())
      live.set(frame.pack, (live.get(frame.pack) ?? 0) + frame.length);
    // The pack being written to stays; a full pack mostly let go of is copied.
    await this.#writer?.sync();
    await this.#writer?.close();
    this.#writer = undefined;
    const sparse: number[] = [];
    for (const [pack, bytes] of live) {
      const size =
        (await stat(this.#packPath(pack)).catch(() => undefined))?.size ?? 0;
      if (bytes <= size / 2 || (compact && bytes < size)) sparse.push(pack);
    }
    this.#pack += 1;
    this.#packLength = 0;
    for (const [id, frame] of [...this.#frames]) {
      if (!sparse.includes(frame.pack)) continue;
      const source = await open(this.#packPath(frame.pack), "r");
      const bytes = Buffer.alloc(frame.length);
      try {
        await source.read(bytes, 0, frame.length, frame.offset);
      } finally {
        await source.close();
      }
      if (!this.#writer || this.#packLength + bytes.length > packBytes) {
        await this.#writer?.sync();
        await this.#writer?.close();
        if (this.#writer) {
          this.#pack += 1;
          this.#packLength = 0;
        }
        this.#writer = await open(this.#packPath(this.#pack), "a");
      }
      await this.#writer.write(bytes, 0, bytes.length, null);
      this.#frames.set(id, {
        ...frame,
        pack: this.#pack,
        offset: this.#packLength,
      });
      this.#packLength += bytes.length;
    }
    await this.#writer?.sync();
    await this.#rewriteCatalog();
    const named = new Set(
      [...this.#frames.values()].map((frame) => frame.pack),
    );
    for (const name of await readdir(this.#folder).catch(
      () => [] as string[],
    )) {
      const pack = /^(\d+)\.pack$/.exec(name);
      if (pack && !named.has(Number(pack[1])) && Number(pack[1]) !== this.#pack)
        await rm(join(this.#folder, name), { force: true });
    }
  }

  async #rewriteCatalog(): Promise<void> {
    await this.#catalog?.close();
    this.#catalog = undefined;
    const lines: Line[] = [];
    for (const [id, frame] of this.#frames)
      lines.push({
        f: id,
        p: frame.pack,
        o: frame.offset,
        n: frame.length,
        c: frame.pieces,
        ...(frame.refs ? { d: frame.refs } : {}),
        ...(frame.depth ? { h: frame.depth } : {}),
      });
    for (const [digest, version] of this.#versions)
      lines.push({
        v: digest,
        b: version.bytes,
        p: version.pieces,
        ...(version.streams ? { s: version.streams } : {}),
      });
    await mkdir(this.#folder, { recursive: true });
    // Replaced whole, over a reader that holds it open too.
    await replaceFile(
      join(this.#folder, "catalog.log"),
      lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    );
  }

  #packPath(pack: number): string {
    return join(this.#folder, `${String(pack).padStart(6, "0")}.pack`);
  }

  #load(): Promise<void> {
    if (!this.#loaded) {
      this.#loaded = this.#read();
      this.#loaded.catch(() => (this.#loaded = undefined));
    }
    return this.#loaded;
  }

  /**
   * Reads the catalog. A line a crash cut short is passed over, a version
   * whose pieces are not all named is not kept, and a pack's bytes past its
   * last named frame, which a crash left, are let go of.
   */
  async #read(): Promise<void> {
    const text = await readFile(
      join(this.#folder, "catalog.log"),
      "utf8",
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const row of text.split("\n")) {
      if (!row) continue;
      let line: Line;
      try {
        line = JSON.parse(row) as Line;
      } catch {
        continue;
      }
      if ("f" in line) {
        this.#frames.set(line.f, {
          pack: line.p,
          offset: line.o,
          length: line.n,
          pieces: line.c,
          ...(line.d ? { refs: line.d } : {}),
          depth: line.h ?? 0,
        });
        for (const [piece] of line.c) this.#pieces.set(piece, line.f);
        this.#nextFrame = Math.max(this.#nextFrame, line.f + 1);
      } else if ("v" in line) {
        if (line.p.every((piece) => this.#pieces.has(piece)))
          this.#versions.set(line.v, {
            bytes: line.b,
            pieces: line.p,
            ...(line.s ? { streams: line.s } : {}),
          });
      } else this.#versions.delete(line.x);
    }
    const ends = new Map<number, number>();
    for (const frame of this.#frames.values())
      ends.set(
        frame.pack,
        Math.max(ends.get(frame.pack) ?? 0, frame.offset + frame.length),
      );
    const packs = (await readdir(this.#folder).catch(() => [] as string[]))
      .flatMap((name) => /^(\d+)\.pack$/.exec(name)?.[1] ?? [])
      .map(Number);
    for (const pack of packs) {
      const end = ends.get(pack);
      if (end === undefined) {
        await rm(this.#packPath(pack), { force: true });
        continue;
      }
      const file = await open(this.#packPath(pack), "r+");
      try {
        if ((await file.stat()).size > end) await file.truncate(end);
      } finally {
        await file.close();
      }
    }
    this.#pack = Math.max(0, ...ends.keys()) + (ends.size ? 1 : 0);
    this.#packLength = 0;
  }
}

/** zstd at level 3, with a window that reaches over the reference and the piece. */
function params(reach: number) {
  return {
    params: {
      [constants.ZSTD_c_compressionLevel]: level,
      [constants.ZSTD_c_windowLog]: Math.min(
        30,
        Math.max(20, Math.ceil(Math.log2(Math.max(2, reach))) + 1),
      ),
    },
  };
}
