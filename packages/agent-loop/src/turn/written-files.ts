import type {
  CommandFileChange,
  CommandFileChanges,
  ProducedFile,
} from "@zhiyin/contract";

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

/**
 * The files a command was seen to create or change, as it left them: what
 * going back weighs to remove the files the removed turns made.
 */
export function changedBy(
  changes: CommandFileChanges | undefined,
): readonly CommandFileChange[] {
  return changes?.status === "checked"
    ? changes.files.filter((file) => file.change !== "deleted")
    : [];
}
