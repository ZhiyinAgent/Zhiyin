/**
 * What a compiled PDF holds, read back from the file: its pages, their size,
 * and text that runs to a page's edge. Typst reports no overflow at all. The
 * PDF keeps the glyphs past an edge, but pdf.js reads back only those whose
 * origin is on the page, so text cut at an edge is found by the glyphs that
 * still reach it. LaTeX's overfull boxes are its own warnings.
 *
 * The PDF carries the workspace's own pictures and fonts through, so it is
 * read where every PDF is read, in a contained process with a time limit
 * (ADR 0019), never in Zhiyin's own.
 */

import { readFile, stat } from "node:fs/promises";

/** One item of a page's text, with where it is drawn, in points. */
export type PlacedText = {
  readonly text: string;
  /** The item's matrix: `a b c d e f`. */
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  /** Its font's reach above and below the baseline, in ems, when known. */
  readonly ascent?: number;
  readonly descent?: number;
};

/**
 * Where a compiled PDF is read back: in the app, the contained process every
 * PDF is read in, handed in by the composition root.
 */
export type CompiledPdfReader = {
  open(bytes: Uint8Array): Promise<
    | {
        readonly ok: true;
        /** Each page's size in points. */
        readonly pages: readonly {
          readonly width: number;
          readonly height: number;
        }[];
        /** The page's box and its placed text, or nothing when unread. */
        placed(page: number): Promise<
          | {
              readonly view: readonly number[];
              readonly items: readonly PlacedText[];
            }
          | undefined
        >;
        close(): void;
      }
    | { readonly ok: false; readonly failure: "unstartable" | "unopenable" }
  >;
};

/** The largest PDF read back; a larger one is reported unread. */
const largestRead = 256 * 1024 * 1024;
/** Pages whose text is checked against their edges. */
const pagesChecked = 500;
/** Pages named with text at an edge; the rest are counted. */
const pagesNamed = 10;

type Side = "left" | "right" | "top" | "bottom";

export type WrittenPdf =
  | {
      readonly ok: true;
      readonly pages: number;
      /** Each size in order of first use, with how many pages have it. */
      readonly sizes: readonly { readonly name: string; count: number }[];
      readonly edges: readonly {
        readonly page: number;
        readonly side: Side;
        readonly text: string;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Text this close to an edge is at it: one millimetre, nearer than a printer
 * prints. Typst's text set with no margin starts on the edge itself.
 */
const nearEdge = 72 / 25.4;
/**
 * A cut that falls in a word space leaves the last glyph read short of the
 * edge by that space, a quarter of the type size in Typst's default font.
 * Measured with Typst 0.15.1: cut lines of 11 and 48 pt text ended at most
 * 0.14 and 0.23 of their size short of the edge, and slides and posters with
 * ordinary margins keep their text farther in than this reach.
 */
const wordSpace = 0.25;

/** Paper sizes by name, in points, portrait. */
const papers: readonly [string, number, number][] = [
  ["A3", 841.89, 1190.55],
  ["A4", 595.28, 841.89],
  ["A5", 419.53, 595.28],
  ["Letter", 612, 792],
  ["Legal", 612, 1008],
];

function sizeName(width: number, height: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  for (const [name, short, long] of papers) {
    if (near(width, short) && near(height, long)) return name;
    if (near(width, long) && near(height, short)) return `${name} landscape`;
  }
  const mm = (points: number) => Math.round((points * 25.4) / 72);
  return `${mm(width)} × ${mm(height)} mm`;
}

/**
 * The sides of the page box `view` that an item of text runs to: its glyphs,
 * from the font's descent to its ascent, come within a millimetre of the edge
 * or cross it, or its line ends within a word space of it. A line whose
 * baseline is past an edge leaves nothing to read.
 */
function sidesReached(item: PlacedText, view: readonly number[]): Side[] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
  const along = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const ascent = (item.ascent ?? (item.height || up) / up) * up;
  const descent = (item.descent ?? 0) * up;
  const forward = [a / along, b / along] as const;
  const upward = [c / up, d / up] as const;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const length of [-wordSpace * up, item.width + wordSpace * up])
    for (const height of [descent, ascent]) {
      xs.push(e + forward[0] * length + upward[0] * height);
      ys.push(f + forward[1] * length + upward[1] * height);
    }
  const [left = 0, bottom = 0, right = 0, top = 0] = view;
  const sides: Side[] = [];
  if (Math.min(...xs) < left + nearEdge) sides.push("left");
  if (Math.max(...xs) > right - nearEdge) sides.push("right");
  if (Math.max(...ys) > top - nearEdge) sides.push("top");
  if (Math.min(...ys) < bottom + nearEdge) sides.push("bottom");
  return sides;
}

function quoted(text: string): string {
  const characters = [...text.trim()];
  return characters.length > 60
    ? `${characters.slice(0, 60).join("")}…`
    : characters.join("");
}

export async function writtenPdf(
  path: string,
  reader: CompiledPdfReader,
): Promise<WrittenPdf> {
  const size = (await stat(path)).size;
  if (size > largestRead)
    return {
      ok: false,
      reason: `it is larger than ${largestRead / 1024 / 1024} MB, the most Zhiyin reads back.`,
    };
  const document = await reader.open(new Uint8Array(await readFile(path)));
  if (!document.ok)
    return {
      ok: false,
      reason:
        document.failure === "unstartable"
          ? "the PDF reader could not be started."
          : "it could not be opened.",
    };
  try {
    const sizes: { name: string; count: number }[] = [];
    const edges: { page: number; side: Side; text: string }[] = [];
    for (let number = 1; number <= document.pages.length; number += 1) {
      const placed =
        number <= pagesChecked ? await document.placed(number) : undefined;
      if (number <= pagesChecked && !placed)
        return { ok: false, reason: `page ${number} could not be read.` };
      // The page's box, as drawn before any turn it is shown with.
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = placed?.view ?? [
        0,
        0,
        document.pages[number - 1]!.width,
        document.pages[number - 1]!.height,
      ];
      const name = sizeName(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const known = sizes.find((entry) => entry.name === name);
      if (known) known.count += 1;
      else sizes.push({ name, count: 1 });
      for (const item of placed?.items ?? []) {
        if (!item.text.trim()) continue;
        for (const side of sidesReached(item, placed!.view))
          if (!edges.some((edge) => edge.page === number && edge.side === side))
            edges.push({ page: number, side, text: quoted(item.text) });
      }
    }
    return { ok: true, pages: document.pages.length, sizes, edges };
  } finally {
    document.close();
  }
}

/** "3 pages, A4", or each size counted when the pages differ. */
export function pagesAndSize(pdf: WrittenPdf & { ok: true }): string {
  const pages = `${pdf.pages} ${pdf.pages === 1 ? "page" : "pages"}`;
  if (pdf.sizes.length === 1) return `${pages}, ${pdf.sizes[0]!.name}`;
  return `${pages} (${pdf.sizes.map((size) => `${size.count} ${size.name}`).join(", ")})`;
}

/** The lines that name text at a page's edge, bounded, with the limits said. */
export function edgeLines(pdf: WrittenPdf & { ok: true }): readonly string[] {
  const lines: string[] = [];
  const pages = [...new Set(pdf.edges.map((edge) => edge.page))];
  if (pages.length) {
    lines.push("Text runs to the edge of a page, where it may be cut off:");
    const named = new Set(pages.slice(0, pagesNamed));
    for (const edge of pdf.edges)
      if (named.has(edge.page))
        lines.push(`page ${edge.page}, ${edge.side} edge: “${edge.text}”`);
    const rest = pages.length - named.size;
    if (rest)
      lines.push(`and on ${rest} more ${rest === 1 ? "page" : "pages"}.`);
  }
  if (pdf.pages > pagesChecked)
    lines.push(
      `Edges were checked on the first ${pagesChecked} of its ${pdf.pages} pages.`,
    );
  return lines;
}
