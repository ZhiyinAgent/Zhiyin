/**
 * The files a run made, delivered to the places that were approved: each
 * only as a plain file of the run's own folder, placed again in case its
 * folder changed, a new one only ever created, and one there replaced only
 * while it is what the approval saw.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProducedFile } from "@zhiyin/contract";
import { contentDigest, replaceFile, type WrittenFiles } from "@zhiyin/files";
import { placedAgain } from "@zhiyin/workspace-containment";
import type { Prepared } from "./call-preparation.js";
import { plainFile, type DrawingAnswer } from "./run-answer.js";
import type { BuildAnswer, Written } from "./wording.js";
import type { Placed } from "./build-record.js";

/** A run's answer that is not a failure: a build's, or a drawing's. */
type Answer =
  | Exclude<BuildAnswer, { readonly failed: string }>
  | Exclude<DrawingAnswer, { readonly failed: string }>;

/**
 * Copies each file the call named from the run's folder `out` into place:
 * what was written, said for the answer and for the conversation, and why
 * each other was not.
 */
export async function delivered(
  root: string,
  out: string,
  prepared: Prepared,
  answer: Answer,
  ownFiles: WrittenFiles,
  protect: readonly string[],
) {
  const written: Written[] = [];
  const notWritten: string[] = [];
  const files: ProducedFile[] = [];
  /** Each file written, for later calls to know as this conversation's own. */
  const mine: string[] = [];
  /** Each file written, where it is and the parts it holds, for later builds to say when those change. */
  const placed: Placed[] = [];
  for (const [index, one] of prepared.exports.entries()) {
    const unwritten = (why: string) =>
      notWritten.push(`${one.relative} was not written: ${why}`);
    // A drawing's files are its own, each said written or why not; a
    // build's say the parts each holds.
    const made =
      "drawing" in answer
        ? { parts: [], ...answer.drawing.outputs[index] }
        : answer.exports[index];
    // Only the file Zhiyin named, and only as a plain file of the run's own.
    const file = made
      ? await plainFile(out, `export-${index}.${one.kind}`, Infinity)
      : undefined;
    if (made && "failed" in made && made.failed) {
      unwritten(made.failed.replace(/\.?$/, "."));
      continue;
    }
    if (!made || !file) {
      unwritten(
        `the ${"drawing" in answer ? "drawing" : "build"} made no such file.`,
      );
      continue;
    }
    // Checked again: during a long build another call may have made a
    // file there, or a link in its folder, that nobody approved. One
    // outside the workspace goes only to the real place approved.
    const now = await placedAgain(root, one, protect);
    if (now === "moved") {
      unwritten("its folder changed while the part was built.");
      continue;
    }
    if (now === "appeared") {
      unwritten(
        "a file appeared there while the part was built. Build again to approve replacing it.",
      );
      continue;
    }
    const changed =
      "it changed while the part was built, so it was not replaced.";
    try {
      await mkdir(dirname(one.absolute), { recursive: true });
      // A file there is replaced only while it is what the approval
      // saw, checked again just before the rename; a new one is only
      // ever created, never written over something that appeared.
      await replaceFile(
        one.absolute,
        { copyOf: file.path },
        one.exists
          ? {
              check: async () => {
                if ((await contentDigest(one.absolute)) !== one.digest)
                  throw new Error(changed);
              },
            }
          : { createOnly: true },
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      unwritten(
        code === "EEXIST"
          ? "a file appeared there while the part was built. Build again to approve replacing it."
          : (error as Error).message === changed
            ? changed
            : `${(error as Error).message}.`,
      );
      continue;
    }
    written.push({
      relative: one.relative,
      bytes: file.bytes,
      parts: made.parts,
      ...("mesh" in made && made.mesh ? { mesh: made.mesh } : {}),
      ...("motion" in made && made.motion ? { motion: made.motion } : {}),
      ...("objects" in made && made.objects ? { objects: made.objects } : {}),
      ...("bom" in made && made.bom ? { bom: made.bom } : {}),
      ...(one.kind === "helpers" ? { helpers: true as const } : {}),
    });
    files.push({
      // One outside the workspace by its whole real path.
      path: one.outside ? one.absolute.replaceAll("\\", "/") : one.relative,
      change: one.exists ? "updated" : "created",
      bytes: file.bytes,
    });
    mine.push(one.absolute);
    placed.push({
      absolute: one.absolute,
      relative: one.relative,
      parts: made.parts,
    });
  }
  await ownFiles.wrote(mine);
  return { written, notWritten, files, placed };
}
