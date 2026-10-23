/**
 * A document shown beside a conversation is drawn by the built app in a
 * process of its own (ADR 0023): the drawing script, pdf.js and the
 * canvas all have to load there, outside the test runner's own modules, and
 * pages have to cross back to the window as PNGs.
 */

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { emptyConversationLists } from "@zhiyin/contract";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
} from "./launch.js";

const run = promisify(execFile);

const folders = new TemporaryFolders();
// The app holds the files it opened until it has closed.
afterEach(async () => {
  await closeEverything();
  await folders.removeAll();
});

/**
 * A one-page PDF, 612 by 792 points, with a line of text on it, and an image
 * drawn 200 points square below it when one is given.
 */
function onePagePdf(image?: {
  readonly dictionary: string;
  readonly data: Buffer;
}): Buffer {
  const text = image
    ? "BT /F1 24 Tf 72 692 Td (Scanned) Tj ET\nq 200 0 0 200 72 300 cm /Im1 Do Q"
    : "BT /F1 24 Tf 72 692 Td (Quarterly report) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${image ? " /XObject << /Im1 6 0 R >>" : ""} >> /Contents 5 0 R >>`,
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    ...(image
      ? [
          `<< ${image.dictionary} /Length ${image.data.length} >>\nstream\n${image.data.toString("latin1")}\nendstream`,
        ]
      : []),
  ];
  return written(objects);
}

/**
 * A page with 中文 on it in large type, set in a standard Chinese font the
 * file names without embedding.
 */
function chinesePdf(): Buffer {
  const text = "BT /F1 96 Tf 72 600 Td <4E2D6587> Tj ET";
  return written([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
  ]);
}

/** A PDF of these objects, numbered from 1, the first its catalog. */
function written(objects: readonly string[]): Buffer {
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * A scanned page: a black square 16 pixels on a side, coded as office scanners
 * code one, CCITT group 4 fax. The first row says "no white, then 16 black"
 * against the white row a scan starts from; every later row says "same changes
 * as the row above"; the block ends with its end-of-block code.
 */
function scannedPdf(): Buffer {
  const side = 16;
  let bits =
    "001" +
    "00110101" +
    "0000010111" +
    "11".repeat(side - 1) +
    "000000000001".repeat(2);
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
  const data = Buffer.from(
    Array.from({ length: bits.length / 8 }, (_, index) =>
      parseInt(bits.slice(index * 8, index * 8 + 8), 2),
    ),
  );
  return onePagePdf({
    dictionary: `/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${side} /Rows ${side} >>`,
    data,
  });
}

function oneConversationIn(folder: string): string {
  return JSON.stringify({
    preferences: { onboarded: true, interests: [] },
    recentWorkspaces: [],
    selectedTaskId: "doc-task",
    tasks: [
      {
        ...emptyConversationLists,
        id: "doc-task",
        title: "Read the report",
        titleSource: "generated",
        updatedAt: "2026-10-03T09:00:00.000Z",
        updatedLabel: "Now",
        workspace: { path: folder, name: "work" },
        messages: [
          { id: "m0", role: "user", text: "Read the report", sequence: 0 },
        ],
        artifacts: [
          {
            path: "report.pdf",
            name: "report.pdf",
            change: "created",
            bytes: 640,
            updatedAt: "2026-10-03T09:00:00.000Z",
          },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Done", summary: "Done." },
        },
      },
    ],
  } satisfies SavedWorkspace);
}

/** How many pixels of a PNG data URL are nearly black. */
async function darkPixels(data: string): Promise<number> {
  const image = await loadImage(
    Buffer.from(data.slice(data.indexOf(",") + 1), "base64"),
  );
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data: rgba } = context.getImageData(0, 0, image.width, image.height);
  let dark = 0;
  for (let index = 0; index < rgba.length; index += 4)
    if (rgba[index]! + rgba[index + 1]! + rgba[index + 2]! < 192) dark++;
  return dark;
}

/** Electron's utility processes under one main process, by pid. */
async function utilityProcessesOf(owner: number): Promise<Set<number>> {
  const { stdout } = await run(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${owner}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const rows: unknown = stdout.trim() ? JSON.parse(stdout) : [];
  return new Set(
    (Array.isArray(rows) ? rows : [rows])
      .map((row) => row as { ProcessId?: number; CommandLine?: string | null })
      .filter((row) => (row.CommandLine ?? "").includes("--type=utility"))
      .map((row) => row.ProcessId ?? 0),
  );
}

type Bridge = {
  onAppEvent(handler: (event: unknown) => void): () => void;
  showDocument(taskId: string, path: string): Promise<unknown>;
  drawDocumentPage(
    taskId: string,
    revision: string,
    page: number,
    width: number,
  ): Promise<{ ok: boolean; data?: string; width?: number; height?: number }>;
  closeDocument(taskId: string): Promise<void>;
};

describe("a document beside a conversation", () => {
  it("is drawn by the built app in a process of its own, which ends when the document closes", async () => {
    const folder = await folders.make("zhiyin-documents-");
    await writeFile(join(folder, "report.pdf"), onePagePdf());
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversationIn(folder));

    const launched = await launch({ dataDirectory });
    await shows(
      launched.window.getByText("Read the report").first(),
      "the restored conversation",
    );
    const electron = await launched.app.evaluate(() => process.pid);
    const before = await utilityProcessesOf(electron);

    // Through the window's own bridge, as the panel asks.
    const drawn = await launched.window.evaluate(async () => {
      const bridge = (window as unknown as { zhiyin: Bridge }).zhiyin;
      const documents: {
        status: string;
        revision?: string;
        pages?: unknown[];
      }[] = [];
      const stop = bridge.onAppEvent((event) => {
        const { kind, data } = event as {
          kind: string;
          data: { document: (typeof documents)[number] };
        };
        if (kind === "documentChanged") documents.push(data.document);
      });
      const outcome = await bridge.showDocument("doc-task", "report.pdf");
      const shown = documents.findLast((item) => item.status === "shown");
      const page = shown?.revision
        ? await bridge.drawDocumentPage("doc-task", shown.revision, 1, 408)
        : undefined;
      stop();
      return {
        outcome,
        pages: shown?.pages,
        page,
      };
    });

    expect(drawn).toMatchObject({
      outcome: { ok: true },
      pages: [{ width: 816, height: 1056 }],
      page: { ok: true, width: 408, height: 528 },
    });
    // The line of text is on the page: the standard fonts were found and the
    // page is not a blank one standing in for a failure.
    const data = drawn.page?.data ?? "";
    expect(data.startsWith("data:image/png;base64,")).toBe(true);
    expect(await darkPixels(data)).toBeGreaterThan(200);
    const drawing = [...(await utilityProcessesOf(electron))].filter(
      (pid) => !before.has(pid),
    );
    expect(drawing).toHaveLength(1);

    await launched.window.evaluate(() =>
      (window as unknown as { zhiyin: Bridge }).zhiyin.closeDocument(
        "doc-task",
      ),
    );
    const deadline = Date.now() + 10_000;
    while (
      Date.now() < deadline &&
      (await utilityProcessesOf(electron)).has(drawing[0]!)
    )
      await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await utilityProcessesOf(electron)).has(drawing[0]!)).toBe(false);
  });

  it("draws a scanned page's image, decoded by the decoders that ship with the built app", async () => {
    const folder = await folders.make("zhiyin-documents-");
    await writeFile(join(folder, "scan.pdf"), scannedPdf());
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversationIn(folder));

    const launched = await launch({ dataDirectory });
    await shows(
      launched.window.getByText("Read the report").first(),
      "the restored conversation",
    );
    const drawn = await launched.window.evaluate(async () => {
      const bridge = (window as unknown as { zhiyin: Bridge }).zhiyin;
      const documents: { status: string; revision?: string }[] = [];
      const stop = bridge.onAppEvent((event) => {
        const { kind, data } = event as {
          kind: string;
          data: { document: (typeof documents)[number] };
        };
        if (kind === "documentChanged") documents.push(data.document);
      });
      await bridge.showDocument("doc-task", "scan.pdf");
      const shown = documents.findLast((item) => item.status === "shown");
      const page = shown?.revision
        ? await bridge.drawDocumentPage("doc-task", shown.revision, 1, 408)
        : undefined;
      stop();
      return page;
    });

    expect(drawn).toMatchObject({ ok: true, width: 408, height: 528 });
    // The square is about 133 pixels on a side at this width; the line of
    // text alone is a few hundred dark pixels.
    expect(await darkPixels(drawn?.data ?? "")).toBeGreaterThan(15_000);
  });

  it("draws Chinese text in a font the file does not embed, with the font that ships with the built app", async () => {
    const folder = await folders.make("zhiyin-documents-");
    await writeFile(join(folder, "report.pdf"), chinesePdf());
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversationIn(folder));

    const launched = await launch({ dataDirectory });
    await shows(
      launched.window.getByText("Read the report").first(),
      "the restored conversation",
    );
    const drawn = await launched.window.evaluate(async () => {
      const bridge = (window as unknown as { zhiyin: Bridge }).zhiyin;
      const documents: { status: string; revision?: string }[] = [];
      const stop = bridge.onAppEvent((event) => {
        const { kind, data } = event as {
          kind: string;
          data: { document: (typeof documents)[number] };
        };
        if (kind === "documentChanged") documents.push(data.document);
      });
      await bridge.showDocument("doc-task", "report.pdf");
      const shown = documents.findLast((item) => item.status === "shown");
      const page = shown?.revision
        ? await bridge.drawDocumentPage("doc-task", shown.revision, 1, 408)
        : undefined;
      stop();
      return page;
    });

    expect(drawn).toMatchObject({ ok: true, width: 408, height: 528 });
    // Drawn with the font, the two characters are about 1,500 dark pixels; the
    // hollow boxes drawn in their place without it are about 300.
    expect(await darkPixels(drawn?.data ?? "")).toBeGreaterThan(800);
  });

  it("draws a picture in the same process, as the picture it is", async () => {
    const folder = await folders.make("zhiyin-documents-");
    // Dark ink on white, as a script writing a small logo makes it.
    const canvas = createCanvas(200, 200);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 200, 200);
    context.fillStyle = "#111827";
    context.fillRect(40, 60, 120, 80);
    await writeFile(join(folder, "logo.png"), canvas.toBuffer("image/png"));
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversationIn(folder));

    const launched = await launch({ dataDirectory });
    await shows(
      launched.window.getByText("Read the report").first(),
      "the restored conversation",
    );
    const drawn = await launched.window.evaluate(async () => {
      const bridge = (window as unknown as { zhiyin: Bridge }).zhiyin;
      const documents: {
        status: string;
        revision?: string;
        pages?: unknown[];
      }[] = [];
      const stop = bridge.onAppEvent((event) => {
        const { kind, data } = event as {
          kind: string;
          data: { document: (typeof documents)[number] };
        };
        if (kind === "documentChanged") documents.push(data.document);
      });
      const outcome = await bridge.showDocument("doc-task", "logo.png");
      const shown = documents.findLast((item) => item.status === "shown");
      const page = shown?.revision
        ? await bridge.drawDocumentPage("doc-task", shown.revision, 1, 400)
        : undefined;
      stop();
      return { outcome, pages: shown?.pages, page };
    });

    expect(drawn).toMatchObject({
      outcome: { ok: true },
      pages: [{ width: 200, height: 200 }],
      page: { ok: true, width: 200, height: 200 },
    });
    expect(await darkPixels(drawn.page?.data ?? "")).toBeGreaterThan(9_000);
  });

  it("shows a produced PDF in the window from the files list, its page drawn and decoded there", async () => {
    const folder = await folders.make("zhiyin-documents-");
    await writeFile(join(folder, "report.pdf"), onePagePdf());
    const dataDirectory = await temporaryDataDirectory();
    await plantHistory(dataDirectory, oneConversationIn(folder));

    const { window } = await launch({ dataDirectory });
    await shows(
      window.getByText("Read the report").first(),
      "the restored conversation",
    );
    await window.getByRole("button", { name: /^Files/ }).click();
    await window
      .getByRole("button", { name: "Show report.pdf beside the conversation" })
      .click();

    const page = window.getByRole("img", { name: "Page 1 of report.pdf" });
    await shows(page, "the first page of the report");
    // Drawn, crossed to the window, and decoded under the window's own
    // security policy: an image that loaded has a size of its own.
    await expect
      .poll(() =>
        page.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        window
          .getByRole("tab", { name: "Workspace" })
          .getAttribute("aria-selected"),
      )
      .toBe("true");
  });
});
