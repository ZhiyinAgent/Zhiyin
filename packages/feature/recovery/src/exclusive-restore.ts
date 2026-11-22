/**
 * Putting one file back, or removing it, while nothing else can write to it.
 *
 * The file is opened so that others may still read it but no one may write
 * to it; its digest is checked on that handle, and the retained copy is
 * swapped in (or the file deleted) while the handle is still held. A file
 * changed after the review, or held open for writing by another program, is
 * left exactly as it is. A file the work deleted is made again, folder and
 * all, only while nothing has taken its place.
 *
 * The Windows calls are made from Zhiyin's own process. A PowerShell script
 * would often take longer to start on an ordinary laptop than a restore is
 * allowed, and rewind would report restorable files as unrestorable.
 */

import { windowsFiles } from "@zhiyin/sandbox";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const MOVEFILE_WRITE_THROUGH = 0x00000008;
const chunkBytes = 1024 * 1024;

export type ExclusiveRestore = {
  readonly absolute: string;
  /** The digest the file must still have, or the restore is refused. */
  readonly expected: string;
  readonly action: "restore" | "remove";
  readonly backup?: string;
  /** The digest the kept copy had when it was made. */
  readonly retained?: string;
};

/** A kept copy that no longer matches what was kept, and is never put back. */
export class DamagedCopyError extends Error {
  constructor() {
    super("The kept copy no longer matches what was kept.");
    this.name = "DamagedCopyError";
  }
}

/** The file operations a restore takes, besides copying and reading. */
export type RecoveryFiles = {
  readonly openShared: (path: string) => unknown;
  readonly read: (handle: unknown, buffer: Buffer) => number;
  readonly close: (handle: unknown) => void;
  readonly replace: (
    target: string,
    replacement: string,
    previous: string,
  ) => boolean;
  readonly remove: (path: string) => boolean;
  /** Moves a file into place, and fails if anything is already there. */
  readonly moveIntoPlace: (from: string, to: string) => boolean;
  /** Puts what was written to a file on disk. */
  readonly flush: (path: string) => Promise<void>;
};

let files: RecoveryFiles | undefined;

/** The Windows calls a restore makes, from Zhiyin's own process. */
export function windowsRecoveryFiles(): RecoveryFiles {
  if (files) return files;
  const windows = windowsFiles();
  files = {
    openShared: (path) =>
      windows.open(
        path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_DELETE,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
      ).handle,
    read: (handle, buffer) => {
      const read = windows.read(handle, buffer);
      if (read === undefined) throw new Error("The file could not be read.");
      return read;
    },
    close: (handle) => windows.close(handle),
    replace: windows.replace,
    remove: windows.remove,
    moveIntoPlace: (from, to) => windows.move(from, to, MOVEFILE_WRITE_THROUGH),
    flush: async (path) => {
      const handle = await open(path, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
  return files;
}

function digestOf(api: RecoveryFiles, handle: unknown): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(chunkBytes);
  for (;;) {
    const read = api.read(handle, buffer);
    if (!read) break;
    hash.update(buffer.subarray(0, read));
  }
  return hash.digest("hex");
}

/**
 * Copies the kept bytes beside the file, refuses a copy that changed, and puts
 * the copy on disk, so a power cut once it has taken the file's place cannot
 * leave the file empty.
 */
async function copyIntact(
  api: RecoveryFiles,
  backup: string,
  temporary: string,
  retained: string | undefined,
): Promise<void> {
  await copyFile(backup, temporary);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(temporary))
    hash.update(chunk as Buffer);
  if (retained !== undefined && hash.digest("hex") !== retained)
    throw new DamagedCopyError();
  await api.flush(temporary);
}

/** Putting a file back and making one again, through the given operations. */
export function exclusiveRecovery(filesOf: () => RecoveryFiles) {
  async function restoreExclusively(target: ExclusiveRestore): Promise<void> {
    const api = filesOf();
    let temporary: string | undefined;
    let previous: string | undefined;
    try {
      if (target.action === "restore") {
        if (!target.backup)
          throw new Error("The retained bytes are unavailable.");
        temporary = `${target.absolute}.${randomUUID().replaceAll("-", "")}.restore`;
        await copyIntact(api, target.backup, temporary, target.retained);
      }
      const handle = api.openShared(target.absolute);
      if (!handle)
        throw new Error(
          "The file is in use and could not be held for recovery.",
        );
      try {
        if (digestOf(api, handle) !== target.expected)
          throw new Error("The file changed while recovery was being applied.");
        if (target.action === "remove") {
          if (!api.remove(target.absolute))
            throw new Error("The file could not be removed.");
        } else {
          previous = `${target.absolute}.${randomUUID().replaceAll("-", "")}.previous`;
          if (!api.replace(target.absolute, temporary as string, previous))
            throw new Error("The retained bytes could not be put in place.");
          temporary = undefined;
        }
      } finally {
        api.close(handle);
      }
    } finally {
      if (temporary) await rm(temporary, { force: true });
      if (previous) await rm(previous, { force: true });
    }
  }

  /** Makes a deleted file again from its retained copy, unless one is back. */
  async function recreateExclusively(target: {
    readonly absolute: string;
    readonly backup: string;
    /** The digest the kept copy had when it was made. */
    readonly retained?: string;
  }): Promise<void> {
    const api = filesOf();
    await mkdir(dirname(target.absolute), { recursive: true });
    let temporary: string | undefined =
      `${target.absolute}.${randomUUID().replaceAll("-", "")}.restore`;
    try {
      await copyIntact(api, target.backup, temporary, target.retained);
      if (!api.moveIntoPlace(temporary, target.absolute))
        throw new Error("Something took the deleted file's place.");
      temporary = undefined;
    } finally {
      if (temporary) await rm(temporary, { force: true });
    }
  }

  /**
   * Puts back files that only work together, all or none. Every kept copy is
   * written beside its file and put on disk first; then every file there is
   * held so that no one may write to it, and its digest checked on that
   * handle; only once all of them are held and match is any put back. One
   * that cannot be put back puts back those already done, from what they
   * held, before the handles are let go of.
   */
  async function restoreGroupExclusively(
    members: readonly GroupMember[],
  ): Promise<GroupOutcome> {
    const api = filesOf();
    const unique = () => randomUUID().replaceAll("-", "");
    const temporaries = new Map<GroupMember, string>();
    const handles: unknown[] = [];
    const undo: (() => void)[] = [];
    const aside: string[] = [];
    try {
      for (const member of members) {
        if (member.action !== "restore") continue;
        if (!member.backup)
          return { ok: false, path: member.absolute, damaged: false };
        const temporary = `${member.absolute}.${unique()}.restore`;
        if (member.expected === "absent")
          await mkdir(dirname(member.absolute), { recursive: true });
        try {
          await copyIntact(api, member.backup, temporary, member.retained);
        } catch (error) {
          await rm(temporary, { force: true });
          return {
            ok: false,
            path: member.absolute,
            damaged: error instanceof DamagedCopyError,
          };
        }
        temporaries.set(member, temporary);
      }
      // Held and checked, every one, before any is touched.
      for (const member of members) {
        if (member.expected === "absent") continue;
        const handle = api.openShared(member.absolute);
        if (!handle) return { ok: false, path: member.absolute, held: true };
        handles.push(handle);
        if (digestOf(api, handle) !== member.expected)
          return { ok: false, path: member.absolute, changed: true };
      }
      for (const member of members) {
        const temporary = temporaries.get(member);
        if (member.expected === "absent") {
          if (!temporary || !api.moveIntoPlace(temporary, member.absolute))
            return { ok: false, path: member.absolute, changed: true };
          temporaries.delete(member);
          undo.push(() => void api.remove(member.absolute));
          continue;
        }
        const previous = `${member.absolute}.${unique()}.previous`;
        if (member.action === "remove") {
          if (!api.moveIntoPlace(member.absolute, previous))
            return { ok: false, path: member.absolute, applied: false };
          aside.push(previous);
          undo.push(() => void api.moveIntoPlace(previous, member.absolute));
          continue;
        }
        if (!api.replace(member.absolute, temporary!, previous))
          return { ok: false, path: member.absolute, applied: false };
        temporaries.delete(member);
        aside.push(previous);
        // Undone by renames: the file it was is still held by this process,
        // which Windows lets be renamed but not be a replacement.
        undo.push(() => {
          const undone = `${member.absolute}.${unique()}.undone`;
          if (!api.moveIntoPlace(member.absolute, undone)) return;
          aside.push(undone);
          api.moveIntoPlace(previous, member.absolute);
        });
      }
      undo.length = 0;
      return { ok: true };
    } finally {
      // What was put back goes back as it was, newest first.
      for (const step of undo.reverse()) step();
      for (const handle of handles) api.close(handle);
      for (const temporary of temporaries.values())
        await rm(temporary, { force: true });
      for (const path of aside) await rm(path, { force: true });
    }
  }

  return { restoreExclusively, recreateExclusively, restoreGroupExclusively };
}

/** One of the files a group puts back together. */
export type GroupMember = {
  readonly absolute: string;
  /** The digest the file must still have, or `absent` when it must not be there. */
  readonly expected: string;
  readonly action: "restore" | "remove";
  readonly backup?: string;
  /** The digest the kept copy had when it was made. */
  readonly retained?: string;
};

/** Whether a group went back, or which file kept it from going back, and why. */
export type GroupOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly path: string;
      /** Its kept copy no longer matches what was kept. */
      readonly damaged?: boolean;
      /** Another program held it open for writing. */
      readonly held?: true;
      /** It changed since the review, or something took its place. */
      readonly changed?: true;
      /** Windows did not put it back. */
      readonly applied?: false;
    };

export const { recreateExclusively } = exclusiveRecovery(windowsRecoveryFiles);
