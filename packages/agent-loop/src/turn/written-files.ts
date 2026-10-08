import type { CommandFileChanges, ProducedFile } from "@zhiyin/contract";

/**
 * The workspace files an action wrote: what it produced, and what a command
 * was seen to create or change. A file it deleted is not among them.
 */
export function writtenFiles(
  produced: readonly ProducedFile[],
  changes: CommandFileChanges | undefined,
): readonly string[] {
  const paths = produced.map((file) => file.path);
  if (changes?.status === "checked")
    for (const file of changes.files)
      if (file.change !== "deleted") paths.push(file.path);
  return [...new Set(paths)];
}
