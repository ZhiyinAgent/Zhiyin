import type { DocumentPanelState } from "@zhiyin/contract";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;

/**
 * Whether a document gets the tall layout beside the conversation, and the
 * proportions its space is sized to.
 *
 * Decided once per document, by most of its pages, so the space does not move
 * while the person scrolls; an even split goes by the first page. Before the
 * pages are known, the name decides, so the width does not jump when they
 * arrive. A picture is judged by its own shape.
 */
export function documentShape(document: Opened): {
  readonly tall: boolean;
  readonly aspect?: number;
} {
  const pages = document.status === "shown" ? document.pages : [];
  if (!pages.length) return { tall: /\.(pdf|docx)$/i.test(document.name) };
  const isPortrait = (page: { width: number; height: number }) =>
    page.height > page.width;
  const portraits = pages.filter(isPortrait).length;
  const others = pages.length - portraits;
  const tall =
    portraits > others || (portraits === others && isPortrait(pages[0]!));
  const first = pages.find(isPortrait);
  return tall && first
    ? { tall, aspect: first.width / first.height }
    : { tall: false };
}
