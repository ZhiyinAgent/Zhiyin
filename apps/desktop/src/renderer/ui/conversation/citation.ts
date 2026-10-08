/**
 * A citation the agent wrote in an answer: a Markdown link to a workspace
 * document, at a page (ADR 0018). `[page 24](reports/q3.pdf#page=24)` cites
 * page 24; a picture is cited by its path alone. `#page=N` is RFC 8118's
 * fragment for a PDF, counting the first page as 1, as the panel does.
 *
 * Only a relative path inside the folder that names a document is a citation.
 * Everything else stays as the answer drew it. The core still decides: it
 * refuses a path outside the conversation's folder, or a page the document
 * does not have.
 */

import { createContext } from "react";
import { namesADocument } from "@zhiyin/contract";

export type DocumentCitation = {
  readonly path: string;
  readonly page?: number;
};

/** Opens a cited document beside the conversation, at its page. */
export const OpenCitation = createContext<
  ((path: string, page?: number) => void) | undefined
>(undefined);

export function documentCitation(
  href: string | undefined,
): DocumentCitation | undefined {
  if (!href) return undefined;
  const hash = href.indexOf("#");
  const encoded = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? "" : href.slice(hash + 1);
  // A scheme, a drive, a query, or a path from the root is not a citation.
  if (/[:?]/.test(encoded) || /^[\\/]/.test(encoded)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (!path || path.split(/[\\/]/).includes("..") || !namesADocument(path))
    return undefined;
  if (!fragment) return { path };
  const page = fragment
    .split(/[&#]/)
    .map((parameter) => /^page=(\d+)$/.exec(parameter)?.[1])
    .find((value) => value !== undefined);
  if (page === undefined || Number(page) < 1) return undefined;
  return { path, page: Number(page) };
}
