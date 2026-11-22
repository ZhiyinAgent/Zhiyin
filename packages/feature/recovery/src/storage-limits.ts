/**
 * The undo budget (ADR 0031): what recovery keeps takes no more room than the
 * person allows. When it would, versions are let go of in this order: the
 * record of what was known of a folder, which only spares watching it again;
 * versions between a file's first and latest, oldest first; then latest
 * versions. A file's version from before its conversation first changed it
 * is let go of only when the person agreed to. A version several changes
 * share goes only with the last of them.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FirstWrites } from "./first-writes.js";
import type { FolderCopies } from "./folder-copies.js";
import type { PieceStore } from "./pieces/piece-store.js";
import type { CapturedFile, Manifest } from "./records.js";

export type RecoveryLimits = {
  /** The undo budget: the most room what recovery keeps may take, in bytes. */
  readonly totalBytes: number;
  /**
   * The largest file read to know it again after a shell command whose
   * folder was not watched: such a file keeps no version, only its digest.
   */
  readonly fileBytes: number;
};

/** 50 GB, the most the budget is by default. */
const largestDefault = 50_000_000_000;

/**
 * The budget a person has not set: a tenth of the free space on recovery's
 * drive when recovery is first used, and never more than 50 GB.
 */
export function defaultBudget(freeBytes: number): number {
  return Math.min(largestDefault, Math.floor(freeBytes / 10));
}

/** A version let go of, said in the conversation it belongs to. */
export type ReleasedVersion = {
  readonly conversationId?: string;
  readonly actionId: string;
  readonly path: string;
};

/** What applying the budget reads and changes. */
export type KeptStore = {
  readonly kept: () => Promise<Map<string, Manifest>>;
  readonly budget: number;
  /** Whether an action in this folder is being prepared or awaits its run. */
  readonly inUse: (folder: string) => boolean;
  readonly pieces: PieceStore;
  readonly copies: FolderCopies;
  readonly writes: FirstWrites;
  readonly writeManifest: (folder: string, manifest: Manifest) => Promise<void>;
  /** Contents kept for a capture whose record is not written yet. */
  readonly capturing: ReadonlySet<string>;
};

/** One version as an action keeps it. */
type Entry = {
  readonly folder: string;
  readonly manifest: Manifest;
  readonly file: CapturedFile;
  /** What takes its room: its own copy, or contents in the store of pieces. */
  readonly unit: string;
  readonly bytes: number;
  readonly order: number;
};

/** How readily a version goes: lower first. */
const stages = { between: 1, latest: 2, original: 3 } as const;

const unitOf = (folder: string, file: CapturedFile) =>
  file.content ? `content:${file.content}` : `file:${folder}:${file.backup}`;

/**
 * Applies the budget, sparing `spared`, the action just committed, and the
 * actions in use, and making room for `reserve` bytes more. Lets go of
 * originals only with `originals`. Answers the room left and what went.
 */
export async function applyLimits(
  store: KeptStore,
  spared?: string,
  {
    reserve = 0,
    originals = false,
    purge = false,
  }: {
    readonly reserve?: number;
    readonly originals?: boolean;
    /** Removes what goes from the store's files at once, as deleting a conversation does. */
    readonly purge?: boolean;
  } = {},
): Promise<{ readonly left: number; readonly released: ReleasedVersion[] }> {
  const kept = await store.kept();
  // Saves no run will be weighed from again are in an action's record, or
  // of none.
  const oldest = await store.copies.oldestNeeded();
  await store.writes.forgetBefore(oldest);
  const untouchable = (folder: string) =>
    folder === spared || store.inUse(folder);
  const entries: Entry[] = [];
  let order = 0;
  for (const [folder, manifest] of kept)
    for (const file of manifest.files)
      if (
        file.status === "protected" &&
        (file.backup || file.content) &&
        !file.evicted
      )
        entries.push({
          folder,
          manifest,
          file,
          unit: unitOf(folder, file),
          bytes: file.bytes ?? 0,
          order: order++,
        });
  // Asked of each version the store holds, so the sets it asks stay apart.
  const live = () => {
    const kept = new Set<string>();
    for (const entry of entries)
      if (entry.file.content && !released.has(entry))
        kept.add(entry.file.content);
    const parts: { has(digest: string): boolean }[] = [
      kept,
      store.copies.inUse(),
      store.writes.digests(oldest),
      store.capturing,
      ...mirrored,
    ];
    return { has: (digest: string) => parts.some((part) => part.has(digest)) };
  };
  const released = new Set<Entry>();
  const mirrors = await store.copies.mirrors();
  let mirrored = mirrors.map((mirror) => mirror.digests);
  // Over the budget, what goes leaves the store's files at once, so the room
  // it frees is counted before anything more goes.
  const used = async (compact = false) => {
    await store.pieces.retain(live(), { purge, compact: compact || purge });
    let own = 0;
    for (const entry of entries)
      if (entry.file.backup && !released.has(entry)) own += entry.bytes;
    return (await store.pieces.used()) + own;
  };
  let now = await used();
  const over = () => now + reserve > store.budget;
  const result: ReleasedVersion[] = [];
  if (over()) now = await used(true);
  if (!over()) return { left: store.budget - now, released: result };

  // What was known of a folder only spares watching its files again.
  for (const mirror of [...mirrors].sort((a, b) => a.usedAt - b.usedAt)) {
    if (!over()) break;
    if (mirror.waiting) continue;
    await store.copies.dropMirror(mirror.key);
    mirrored = (await store.copies.mirrors()).map((other) => other.digests);
    now = await used(true);
  }

  // Each file's changes in order, within its conversation: the first is the
  // file as it was before, kept or, for a file the changes made, nothing.
  const changes: { file: CapturedFile; manifest: Manifest; order: number }[] =
    [];
  let seen = 0;
  for (const manifest of kept.values())
    if (manifest.phase === "committed")
      for (const file of manifest.files)
        if (file.status === "protected" || file.evicted)
          changes.push({ file, manifest, order: seen++ });
  changes.sort(
    (a, b) =>
      Date.parse(a.manifest.createdAt) - Date.parse(b.manifest.createdAt) ||
      a.order - b.order,
  );
  const groups = new Map<string, CapturedFile[]>();
  for (const { file, manifest } of changes) {
    const key = [
      manifest.conversationId ?? "",
      manifest.workspaceRoot.toLowerCase(),
      file.path,
    ].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const stageByFile = new Map<CapturedFile, number>();
  for (const versions of groups.values())
    versions.forEach((file, index) =>
      stageByFile.set(
        file,
        index === 0
          ? stages.original
          : index === versions.length - 1
            ? stages.latest
            : stages.between,
      ),
    );
  // A copy of an action still awaiting its run is its file's newest.
  const stageOf = new Map<Entry, number>(
    entries.map((entry) => [
      entry,
      stageByFile.get(entry.file) ?? stages.original,
    ]),
  );
  // A unit goes at the stage of the holder that keeps it longest.
  const holders = new Map<string, Entry[]>();
  for (const entry of entries)
    holders.set(entry.unit, [...(holders.get(entry.unit) ?? []), entry]);
  const units = [...holders]
    .filter(([, held]) => !held.some((entry) => untouchable(entry.folder)))
    .map(([unit, held]) => ({
      unit,
      held,
      stage: Math.max(...held.map((entry) => stageOf.get(entry)!)),
      oldest: Math.min(
        ...held.map((entry) => Date.parse(entry.manifest.createdAt)),
      ),
    }))
    .filter((unit) => originals || unit.stage < stages.original)
    .sort((a, b) => a.stage - b.stage || a.oldest - b.oldest);

  for (const unit of units) {
    if (!over()) break;
    for (const entry of unit.held) {
      released.add(entry);
      result.push({
        ...(entry.manifest.conversationId
          ? { conversationId: entry.manifest.conversationId }
          : {}),
        actionId: entry.manifest.actionId,
        path: entry.file.path,
      });
    }
    now = await used(true);
  }

  // Each record stays without the versions let go of: going back past it
  // still needs to know what each change left.
  const byFolder = new Map<string, Set<Entry>>();
  for (const entry of released)
    byFolder.set(
      entry.folder,
      (byFolder.get(entry.folder) ?? new Set()).add(entry),
    );
  for (const [folder, gone] of byFolder) {
    const manifest = [...gone][0]!.manifest;
    const files = await Promise.all(
      manifest.files.map(async (file) => {
        const entry = [...gone].find((each) => each.file === file);
        if (!entry) return file;
        if (file.backup) await rm(join(folder, file.backup), { force: true });
        return {
          path: file.path,
          status: "unprotected" as const,
          reason:
            "The version kept before this change was let go of to stay within the undo budget.",
          evicted: true as const,
          before: file.before,
          ...(file.beforeDigest ? { beforeDigest: file.beforeDigest } : {}),
          ...(file.after ? { after: file.after } : {}),
          ...(file.afterDigest ? { afterDigest: file.afterDigest } : {}),
        };
      }),
    );
    await store.writeManifest(folder, { ...manifest, files });
  }
  return { left: Math.max(0, store.budget - now), released: result };
}
