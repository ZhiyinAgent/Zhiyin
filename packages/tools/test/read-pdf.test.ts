import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";
import { simplePdf } from "./pdf-fixture.js";
import { imageSize } from "../src/image-size.js";

async function workspaceWith(pages: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-pdf-"));
  await writeFile(join(root, "report.pdf"), simplePdf(pages));
  return root;
}

const threePages = [
  "Page one introduces the report",
  "Page two holds the numbers",
  "Page three concludes",
];

describe("reading a PDF", () => {
  it("reads its words rather than refusing it as binary", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_file", { path: "report.pdf" });

    if (!result.ok) throw new Error(result.reason);
    const value = result.value as { text: string; pages: number };
    expect(value.pages).toBe(3);
    expect(value.text).toContain("Page one introduces the report");
    expect(value.text).toContain("Page three concludes");
    // Which page a sentence came from is part of what was read.
    expect(value.text).toMatch(/Page 2/);
  }, 30_000);

  it("reads only the pages it was asked for", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const single = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "2",
    });
    const range = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "2-3",
    });

    if (!single.ok || !range.ok) throw new Error("Both should be readable");
    expect((single.value as { text: string }).text).toContain(
      "Page two holds the numbers",
    );
    expect((single.value as { text: string }).text).not.toContain(
      "Page one introduces",
    );
    expect((range.value as { text: string }).text).toContain(
      "Page three concludes",
    );
    expect((range.value as { text: string }).text).not.toContain(
      "Page one introduces",
    );
  }, 30_000);

  it("says how to ask for the rest when it stops early", async () => {
    const many = Array.from(
      { length: 60 },
      (_, index) => `Page ${index + 1} ${"filler text ".repeat(400)}`,
    );
    const tools = new WorkspaceTools(await workspaceWith(many));

    const result = await tools.execute("read_file", { path: "report.pdf" });

    if (!result.ok) throw new Error(result.reason);
    const value = result.value as {
      text: string;
      pages: number;
      pagesRead: string;
    };
    expect(value.pages).toBe(60);
    // It stopped somewhere short of the end, and says exactly where.
    expect(value.pagesRead).toMatch(/^1-\d+$/);
    expect(value.pagesRead).not.toBe("1-60");
    expect(value.text).toContain("pages");
  }, 60_000);

  it("refuses a page range that is not in the document", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "9-12",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("There is no page 9");
    expect(result.reason).toContain("3");
  }, 30_000);

  it("says a PDF it cannot open is a PDF it cannot open", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-pdf-"));
    await writeFile(
      join(root, "broken.pdf"),
      Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 7)]),
    );
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_file", { path: "broken.pdf" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("A damaged PDF is not readable");
    expect(result.reason).toMatch(/PDF/);
  }, 30_000);

  it("draws the pages as pictures when asked for pictures", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      acceptsImages: () => true,
    });

    const result = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "2",
      as: "image",
    });

    if (!result.ok) throw new Error(result.reason);
    expect(result.images).toHaveLength(1);
    const [picture] = result.images ?? [];
    expect(picture?.mediaType).toBe("image/jpeg");
    // A real page, not a blank one: an empty render would encode to almost
    // nothing, and reading it back is the only way to know the difference.
    expect(Buffer.from(picture?.data ?? "", "base64").length).toBeGreaterThan(
      2000,
    );
    expect(result.value).toMatchObject({ pagesRead: "2", pages: 3 });
  }, 60_000);

  it("draws only as many pages as one answer can carry", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      acceptsImages: () => true,
    });

    const result = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "1-3",
      as: "image",
    });

    if (!result.ok) throw new Error(result.reason);
    expect(result.images).toHaveLength(2);
    // And it says where it stopped, so the rest can be asked for.
    expect(result.value).toMatchObject({ pagesRead: "1-2" });
    expect(JSON.stringify(result.value)).toContain("3");
  }, 60_000);

  it("does not draw pictures for a model that cannot be shown one", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_file", {
      path: "report.pdf",
      pages: "1",
      as: "image",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Nobody could look at it");
    expect(result.reason).toMatch(/cannot be shown/i);
  }, 30_000);

  it("refuses to draw a picture of something that is not a PDF", async () => {
    const root = await workspaceWith(threePages);
    await writeFile(join(root, "notes.md"), "Just words.", "utf8");
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_file", {
      path: "notes.md",
      as: "image",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Only a PDF can be drawn");
    expect(result.reason).toMatch(/PDF/);
  });

  it("tells a scanned document how to be read", async () => {
    const root = await workspaceWith(["", "", ""]);
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_file", { path: "report.pdf" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("There is no text in it");
    expect(result.reason).toContain('as: "image"');
  }, 30_000);

  it("draws a very large page within the size a model will take", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-pdf-"));
    // A page about the size of a poster, where drawing at full scale would go
    // past the pixel limit on its own.
    await writeFile(
      join(root, "poster.pdf"),
      simplePdf(["A poster-sized page"], { width: 3370, height: 2384 }),
    );
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_file", {
      path: "poster.pdf",
      as: "image",
    });

    if (!result.ok) throw new Error(result.reason);
    const drawn = Buffer.from(result.images?.[0]?.data ?? "", "base64");
    const size = imageSize(drawn);
    expect(size).toBeDefined();
    expect(size?.width).toBeLessThanOrEqual(6000);
    expect(size?.height).toBeLessThanOrEqual(6000);
  }, 60_000);
});
