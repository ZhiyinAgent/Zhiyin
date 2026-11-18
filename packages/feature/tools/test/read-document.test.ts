import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type { WorkspaceTools } from "../src/index.js";
import { ToolsDecodingHere } from "./decoding-here.js";
import { simplePdf } from "./pdf-fixture.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** A one-pixel PNG, so the bytes are a real picture rather than a stand-in. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function folder(): Promise<string> {
  const root = await folders.make("zhiyin-documents-");
  await writeFile(join(root, "report.pdf"), simplePdf(["One", "Two", "Three"]));
  await writeFile(join(root, "chart.png"), png);
  await writeFile(join(root, "notes.md"), "Just words.", "utf8");
  // An Office file is a zip archive inside.
  await writeFile(
    join(root, "budget.xlsx"),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
  );
  return root;
}

const specOf = (tools: WorkspaceTools, name: string) =>
  tools.list().find((tool) => tool.name === name);

describe("the tools that read", () => {
  it("offer read_document, in the words held for it", async () => {
    const tools = new ToolsDecodingHere(await folder(), {
      acceptsImages: () => true,
    });
    const names = tools.list().map((tool) => tool.name);
    expect(names).toContain("read_document");
    expect(names).not.toContain("read_image");

    const spec = specOf(tools, "read_document");
    expect(spec?.description).toBe(
      "Read one document — a PDF, or a picture (PNG, JPEG, WebP, GIF or BMP) — and show it to the person beside the conversation, at the first page you read. A video (.mp4) Zhiyin's 3D studio rendered is shown there too, for the person to play; you are not sent its frames. Use read_file for text files. A workspace-relative path reads a document in the current workspace; an absolute path may read one elsewhere on this computer, which the person is asked about first, and is not shown. `attachment://<id>` looks again at a picture the person attached. A long PDF is read a stretch of pages at a time. PDFs up to 50 MB and pictures under 3 MB can be read. To point the person at the page your answer rests on, read that page. The space beside the conversation shows one thing at a time: the browser or a document. A document you write is shown there too. When you cite a page of a workspace document, write the citation as a Markdown link to the document's workspace path ending in #page=N, like [page 24](reports/q3.pdf#page=24), or to a picture's path with no page, and write a space in the path as %20; the person opens it beside the conversation by clicking it. If the person is looking at something they chose during this turn, it may stay as they chose; the result says what they see.",
    );
    expect(spec?.inputSchema).toMatchObject({
      properties: {
        path: {
          description:
            "Workspace-relative path of the document, an absolute path for one outside the workspace, or an attachment:// id.",
        },
        pages: {
          description:
            'PDF only: which pages to read, as "4", "2-9" or a list like "2-5,8". Defaults to as many as fit from the first page. The first page read is the one shown.',
        },
        as: {
          description:
            'PDF only: "text" reads the words, and is the default. "image" draws the pages for you to look at, for a scanned document or one whose layout matters. Two pages at a time.',
        },
      },
      required: ["path"],
    });
  });

  it("offer read_document to a model that cannot see pictures, for a PDF's words", async () => {
    const tools = new ToolsDecodingHere(await folder());
    expect(tools.list().map((tool) => tool.name)).toContain("read_document");
    const read = await tools.execute("read_document", { path: "report.pdf" });
    expect(read).toMatchObject({ ok: true, value: { pagesRead: "1-3" } });
  });

  it("say read_file and read_files read text, and send documents to read_document", async () => {
    const tools = new ToolsDecodingHere(await folder());
    for (const name of ["read_file", "read_files"])
      expect(
        specOf(tools, name)?.description.endsWith(
          "PDFs and pictures are read with read_document.",
        ),
      ).toBe(true);
    expect(JSON.stringify(specOf(tools, "read_file")?.inputSchema)).not.toMatch(
      /"pages"|"as"/,
    );
  });

  it("name read_document, and no other tool, wherever they tell the model how to read a PDF", async () => {
    const tools = new ToolsDecodingHere(await folder(), {
      acceptsImages: () => true,
    });
    const sentences = tools
      .list()
      .flatMap((tool) =>
        tool.description.split(/(?<=\.)\s+/).map((text) => ({
          tool: tool.name,
          text,
        })),
      )
      .filter(({ text }) => /\bPDFs?\b/.test(text) && /\bread_\w+/.test(text));

    expect(sentences.length).toBeGreaterThan(0);
    for (const { tool, text } of sentences)
      expect({ tool, readers: text.match(/\bread_\w+/g) }).toEqual({
        tool,
        readers: ["read_document"],
      });
  });
});

describe("read_file and read_files", () => {
  it("refuse a PDF or a picture by naming read_document", async () => {
    const tools = new ToolsDecodingHere(await folder());

    expect(await tools.execute("read_file", { path: "report.pdf" })).toEqual({
      ok: false,
      reason: "report.pdf is a PDF document. Read it with read_document.",
    });
    expect(await tools.execute("read_file", { path: "chart.png" })).toEqual({
      ok: false,
      reason: "chart.png is a PNG image. Read it with read_document.",
    });
    const batch = await tools.execute("read_files", {
      paths: ["notes.md", "report.pdf"],
    });
    expect(JSON.stringify(batch)).toContain(
      "report.pdf is a PDF document. Read it with read_document.",
    );
    expect(JSON.stringify(batch)).toContain("Just words.");
  });
});

describe("read_document", () => {
  it("names the workspace document it reads, and the first page it reads, to be shown", async () => {
    const tools = new ToolsDecodingHere(await folder(), {
      acceptsImages: () => true,
    });

    expect(
      await tools.inspect("read_document", { path: "report.pdf" }),
    ).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ reads: "workspace" }),
      document: { path: "report.pdf", page: 1 },
    });
    expect(
      await tools.inspect("read_document", {
        path: "report.pdf",
        pages: "8,2-5",
      }),
    ).toMatchObject({ document: { path: "report.pdf", page: 2 } });
    const picture = await tools.inspect("read_document", {
      path: "./chart.png",
    });
    expect(picture).toMatchObject({ document: { path: "chart.png" } });
    expect(picture.ok && picture.document?.page).toBeUndefined();
  });

  it("names nothing to show for a file outside the workspace or a picture the person attached", async () => {
    const tools = new ToolsDecodingHere(await folder(), {
      acceptsImages: () => true,
    });

    const outside = await tools.inspect("read_document", {
      path: "../elsewhere/report.pdf",
    });
    expect(outside).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ reads: "elsewhere" }),
    });
    expect(outside.ok && outside.document).toBeUndefined();
    const attached = await tools.inspect("read_document", {
      path: "attachment://shot",
    });
    expect(attached.ok && attached.document).toBeUndefined();
  });

  it("shows a video to the person, says it is one, and sends none of its frames", async () => {
    const root = await folder();
    // An MP4 begins with its file-type box.
    await writeFile(
      join(root, "engine.mp4"),
      Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from("ftypisom"),
        Buffer.alloc(64),
      ]),
    );
    const tools = new ToolsDecodingHere(root, { acceptsImages: () => true });

    const inspected = await tools.inspect("read_document", {
      path: "engine.mp4",
    });
    expect(inspected.ok && inspected.document).toEqual({ path: "engine.mp4" });
    const read = await tools.execute("read_document", { path: "engine.mp4" });
    expect(read).toMatchObject({
      ok: true,
      value: {
        path: "engine.mp4",
        kind: "video",
        note: "A video: the person can play it beside the conversation. Its frames are not sent to you.",
      },
    });
    expect(read.ok && read.images).toBeUndefined();
  });

  it("refuses a file named as a video that is not one", async () => {
    const root = await folder();
    await writeFile(join(root, "fake.mp4"), "not a video at all");
    const tools = new ToolsDecodingHere(root, { acceptsImages: () => true });
    expect(await tools.execute("read_document", { path: "fake.mp4" })).toEqual({
      ok: false,
      reason: "fake.mp4 is a text file. Read it with read_file.",
    });
  });

  it("refuses a Word, Excel or PowerPoint file, saying Zhiyin does not read them", async () => {
    const tools = new ToolsDecodingHere(await folder());
    expect(
      await tools.execute("read_document", { path: "budget.xlsx" }),
    ).toEqual({
      ok: false,
      reason:
        "budget.xlsx is an Excel workbook. Zhiyin reads PDFs and pictures, not Word, Excel or PowerPoint files.",
    });
  });
});

describe("close_document", () => {
  it("is offered in the words held for it, with no inputs", async () => {
    const tools = new ToolsDecodingHere(await folder());
    const spec = specOf(tools, "close_document");
    expect(spec?.description).toBe(
      "Close the document shown beside the conversation. Use it once the person no longer needs to look at it, for example when you move on to other work. Do not close it to give your answer: leave open the page your answer rests on, so the person can check it. The file is not changed. If the person chose what that space shows during this turn, it stays as they chose and the result says so.",
    );
    expect(spec?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  it("says it is the conversation's own, so no specialist is offered it", async () => {
    const tools = new ToolsDecodingHere(await folder());
    expect(specOf(tools, "close_document")?.conversationOnly).toBe(true);
  });

  it("reads as Close document, changes nothing, and says it closes the document", async () => {
    const tools = new ToolsDecodingHere(await folder());
    expect(await tools.inspect("close_document", {})).toMatchObject({
      ok: true,
      action: "Close document",
      effects: expect.objectContaining({ changes: "none" }),
      closesDocument: true,
    });
    expect(await tools.execute("close_document", {})).toMatchObject({
      ok: true,
    });
  });
});
