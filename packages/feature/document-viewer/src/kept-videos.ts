/**
 * The videos Zhiyin's 3D studio rendered for each conversation, kept so the
 * document surface can play them.
 *
 * A video is played in the window, unlike a PDF or a picture, which are drawn
 * in a contained process. So only a video whose bytes Zhiyin's own Blender
 * encoded is played, and from a copy taken when it was written: what plays
 * cannot be swapped afterwards. The copy is bound to the size and time of the
 * workspace file it came from, and a file that differs from them is not
 * played. Copies live in the app's data and nothing is kept across a restart.
 */

import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { VIDEO_SCHEME } from "@zhiyin/contract";

/** A kept copy, and the workspace file it was taken from. */
export type KeptVideo = {
  readonly sequence: number;
  readonly size: number;
  readonly modified: number;
};

/** What a file is now, to tell whether it is still the one rendered. */
export type FileNow = { readonly size: number; readonly mtimeMs: number };

export class KeptVideos {
  readonly #directory: string;
  /** Each conversation's kept videos, by workspace path. */
  readonly #kept = new Map<string, Map<string, KeptVideo>>();
  #sequence = 0;
  /** What the last run left, removed before anything is kept. */
  readonly #cleared: Promise<void>;

  /** `directory` is the videos' own folder in the app's data. */
  constructor(directory: string) {
    this.#directory = directory;
    this.#cleared = rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  /**
   * The 3D studio rendered the video at `path`, workspace-relative, which is
   * `file` on disk. A copy is kept; a file that changed while it was copied
   * is not kept, and the video is then not played.
   */
  async keep(
    conversationId: string,
    path: string,
    file: string,
  ): Promise<void> {
    await this.#cleared;
    const before = await stat(file);
    const sequence = ++this.#sequence;
    const folder = join(this.#directory, safeName(conversationId));
    const copy = join(folder, `${sequence}.mp4`);
    await mkdir(folder, { recursive: true });
    await copyFile(file, `${copy}.partial`);
    const after = await stat(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      await rm(`${copy}.partial`, { force: true });
      return;
    }
    await rename(`${copy}.partial`, copy);
    const kept = this.#kept.get(conversationId) ?? new Map();
    this.#kept.set(conversationId, kept);
    const replaced = kept.get(path);
    kept.set(path, { sequence, size: after.size, modified: after.mtimeMs });
    if (replaced)
      await rm(join(folder, `${replaced.sequence}.mp4`), { force: true });
  }

  /**
   * The kept video for a workspace path, while the file there is still the
   * one rendered; `undefined` for a path never rendered, `"changed"` for one
   * changed since.
   */
  playable(
    conversationId: string,
    path: string,
    now: FileNow,
  ): { readonly source: string } | "changed" | undefined {
    const kept = this.#kept.get(conversationId)?.get(path);
    if (!kept) return undefined;
    if (kept.size !== now.size || kept.modified !== now.mtimeMs)
      return "changed";
    return {
      source: `${VIDEO_SCHEME}://video/${encodeURIComponent(conversationId)}/${kept.sequence}`,
    };
  }

  /**
   * Answers a request for a kept video on the video scheme: the whole of it,
   * or the bytes a range asks for, so the person can move through it. Any
   * other address, a conversation's video asked for under another, and one
   * no longer kept, are not found.
   */
  async respond(url: string, range: string | null): Promise<Response> {
    const found = this.#find(url);
    if (!found) return new Response(null, { status: 404 });
    let size: number;
    try {
      size = (await stat(found)).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const headers = {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    if (size === 0)
      return new Response(new Uint8Array(0), { status: 200, headers });
    if (range === null)
      return new Response(stream(found, 0, size - 1), {
        status: 200,
        headers: { ...headers, "content-length": String(size) },
      });
    const asked = bytesAsked(range, size);
    if (!asked)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${size}` },
      });
    const [start, end] = asked;
    return new Response(stream(found, start, end), {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  /** The conversation is gone: its videos go with it. */
  forget(conversationId: string): Promise<void> {
    this.#kept.delete(conversationId);
    return rm(join(this.#directory, safeName(conversationId)), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }

  /** The kept copy an address names, if it names one. */
  #find(url: string): string | undefined {
    let conversationId: string;
    let sequence: number;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== `${VIDEO_SCHEME}:` || parsed.host !== "video")
        return undefined;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length !== 2) return undefined;
      conversationId = decodeURIComponent(parts[0]!);
      sequence = Number(parts[1]);
    } catch {
      // Not an address, or one whose escapes do not decode.
      return undefined;
    }
    const kept = this.#kept.get(conversationId);
    if (!kept || !Number.isInteger(sequence)) return undefined;
    for (const video of kept.values())
      if (video.sequence === sequence)
        return join(
          this.#directory,
          safeName(conversationId),
          `${sequence}.mp4`,
        );
    return undefined;
  }
}

/** A conversation's id as a folder name: nothing in it can leave the folder. */
function safeName(conversationId: string): string {
  return encodeURIComponent(conversationId).replaceAll(".", "%2E");
}

/**
 * The first and last byte one range of a `Range` header asks for, within a
 * file of `size` bytes; `undefined` for a range it cannot answer.
 */
function bytesAsked(
  range: string,
  size: number,
): readonly [number, number] | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || size === 0) return undefined;
  const [, from, to] = match;
  if (from === "" && to === "") return undefined;
  if (from === "") {
    const last = Number(to);
    if (last === 0) return undefined;
    return [Math.max(0, size - last), size - 1];
  }
  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || end < start) return undefined;
  return [start, end];
}

/** A file's bytes from `start` to `end`, as a body a response can carry. */
function stream(file: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(
    createReadStream(file, { start, end }),
  ) as ReadableStream;
}
