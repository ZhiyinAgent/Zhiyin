import { describe, expect, it } from "vitest";
import type { DocumentPanelState } from "@zhiyin/contract";
import { documentShape } from "./documentShape.js";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;

const portrait = { width: 612, height: 792 };
const landscape = { width: 960, height: 540 };

function shown(
  name: string,
  pages: readonly { width: number; height: number }[],
  kind: "pdf" | "picture" = "pdf",
): Opened {
  return {
    path: `reports/${name}`,
    name,
    folder: "reports",
    status: "shown",
    documents: [],
    revision: "r1",
    kind,
    pages,
    openable: true,
  };
}

const opening = (name: string): Opened => ({
  path: name,
  name,
  folder: "",
  status: "opening",
  documents: [],
});

/** Which documents get the tall layout, decided by their pages. */
describe("the shape of a document", () => {
  it("is tall for portrait pages, with the first portrait page's proportions", () => {
    expect(documentShape(shown("q3.pdf", [portrait, portrait]))).toEqual({
      tall: true,
      aspect: 612 / 792,
    });
  });

  it("is wide for landscape pages, as slides and sheets are", () => {
    expect(documentShape(shown("deck.pdf", [landscape, landscape]))).toEqual({
      tall: false,
    });
  });

  it("follows most of its pages when they are mixed, and does not change page by page", () => {
    expect(
      documentShape(shown("report.pdf", [portrait, landscape, portrait])),
    ).toEqual({ tall: true, aspect: 612 / 792 });
    expect(
      documentShape(shown("deck.pdf", [portrait, landscape, landscape])),
    ).toEqual({ tall: false });
  });

  it("goes by its first page when the orientations are even", () => {
    expect(documentShape(shown("a.pdf", [portrait, landscape]))).toEqual({
      tall: true,
      aspect: 612 / 792,
    });
    expect(documentShape(shown("b.pdf", [landscape, portrait]))).toEqual({
      tall: false,
    });
  });

  it("judges a picture by its own shape", () => {
    expect(
      documentShape(
        shown("poster.png", [{ width: 400, height: 900 }], "picture"),
      ),
    ).toEqual({ tall: true, aspect: 400 / 900 });
    expect(
      documentShape(
        shown("chart.png", [{ width: 520, height: 260 }], "picture"),
      ),
    ).toEqual({ tall: false });
  });

  it("goes by its name while its pages are not known yet", () => {
    expect(documentShape(opening("q3.pdf"))).toEqual({ tall: true });
    expect(documentShape(opening("Brief.DOCX"))).toEqual({ tall: true });
    expect(documentShape(opening("deck.pptx"))).toEqual({ tall: false });
    expect(documentShape(opening("chart.png"))).toEqual({ tall: false });
  });
});
