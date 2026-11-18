/**
 * The storage limits applied to what recovery keeps: the age of an action's
 * copies, the versions kept of each file, and the total, within which a copy
 * of a folder about to be changed is also made room for.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ContentStore } from "./content-store.js";
import type { FolderCopies } from "./folder-copies.js";
import { folderKey } from "./folder-mirrors.js";
import type { CapturedFile, Manifest } from "./records.js";

export type RecoveryLimits = {
  readonly totalBytes: number;
  readonly fileBytes: number;
  readonly versionsPerPath: number;
  readonly maximumAgeMs: number;
};

const mib = 1024 * 1024;

/**
 * What recovery may keep in all, given the free space on its disk: a tenth of
 * it, never under 256 MiB nor over 4 GiB (ADR 0013).
 */
export function recoveryTotal(freeBytes: number): number {
  return Math.min(4096 * mib, Math.max(256 * mib, Math.floor(freeBytes / 10)));
}

type KeptAction = { readonly folder: string; readonly manifest: Manifest };

/** What applying the limits reads and changes. */
export type KeptStore = {
  /** Every kept action's manifest by its folder. */
  readonly kept: () => Promise<Map<string, Manifest>>;
  readonly limits: RecoveryLimits;
  readonly now: () => Date;
  /** Whether an action in this folder is being prepared or awaits its run. */
  readonly inUse: (folder: string) => boolean;
  readonly contents: ContentStore;
  readonly copies: FolderCopies;
  readonly writeManifest: (folder: string, manifest: Manifest) => Promise<void>;
};

/**
 * What names a file's copy within its action: its own file, or its place in
 * the action when the copy is kept by its contents.
 */
const copyOf = (file: CapturedFile): string | undefined =>
  file.backup ?? (file.content ? `content:${file.path}` : undefined);

/**
 * Applies the limits, sparing `spared`, the action just committed, whatever
 * goes. Given `room`, makes room for a folder's copy as well: what the copy
 * of any other folder holds goes first, being only a shortcut, then the
 * oldest copies. Answers the bytes left under the total.
 */
export async function applyLimits(
  store: KeptStore,
  spared?: string,
  room?: {
    readonly reserve: number;
    readonly folder: string;
    readonly keep: ReadonlySet<string>;
  },
): Promise<number> {
  const kept = await store.kept();
  const cutoff = store.now().getTime() - store.limits.maximumAgeMs;
  const untouchable = (folder: string) =>
    folder === spared || store.inUse(folder);
  for (const [folder, manifest] of [...kept]) {
    if (untouchable(folder) || Date.parse(manifest.createdAt) >= cutoff)
      continue;
    await rm(folder, { recursive: true, force: true });
    kept.delete(folder);
  }
  const loaded: KeptAction[] = [...kept].map(([folder, manifest]) => ({
    folder,
    manifest,
  }));
  const expired = new Set<string>();

  const versions = new Map<
    string,
    {
      readonly folder: string;
      readonly copy: string;
      readonly createdAt: string;
      readonly order: number;
    }[]
  >();
  for (const [order, item] of loaded.entries()) {
    if (item.manifest.phase !== "committed") continue;
    for (const file of item.manifest.files) {
      const copy = copyOf(file);
      if (file.status !== "protected" || !copy) continue;
      const identity = `${item.manifest.workspaceRoot}\u0000${file.path}`;
      versions.set(identity, [
        ...(versions.get(identity) ?? []),
        {
          folder: item.folder,
          copy,
          createdAt: item.manifest.createdAt,
          order,
        },
      ]);
    }
  }
  for (const entries of versions.values()) {
    // Newest first, the action just committed first of all. Of two taken
    // at the same moment in this session, the one prepared later is the
    // newer.
    entries.sort(
      (a, b) =>
        Number(b.folder === spared) - Number(a.folder === spared) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.order - a.order,
    );
    for (const entry of entries.slice(store.limits.versionsPerPath))
      if (!untouchable(entry.folder))
        expired.add(`${entry.folder}:${entry.copy}`);
  }

  // What takes room: a copy in an action's own folder, or contents in the
  // shared store, counted once however many name them.
  const contents = await store.contents.sizes();
  const named = new Map<string, number>();
  const bytesOf = (unit: string, fallback: number) =>
    unit.startsWith("content:") ? (contents.get(unit.slice(8)) ?? 0) : fallback;
  let total = 0;
  const name = (unit: string, bytes: number) => {
    const count = named.get(unit) ?? 0;
    if (count === 0) total += bytesOf(unit, bytes);
    named.set(unit, count + 1);
  };
  const unname = (unit: string, bytes: number) => {
    const count = (named.get(unit) ?? 0) - 1;
    named.set(unit, count);
    if (count === 0) total -= bytesOf(unit, bytes);
  };
  const unitOf = (folder: string, file: CapturedFile) =>
    file.content
      ? `content:${file.content}`
      : `file:${folder}:${file.backup ?? ""}`;
  const retained = loaded
    .flatMap((item) =>
      item.manifest.files.flatMap((file) => {
        const copy = copyOf(file);
        return file.status === "protected" &&
          copy &&
          !expired.has(`${item.folder}:${copy}`)
          ? [
              {
                folder: item.folder,
                copy,
                unit: unitOf(item.folder, file),
                bytes: file.bytes ?? 0,
                createdAt: item.manifest.createdAt,
              },
            ]
          : [];
      }),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  // The copies that keep each unit, oldest first, so weighing one does not
  // search every copy again.
  const keeping = new Map<string, (typeof retained)[number][]>();
  for (const entry of retained) {
    name(entry.unit, entry.bytes);
    const holding = keeping.get(entry.unit);
    if (holding) holding.push(entry);
    else keeping.set(entry.unit, [entry]);
  }
  const mirrors = await store.copies.mirrors();
  for (const mirror of mirrors)
    for (const digest of mirror.digests) name(`content:${digest}`, 0);
  for (const digest of [...store.copies.inUse(), ...(room?.keep ?? [])])
    name(`content:${digest}`, 0);

  const over = () => total + (room?.reserve ?? 0) > store.limits.totalBytes;
  // The copies of other folders only spare copying them again.
  const own = room ? folderKey(room.folder) : undefined;
  const dropped: string[] = [];
  for (const mirror of [...mirrors].sort((a, b) => a.usedAt - b.usedAt)) {
    if (!over()) break;
    if (mirror.waiting || mirror.key === own) continue;
    dropped.push(mirror.key);
    for (const digest of mirror.digests) unname(`content:${digest}`, 0);
  }
  // Past the total, the oldest copies go first; those of an action in use
  // stay, counted. Contents several changes keep are let go of together,
  // at the oldest's turn, and only when that frees their room: a change
  // keeps its copy while anything else still needs the same contents.
  const weighed = new Set<string>();
  for (const entry of retained) {
    if (!over()) break;
    if (weighed.has(entry.unit)) continue;
    weighed.add(entry.unit);
    const holders = (keeping.get(entry.unit) ?? []).filter(
      (other) => !expired.has(`${other.folder}:${other.copy}`),
    );
    if (
      holders.some((other) => untouchable(other.folder)) ||
      (named.get(entry.unit) ?? 0) > holders.length
    )
      continue;
    for (const other of holders) {
      expired.add(`${other.folder}:${other.copy}`);
      unname(other.unit, other.bytes);
    }
  }

  for (const key of dropped) await store.copies.dropMirror(key);
  for (const item of loaded) {
    let changed = false;
    const files = await Promise.all(
      item.manifest.files.map(async (file) => {
        const copy = copyOf(file);
        if (!copy || !expired.has(`${item.folder}:${copy}`)) return file;
        changed = true;
        if (file.backup)
          await rm(join(item.folder, file.backup), { force: true });
        return {
          path: file.path,
          status: "unprotected" as const,
          reason:
            "The retained recovery copy expired or was evicted by storage limits.",
          evicted: true as const,
          before: file.before,
          ...(file.beforeDigest ? { beforeDigest: file.beforeDigest } : {}),
          ...(file.after ? { after: file.after } : {}),
          ...(file.afterDigest ? { afterDigest: file.afterDigest } : {}),
        };
      }),
    );
    if (!changed) continue;
    // The record stays without its copies: going back past it still needs
    // to know what each change left. It goes with its age or conversation.
    await store.writeManifest(item.folder, { ...item.manifest, files });
  }
  // Contents nothing names any more go.
  for (const digest of [...contents.keys()])
    if (!((named.get(`content:${digest}`) ?? 0) > 0))
      await store.contents.remove(digest);
  return Math.max(0, store.limits.totalBytes - total);
}
