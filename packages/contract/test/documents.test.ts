import { describe, expect, it } from "vitest";
import { namesADocument } from "../src/index.js";

describe("namesADocument", () => {
  it.each([
    "report.pdf",
    "out/Q3 Report.PDF",
    "out\\chart.png",
    "photo.jpeg",
    "photo.jpg",
    "anim.gif",
    "image.webp",
    "scan.bmp",
    "logo.svg",
  ])("offers %s to the panel", (path) => {
    expect(namesADocument(path)).toBe(true);
  });

  it.each([
    "notes.md",
    "report.pdf.exe",
    "pdf",
    ".pdf",
    "folder.pdf/notes.txt",
    "slides.pptx",
  ])("does not offer %s", (path) => {
    expect(namesADocument(path)).toBe(false);
  });
});
