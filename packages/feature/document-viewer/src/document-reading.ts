/**
 * Reading a document to draw: its bytes, what they are, and the revision that
 * names them. A file past the size limit is refused before it is read.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { kindOf, maximumDocumentBytes } from "./document-files.js";
import { sentences } from "./document-sentences.js";

export type DocumentBytes = {
  readonly bytes: Buffer;
  readonly kind: "pdf" | "picture" | "svg";
  /** Names the bytes, so two reads of the same file share one. */
  readonly revision: string;
};

/** The document's bytes, or why it cannot be drawn, as the panel says it. */
export async function readDocument(
  path: string,
  name: string,
): Promise<DocumentBytes | { readonly reason: string }> {
  let bytes: Buffer;
  try {
    const { size } = await stat(path);
    if (size > maximumDocumentBytes)
      return { reason: sentences.tooLarge(name, size) };
    bytes = await readFile(path);
  } catch {
    return { reason: sentences.unreadable(name) };
  }
  const { kind } = kindOf(bytes);
  if (kind === "other") return { reason: sentences.other(name) };
  const revision = createHash("sha256")
    .update(bytes)
    .digest("hex")
    .slice(0, 24);
  return { bytes, kind, revision };
}
