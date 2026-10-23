import { describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import {
  serveDrawing,
  type DrawingReply,
  type DrawingRequest,
} from "../src/index.js";
import {
  chinesePdf,
  hostilePdf,
  jbigTwoPdf,
  jpegTwoThousandPdf,
  oversizedImagePdf,
  pdf,
  protectedPdf,
  scannedPdf,
} from "./pdf-builder.js";

/** The service as the contained process runs it, spoken to in this one. */
/** A request as the client writes it; the service numbers it. */
type Asked = DrawingRequest extends infer Request
  ? Request extends DrawingRequest
    ? Omit<Request, "id">
    : never
  : never;

function service() {
  const waiting = new Map<number, (reply: DrawingReply) => void>();
  let deliver: ((request: DrawingRequest) => void) | undefined;
  serveDrawing({
    receive: (handler) => {
      deliver = handler;
    },
    send: (reply) => waiting.get(reply.id)?.(structuredClone(reply)),
  });
  let next = 0;
  return (request: Asked): Promise<DrawingReply> =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      deliver?.(structuredClone({ ...request, id }) as DrawingRequest);
    });
}

const isPng = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, 8)).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

function picture(
  kind: "image/png" | "image/jpeg" | "image/webp",
  width: number,
  height: number,
) {
  const canvas = loadCanvas().createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#336699";
  context.fillRect(0, 0, width, height);
  return kind === "image/png"
    ? canvas.toBuffer("image/png")
    : (canvas as unknown as { toBuffer(kind: string): Buffer }).toBuffer(kind);
}

describe("the drawing service", () => {
  it("opens a PDF with each page's own size, and draws a page as a PNG at the width asked for", async () => {
    const ask = service();
    const bytes = new Uint8Array(
      pdf({ pages: 3, size: { width: 612, height: 792 } }),
    );
    await expect(
      ask({ kind: "open", revision: "r1", format: "pdf", bytes }),
    ).resolves.toEqual({
      id: 1,
      ok: true,
      kind: "opened",
      // 612 by 792 points is 816 by 1056 CSS pixels.
      pages: [
        { width: 816, height: 1056 },
        { width: 816, height: 1056 },
        { width: 816, height: 1056 },
      ],
    });
    const drawn = await ask({
      kind: "draw",
      revision: "r1",
      page: 2,
      width: 600,
    });
    expect(drawn).toMatchObject({
      ok: true,
      kind: "drawn",
      width: 600,
      height: 776,
    });
    expect(drawn.ok && drawn.kind === "drawn" && isPng(drawn.png)).toBe(true);
  });

  it("ends each line of a page with a line break, so the words either side of it stay apart", async () => {
    const ask = service();
    const bytes = new Uint8Array(
      pdf({ lines: ["The first line ends at", "the second one"] }),
    );
    await ask({ kind: "open", revision: "r1", format: "pdf", bytes });
    await expect(
      ask({ kind: "text", revision: "r1", page: 1 }),
    ).resolves.toMatchObject({
      strings: ["The first line ends at\n", "the second one"],
    });
  });

  it("reads the words on a page, and draws a page as a JPEG at the scale asked for, for the model", async () => {
    const ask = service();
    const bytes = new Uint8Array(
      pdf({ pages: 2, size: { width: 612, height: 792 } }),
    );
    await ask({ kind: "open", revision: "r1", format: "pdf", bytes });
    await expect(
      ask({ kind: "text", revision: "r1", page: 2 }),
    ).resolves.toMatchObject({ ok: true, kind: "text", strings: ["Page 2"] });
    const drawn = await ask({
      kind: "picture",
      revision: "r1",
      page: 1,
      scale: 1.5,
      quality: 80,
    });
    if (!drawn.ok || drawn.kind !== "picture") throw new Error("not drawn");
    // A JPEG, 1.5 times the page's 612 by 792 points.
    expect([...drawn.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const image = await loadCanvas().loadImage(Buffer.from(drawn.jpeg));
    expect([image.width, image.height]).toEqual([918, 1188]);
    await expect(
      ask({ kind: "text", revision: "r1", page: 3 }),
    ).resolves.toMatchObject({ ok: false, failure: "no-such-page" });
  });

  it("draws a page no larger than twice its own size, however wide it is asked for", async () => {
    const ask = service();
    await ask({
      kind: "open",
      revision: "r1",
      format: "pdf",
      bytes: new Uint8Array(pdf({ size: { width: 72, height: 72 } })),
    });
    await expect(
      ask({ kind: "draw", revision: "r1", page: 1, width: 5000 }),
    ).resolves.toMatchObject({ ok: true, width: 192, height: 192 });
  });

  it("says a damaged file is damaged and a protected one is protected", async () => {
    const ask = service();
    const damaged = new Uint8Array(
      Buffer.from("%PDF-1.7\nthis is not a document at all"),
    );
    await expect(
      ask({ kind: "open", revision: "d", format: "pdf", bytes: damaged }),
    ).resolves.toMatchObject({ ok: false, failure: "damaged" });
    await expect(
      ask({
        kind: "open",
        revision: "p",
        format: "pdf",
        bytes: new Uint8Array(protectedPdf()),
      }),
    ).resolves.toMatchObject({ ok: false, failure: "protected" });
  });

  it("refuses a page the document does not have", async () => {
    const ask = service();
    await ask({
      kind: "open",
      revision: "r1",
      format: "pdf",
      bytes: new Uint8Array(pdf({ pages: 2 })),
    });
    await expect(
      ask({ kind: "draw", revision: "r1", page: 3, width: 400 }),
    ).resolves.toMatchObject({ ok: false, failure: "no-such-page" });
  });

  it("draws a PDF carrying script, a link, a form and a crafted font, and none of them runs", async () => {
    const ask = service();
    delete (globalThis as Record<string, unknown>)["zhiyinRan"];
    const opened = await ask({
      kind: "open",
      revision: "h",
      format: "pdf",
      bytes: new Uint8Array(hostilePdf()),
    });
    expect(opened).toMatchObject({ ok: true, kind: "opened" });
    const drawn = await ask({
      kind: "draw",
      revision: "h",
      page: 1,
      width: 600,
    });
    expect(drawn).toMatchObject({ ok: true, kind: "drawn" });
    // What leaves the service is a picture and its size, and nothing else.
    expect(Object.keys(drawn).sort()).toEqual([
      "height",
      "id",
      "kind",
      "ok",
      "png",
      "width",
    ]);
    expect(drawn.ok && drawn.kind === "drawn" && isPng(drawn.png)).toBe(true);
    expect(
      (globalThis as Record<string, unknown>)["zhiyinRan"],
    ).toBeUndefined();
  });

  it("decodes each picture kind and sends it back as a PNG of at most 2,000 pixels on its long side", async () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );
    const row = Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]);
    const bmp = Buffer.alloc(54);
    bmp.write("BM");
    bmp.writeUInt32LE(54 + row.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(2, 18);
    bmp.writeInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    const pictures: [string, Buffer, { width: number; height: number }][] = [
      ["png", picture("image/png", 3000, 1500), { width: 2000, height: 1000 }],
      ["jpeg", picture("image/jpeg", 40, 30), { width: 40, height: 30 }],
      ["webp", picture("image/webp", 30, 40), { width: 30, height: 40 }],
      ["gif", gif, { width: 1, height: 1 }],
      ["bmp", Buffer.concat([bmp, row]), { width: 2, height: 1 }],
    ];
    for (const [name, bytes, size] of pictures) {
      const ask = service();
      await expect(
        ask({
          kind: "open",
          revision: name,
          format: "picture",
          bytes: new Uint8Array(bytes),
        }),
        name,
      ).resolves.toMatchObject({ ok: true, pages: [size] });
      const drawn = await ask({
        kind: "draw",
        revision: name,
        page: 1,
        width: 4000,
      });
      expect(drawn, name).toMatchObject({ ok: true, ...size });
      expect(drawn.ok && drawn.kind === "drawn" && isPng(drawn.png), name).toBe(
        true,
      );
    }
  });

  it("says a picture it cannot decode is damaged", async () => {
    const ask = service();
    const bytes = new Uint8Array(
      Buffer.from("\x89PNG\r\n\x1a\nnot really", "latin1"),
    );
    await expect(
      ask({ kind: "open", revision: "x", format: "picture", bytes }),
    ).resolves.toMatchObject({ ok: false, failure: "damaged" });
  });

  it("forgets a revision it was told to let go of", async () => {
    const ask = service();
    await ask({
      kind: "open",
      revision: "r1",
      format: "pdf",
      bytes: new Uint8Array(pdf()),
    });
    await expect(
      ask({ kind: "release", revision: "r1" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      ask({ kind: "draw", revision: "r1", page: 1, width: 400 }),
    ).resolves.toMatchObject({ ok: false, failure: "not-open" });
  });
});

describe("the drawing service, on what a page can hold", () => {
  type Box = { x: number; y: number; width: number; height: number };
  // Drawn 612 pixels wide, a page 612 points wide has one pixel per point,
  // counted from its top. The builder's line of text sits on the line 100
  // points from the top, and its image fills the 200-point square whose top
  // left corner is 72 in and 292 down; each box keeps clear of the edges.
  const text: Box = { x: 72, y: 70, width: 228, height: 34 };
  const image: Box = { x: 82, y: 302, width: 180, height: 180 };

  async function drawn(bytes: Buffer) {
    const ask = service();
    await ask({
      kind: "open",
      revision: "r1",
      format: "pdf",
      bytes: new Uint8Array(bytes),
    });
    const reply = await ask({
      kind: "draw",
      revision: "r1",
      page: 1,
      width: 612,
    });
    if (!reply.ok || reply.kind !== "drawn") throw new Error("not drawn");
    const picture = await loadCanvas().loadImage(Buffer.from(reply.png));
    const canvas = loadCanvas().createCanvas(picture.width, picture.height);
    const context = canvas.getContext("2d");
    context.drawImage(picture, 0, 0, picture.width, picture.height);
    const pixels = (
      context as unknown as {
        getImageData(x: number, y: number, w: number, h: number): ImageData;
      }
    ).getImageData(0, 0, picture.width, picture.height);
    /** How many pixels in the box are closer to black than to white. */
    return ({ x, y, width, height }: Box): number => {
      let count = 0;
      for (let row = y; row < y + height; row++)
        for (let column = x; column < x + width; column++) {
          const at = (row * pixels.width + column) * 4;
          const [red, green, blue] = pixels.data.subarray(at, at + 3);
          if ((red! + green! + blue!) / 3 < 128) count++;
        }
      return count;
    };
  }

  it.each([
    ["scanned as CCITT fax", scannedPdf],
    ["kept as JPEG 2000", jpegTwoThousandPdf],
    ["scanned as JBIG2", jbigTwoPdf],
  ])("draws an image %s, black where the page puts it", async (_, build) => {
    const dark = await drawn(build());
    expect(dark(image)).toBe(image.width * image.height);
    expect(dark(text)).toBeGreaterThan(100);
  });

  it("reads Chinese text set in a standard Chinese font the file does not embed", async () => {
    const ask = service();
    await ask({
      kind: "open",
      revision: "r1",
      format: "pdf",
      bytes: new Uint8Array(chinesePdf()),
    });
    await expect(
      ask({ kind: "text", revision: "r1", page: 1 }),
    ).resolves.toMatchObject({ ok: true, strings: ["中文"] });
  });

  it("leaves out an image past 64 million pixels and draws the rest of the page", async () => {
    const dark = await drawn(oversizedImagePdf());
    expect(dark(image)).toBe(0);
    expect(dark(text)).toBeGreaterThan(100);
  });
});
