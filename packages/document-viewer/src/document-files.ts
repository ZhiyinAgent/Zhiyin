/**
 * What a file is, decided by its bytes, and the limits on drawing it.
 */

import { extname } from "node:path";
import { fileKind, pdfDocument } from "@zhiyin/file-kinds";
import { svgProlog } from "./svg-size.js";

/** A file past this is not drawn. */
export const maximumDocumentBytes = 100 * 1024 * 1024;
/** A PDF with more pages than this is not drawn. */
export const maximumDocumentPages = 2000;

export type FileKind =
  | { readonly kind: "pdf" }
  | { readonly kind: "picture" }
  | { readonly kind: "svg" }
  | { readonly kind: "other" };

/** An SVG's head, read as latin1, so a UTF-8 byte-order mark is three characters. */
const svgHead = new RegExp(
  String.raw`^(?:\xef\xbb\xbf)?${svgProlog}<svg[\s>]`,
  "i",
);

/**
 * A path is chosen by whoever wrote it, so an extension is a claim; the head
 * of the file says what it is, as it does to the agent's file tools.
 */
export function kindOf(head: Uint8Array): FileKind {
  const known = fileKind(head);
  if (known.kind === "binary" && known.named === pdfDocument)
    return { kind: "pdf" };
  if (known.kind === "binary" && known.mediaType) return { kind: "picture" };
  const text = Buffer.from(head.subarray(0, 1024)).toString("latin1");
  if (svgHead.test(text)) return { kind: "svg" };
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
