/**
 * The files a run made, delivered: each file staged for outside the
 * workspace put where the approval placed it, each folder a script wrote
 * outside moved into place, and every file written said for the conversation
 * and recorded as this conversation's own.
 */

import { stat } from "node:fs/promises";
import type { ProducedFile } from "@zhiyin/contract";
import type { WrittenFiles } from "@zhiyin/files";
import { moveStagedFolder, placeStaged } from "./outside-writes.js";
import type { Written } from "./paths.js";
import type { Prepared } from "./prepared-call.js";
import type { RunFolders } from "./scene-run.js";

export type Delivered = {
  /** What the answer says of each file not put in place, and of each folder moved. */
  readonly said: readonly string[];
  /** The files the call wrote that are in place. */
  readonly placed: readonly Written[];
  /**
   * Each file written, by where it is: its workspace path, or outside, its
   * whole real path.
   */
  readonly files: readonly ProducedFile[];
  /** Whether a file Blender wrote was not put in place. */
  readonly unwritten: boolean;
};

async function produced(written: readonly Written[]): Promise<ProducedFile[]> {
  const files: ProducedFile[] = [];
  for (const file of written) {
    const status = await stat(file.absolute).catch(() => undefined);
    if (status?.isFile())
      files.push({
        path: file.relative,
        change: file.exists ? "updated" : "created",
        bytes: status.size,
      });
  }
  return files;
}

/** Delivers what a finished run of `prepared` made, while its staging folder still holds it. */
export async function delivered(options: {
  readonly run: RunFolders;
  readonly prepared: Prepared;
  readonly root: string;
  readonly protect: readonly string[];
  readonly held: ((path: string) => Promise<boolean>) | undefined;
  readonly ownFiles: WrittenFiles;
}): Promise<Delivered> {
  const { run, prepared, root, protect } = options;
  const written = prepared.written ?? [];
  const said: string[] = [];
  const placed: Written[] = written.filter((file) => !file.outside);
  const moved: ProducedFile[] = [];
  let unwritten = false;
  for (const [index, file] of written.entries()) {
    const from = run.staged[index];
    if (!from) continue;
    const why = await placeStaged(from, file, root, protect);
    if (why) {
      unwritten = true;
      said.push(
        `Blender wrote it, but it was not put in ${file.relative}: ${why}`,
      );
    } else placed.push(file);
  }
  for (const one of run.folders) {
    const move = await moveStagedFolder(
      one.staging,
      one.folder,
      root,
      protect,
      options.held,
    );
    if (move.moved.length)
      said.push(
        `Moved into ${one.folder}: ${move.moved.map((file) => file.absolute.slice(one.folder.length + 1)).join(", ")}.`,
      );
    for (const refused of move.refused)
      said.push(
        `Not moved into ${one.folder}: ${refused.path}, as ${refused.why}`,
      );
    for (const file of move.moved)
      moved.push({
        path: file.absolute,
        change: file.created ? "created" : "updated",
        bytes: file.bytes,
      });
  }
  const files = [...(await produced(placed)), ...moved];
  await options.ownFiles.wrote([
    ...placed
      .filter((file) => files.some((one) => one.path === file.relative))
      .map((file) => file.absolute),
    ...moved.map((file) => file.path),
  ]);
  return { said, placed, files, unwritten };
}
