import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WorkspaceTools,
  type ConversationItems,
  type FileRead,
  type PdfPagesSource,
} from "../src/index.js";
import { simplePdf } from "./pdf-fixture.js";
import { imageSize } from "../src/image-size.js";

async function workspaceWith(pages: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-pdf-"));
  await writeFile(join(root, "report.pdf"), simplePdf(pages));
  return root;
}

function rememberedReads(): ConversationItems {
  const reads = new Map<string, FileRead>();
  return {
    locate: async () => ({ status: "missing", reason: "Not stored." }),
    keepOutput: async () => ({ status: "refused", reason: "Not stored." }),
    lastRead: async (conversationId, path) =>
      reads.get(`${conversationId}/${path}`),
    noteRead: async (conversationId, path, read) => {
      reads.set(`${conversationId}/${path}`, read);
    },
  };
}

const threePages = [
  "Page one introduces the report",
  "Page two holds the numbers",
  "Page three concludes",
];

describe("reading a PDF", () => {
  it("reads its words rather than refusing it as binary", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_document", { path: "report.pdf" });

    if (!result.ok) throw new Error(result.reason);
    const value = result.value as { text: string; pages: number };
    expect(value.pages).toBe(3);
    expect(value.text).toContain("Page one introduces the report");
    expect(value.text).toContain("Page three concludes");
    // Which page a sentence came from is part of what was read.
    expect(value.text).toMatch(/Page 2/);
  }, 30_000);

  it("keeps the line a page breaks a sentence at, so the words either side of it stay apart", async () => {
    const tools = new WorkspaceTools(
      await workspaceWith([
        "The first line of this page runs long enough to wrap onto a second line here.",
      ]),
    );

    const result = await tools.execute("read_document", { path: "report.pdf" });

    if (!result.ok) throw new Error(result.reason);
    expect((result.value as { text: string }).text).toContain(
      "onto a second\nline here.",
    );
  }, 30_000);

  it("reads only the pages it was asked for", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const single = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "2",
    });
    const range = await tools.execute("read_document", {
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

    const result = await tools.execute("read_document", { path: "report.pdf" });

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

  it("reads a list of pages and ranges, in order, and says which it read", async () => {
    const fivePages = [
      "Page one alpha",
      "Page two beta",
      "Page three gamma",
      "Page four delta",
      "Page five epsilon",
    ];
    const tools = new WorkspaceTools(await workspaceWith(fivePages));

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "4, 1,3-4",
    });

    if (!result.ok) throw new Error(result.reason);
    const value = result.value as { text: string; pagesRead: string };
    expect(value.pagesRead).toBe("1, 3-4");
    expect(value.text).toContain("Page one alpha");
    expect(value.text).toContain("Page three gamma");
    expect(value.text).toContain("Page four delta");
    expect(value.text).not.toContain("Page two beta");
    expect(value.text).not.toContain("Page five epsilon");
    expect(value.text.indexOf("alpha")).toBeLessThan(
      value.text.indexOf("gamma"),
    );
  }, 30_000);

  it("reads the pages a document has and names the ones it does not", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "2,7-8",
    });

    if (!result.ok) throw new Error(result.reason);
    const value = result.value as { text: string; pagesRead: string };
    expect(value.pagesRead).toBe("2");
    expect(value.text).toContain("Page two holds the numbers");
    expect(value.text).toContain(
      "This PDF has 3 pages, so pages 7-8 were not read.",
    );
  }, 30_000);

  it("refuses pages it cannot understand, saying what a list looks like", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    for (const pages of ["3-1", "two", "1,,2", "0"]) {
      const result = await tools.execute("read_document", {
        path: "report.pdf",
        pages,
      });
      expect(result).toMatchObject({
        ok: false,
        reason: expect.stringContaining('"2-5,8"'),
      });
    }
  }, 30_000);

  it("draws the pages of a list, two at a time, and says what is left", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      acceptsImages: () => true,
    });

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "1,3",
      as: "image",
    });

    if (!result.ok) throw new Error(result.reason);
    expect(result.images).toHaveLength(2);
    expect(result.value).toMatchObject({ pagesRead: "1, 3" });
    expect(result.value).not.toHaveProperty("truncated");
  }, 60_000);

  it("reads a PDF of several megabytes, and says how large a PDF may be when one is larger", async () => {
    const heavy = Array.from(
      { length: 70 },
      (_, index) => `Page ${index + 1} ${"weighty filler ".repeat(2600)}`,
    );
    const root = await workspaceWith(heavy);
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "2",
    });

    if (!result.ok) throw new Error(result.reason);
    expect((await readFile(join(root, "report.pdf"))).length).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    expect((result.value as { pagesRead: string }).pagesRead).toBe("2");

    await writeFile(
      join(root, "huge.pdf"),
      Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.alloc(51 * 1024 * 1024),
      ]),
    );
    const huge = await tools.execute("read_document", { path: "huge.pdf" });
    expect(huge).toEqual({
      ok: false,
      reason: "This PDF is 51 MB; PDFs up to 50 MB can be read.",
    });
  }, 60_000);

  it("refuses a page range that is not in the document", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages));

    const result = await tools.execute("read_document", {
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

    const result = await tools.execute("read_document", { path: "broken.pdf" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("A damaged PDF is not readable");
    expect(result.reason).toMatch(/PDF/);
  }, 30_000);

  it("draws the pages as pictures when asked for pictures", async () => {
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      acceptsImages: () => true,
    });

    const result = await tools.execute("read_document", {
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

    const result = await tools.execute("read_document", {
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

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "1",
      as: "image",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Nobody could look at it");
    expect(result.reason).toMatch(/cannot be shown/i);
  }, 30_000);

  it("refuses a text file, and says it is read with read_file", async () => {
    const root = await workspaceWith(threePages);
    await writeFile(join(root, "notes.md"), "Just words.", "utf8");
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_document", {
      path: "notes.md",
      as: "image",
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Only a document is read here");
    expect(result.reason).toBe(
      "notes.md is a text file. Read it with read_file.",
    );
  });

  it("tells a scanned document how to be read", async () => {
    const root = await workspaceWith(["", "", ""]);
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_document", { path: "report.pdf" });

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

    const result = await tools.execute("read_document", {
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

  it("says which pages of the document this conversation has read so far", async () => {
    const root = await workspaceWith([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = async (pages: string) => {
      const result = await tools.execute(
        "read_document",
        { path: "report.pdf", pages },
        undefined,
        "conversation-1",
      );
      if (!result.ok) throw new Error(result.reason);
      return result.value as { pagesRead: string; readSoFar?: string };
    };

    expect(await read("1-2")).not.toHaveProperty("readSoFar");
    expect(await read("5")).toMatchObject({
      pagesRead: "5",
      readSoFar: "Pages 1-2, 5 of 6 read in this conversation.",
    });
    expect(await read("3-4")).toMatchObject({
      readSoFar: "Pages 1-5 of 6 read in this conversation.",
    });
  }, 30_000);

  it("starts the count again when the document changed", async () => {
    const root = await workspaceWith(["One", "Two", "Three"]);
    const tools = new WorkspaceTools(root, { items: rememberedReads() });
    const read = async (pages: string) => {
      const result = await tools.execute(
        "read_document",
        { path: "report.pdf", pages },
        undefined,
        "conversation-1",
      );
      if (!result.ok) throw new Error(result.reason);
      return result.value as { readSoFar?: string };
    };

    await read("1");
    await writeFile(
      join(root, "report.pdf"),
      simplePdf(["Uno", "Dos", "Tres", "Cuatro"]),
    );

    expect(await read("2")).not.toHaveProperty("readSoFar");
  }, 30_000);
});

describe("reading a PDF through the pages source it is given", () => {
  /** A source that knows two Letter pages and can read only the first. */
  function source(): { pdfPages: PdfPagesSource; opened: string[] } {
    const opened: string[] = [];
    return {
      opened,
      pdfPages: {
        open: async () => {
          opened.push("open");
          return {
            ok: true,
            pages: [
              { width: 612, height: 792 },
              { width: 612, height: 792 },
            ],
            text: async (page) =>
              page === 1 ? ["Read where ", "it was sent"] : undefined,
            picture: async () => undefined,
            close: () => opened.push("close"),
          };
        },
      },
    };
  }

  it("reads with it, rather than in this process", async () => {
    const { pdfPages, opened } = source();
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      pdfPages,
    });

    const result = await tools.execute("read_document", {
      path: "report.pdf",
      pages: "1",
    });

    if (!result.ok) throw new Error(result.reason);
    expect((result.value as { text: string }).text).toBe(
      "--- Page 1 ---\nRead where it was sent",
    );
    expect(opened).toEqual(["open", "close"]);
  });

  it("says a document it could not read to the end, when a page could not be read in time, and lets it go", async () => {
    const { pdfPages, opened } = source();
    const tools = new WorkspaceTools(await workspaceWith(threePages), {
      pdfPages,
      acceptsImages: () => true,
    });

    await expect(
      tools.execute("read_document", { path: "report.pdf" }),
    ).resolves.toEqual({
      ok: false,
      reason: "This PDF could not be read to the end.",
    });
    await expect(
      tools.execute("read_document", { path: "report.pdf", as: "image" }),
    ).resolves.toEqual({ ok: false, reason: "This PDF could not be drawn." });
    expect(opened).toEqual(["open", "close", "open", "close"]);
  });

  it("says a PDF it could not start a reader for, or open, in the words it always has", async () => {
    const answer = (failure: "unstartable" | "unopenable"): PdfPagesSource => ({
      open: async () => ({ ok: false, failure }),
    });
    const root = await workspaceWith(threePages);

    await expect(
      new WorkspaceTools(root, { pdfPages: answer("unstartable") }).execute(
        "read_document",
        { path: "report.pdf" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "The PDF reader could not be started, so this PDF was not read.",
    });
    await expect(
      new WorkspaceTools(root, { pdfPages: answer("unopenable") }).execute(
        "read_document",
        { path: "report.pdf" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason:
        "This PDF could not be opened. It may be damaged, or protected by a password.",
    });
  });
});
