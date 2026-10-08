/**
 * What a file is, decided by its bytes, and the limits on drawing it.
 */

import { extname } from "node:path";

/** A file past this is not drawn. */
export const maximumDocumentBytes = 100 * 1024 * 1024;
/** A PDF with more pages than this is not drawn. */
export const maximumDocumentPages = 2000;

export type FileKind =
  | { readonly kind: "pdf" }
  | { readonly kind: "picture" }
  | { readonly kind: "svg" }
  | { readonly kind: "other" };

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

/**
 * A path is chosen by whoever wrote it, so an extension is a claim; the head
 * of the file says what it is. A PDF may carry a little junk before its
 * header, as readers accept.
 */
export function kindOf(head: Uint8Array): FileKind {
  const text = Buffer.from(head.subarray(0, 1024)).toString("latin1");
  if (text.includes("%PDF-")) return { kind: "pdf" };
  if (
    startsWith(head, 0x89, 0x50, 0x4e, 0x47) ||
    startsWith(head, 0xff, 0xd8, 0xff) ||
    startsWith(head, 0x47, 0x49, 0x46, 0x38) ||
    (startsWith(head, 0x52, 0x49, 0x46, 0x46) &&
      Buffer.from(head.subarray(8, 12)).toString("latin1") === "WEBP") ||
    startsWith(head, 0x42, 0x4d)
  )
    return { kind: "picture" };
  // A comment's body is anything but its end, so comments read only one way.
  if (
    /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*<svg[\s>]/i.test(
      text,
    )
  )
    return { kind: "svg" };
  return { kind: "other" };
}

const openableExtensions = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

/**
 * Whether Windows' own app may be asked to open a file: documents and
 * pictures only. Anything Windows could run is never offered, whatever else
 * its name says.
 */
export function mayOpenInItsOwnApp(path: string): boolean {
  return openableExtensions.has(extname(path).toLowerCase());
}
