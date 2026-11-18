/** The files the document panel draws, by their extension. */
const documentExtensions = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".mp4",
] as const;

/**
 * Whether a file is one the panel draws, by its name alone: what is written to
 * notes.md is not read to find out it is not a PDF. The drawing side still
 * decides by the file's bytes; this only says which files to offer.
 */
export function namesADocument(path: string): boolean {
  const name = path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
  );
  const dot = name.lastIndexOf(".");
  return (
    dot > 0 &&
    (documentExtensions as readonly string[]).includes(
      name.slice(dot).toLowerCase(),
    )
  );
}
