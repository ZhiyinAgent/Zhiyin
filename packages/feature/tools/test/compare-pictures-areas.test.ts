/**
 * Where two pictures differ: the areas a comparison finds, at the edges and
 * in one part, how far the second is moved, and what it calls overall.
 */

import { afterEach, describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import { ToolsDecodingHere } from "./decoding-here.js";
import type { ConversationItems } from "../src/shared/conversation-items.js";
import type { PixelComparer } from "@zhiyin/picture-comparison";
import type { PixelSource } from "../src/documents/picture-pixels.js";
import {
  folders,
  scene,
  workspace,
  compare,
  valueOf,
  sheetOf,
  red,
} from "./compare-pictures-fixtures.js";
import type { Context } from "./compare-pictures-fixtures.js";

afterEach(() => folders.removeAll());

describe("comparing two pictures, at their edges", () => {
  /** What the store holds for each conversation, by picture id. */
  function attached(stored: Record<string, Buffer>): ConversationItems {
    return {
      locate: async () => ({ status: "missing", reason: "Not a text." }),
      keepOutput: async () => ({ status: "refused", reason: "Not here." }),
      lastRead: async () => undefined,
      noteRead: async () => {},
      readPicture: async (conversationId, id) => {
        const data = stored[`${conversationId}/${id}`];
        return data
          ? {
              status: "ready",
              mediaType: "image/png",
              data: data.toString("base64"),
            }
          : { status: "missing", reason: "This picture was deleted." };
      },
    };
  }

  it("compares two pictures the person attached with no folder chosen, but not one from a folder", async () => {
    const tools = new ToolsDecodingHere(undefined, {
      shell: undefined,
      acceptsImages: () => true,
      items: attached({
        "task-1/before": scene(320, 180),
        "task-1/after": scene(320, 180, { paint: red }),
      }),
    });

    const both = await tools.execute(
      "compare_pictures",
      { first: "attachment://before", second: "attachment://after" },
      undefined,
      "task-1",
    );
    const one = await tools.execute(
      "compare_pictures",
      { first: "attachment://before", second: "after.png" },
      undefined,
      "task-1",
    );

    expect(valueOf(both)).toMatchObject({
      first: "attachment://before, 320 × 180",
      areas: [expect.objectContaining({ second: "#e01010" })],
    });
    expect(one).toEqual({
      ok: false,
      reason: "Choose a folder before using files.",
    });
  });

  it("names a picture larger than it is drawn by its own size and its own pixels", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(2400, 1350),
          "b.png": scene(2400, 1350, { paint: red }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.first).toBe("a.png, 2400 × 1350");
    // The patch spans x 12–32% and y 70–85%: 288–768 and 945–1148 here.
    expect(value.areas?.[0]?.where).toMatch(
      /^x 2[89][0-9]–7[67][0-9], y 9[34][0-9]–11[45][0-9] of the first picture's 2400 × 1350$/,
    );
  });

  it("compares a small picture with a large one at the small one's detail, so the large one's sharpness is no difference", async () => {
    const value = valueOf(
      await compare(
        { "small.png": scene(96, 54), "large.png": scene(1280, 720) },
        { first: "small.png", second: "large.png" },
      ),
    );

    expect(value.compared).toBe("96 × 54 pixels");
    expect(value.areas ?? []).toEqual([]);
  });

  it("names the six areas that differ most, and counts the smaller rest", async () => {
    // Eight patches apart from each other, each smaller than the last.
    const patches = (context: Context, width: number, height: number) => {
      context.fillStyle = "#e01010";
      for (let index = 0; index < 8; index += 1) {
        const side = 40 - index * 3;
        context.fillRect(
          (index % 4) * width * 0.25 + 10,
          (index < 4 ? 0.05 : 0.7) * height,
          side,
          side,
        );
      }
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: patches }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.areas).toHaveLength(6);
    expect(value.differs).toMatch(/, in 6 named areas\.$/);
    expect(value.moreAreas).toBe("2 smaller areas differ too.");
    // The largest first.
    expect(value.areas?.[0]?.box.width).toBeGreaterThan(
      value.areas?.[5]?.box.width ?? Infinity,
    );
  });

  it("names where it differs most when one area would span most of the picture, though little of it differs", async () => {
    // A thin frame round the whole picture, faintly changed, and one patch
    // changed strongly: the frame alone would be a box round everything.
    const framed = (context: Context, width: number, height: number) => {
      context.fillStyle = "rgba(255, 255, 255, 0.3)";
      context.fillRect(0, 0, width, 6);
      context.fillRect(0, height - 6, width, 6);
      context.fillRect(0, 0, 6, height);
      context.fillRect(width - 6, 0, 6, height);
      red(context, width, height);
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: framed }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.differs).toMatch(
      /the areas named are where it differs most\.$/,
    );
    expect(value.areas?.[0]).toMatchObject({ second: "#e01010" });
    for (const area of value.areas ?? [])
      expect(area.box.width * area.box.height).toBeLessThan(0.35);
  });

  it("cuts a wider second picture to the first's shape from its middle", async () => {
    // The scene with a band of red at each side: cut to the middle, the same.
    const canvasModule = loadCanvas();
    const middle = await canvasModule.loadImage(scene(640, 360));
    const canvas = canvasModule.createCanvas(960, 360);
    const context = canvas.getContext("2d");
    context.fillStyle = "#e01010";
    context.fillRect(0, 0, 960, 360);
    context.drawImage(middle, 160, 0, 640, 360);
    const files = {
      "a.png": scene(640, 360),
      "wide.png": canvas.toBuffer("image/png"),
    };

    const cropped = valueOf(
      await compare(files, { first: "a.png", second: "wide.png", fit: "crop" }),
    );
    const stretched = valueOf(
      await compare(files, { first: "a.png", second: "wide.png" }),
    );

    expect(cropped.differs).toBe("Nothing differs visibly.");
    expect(cropped.similarity).toBeGreaterThan(0.98);
    expect(stretched.differs).not.toBe("Nothing differs visibly.");
  });

  it("says nothing of a move on a strip too thin to measure one", async () => {
    const strip = (shift: number) => {
      const canvas = loadCanvas().createCanvas(640, 8);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 640, 8);
      context.fillStyle = "#202020";
      for (let x = 20; x < 640; x += 60) context.fillRect(x + shift, 0, 20, 8);
      return canvas.toBuffer("image/png");
    };

    const value = valueOf(
      await compare(
        { "a.png": strip(0), "b.png": strip(12) },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.alignment).toBeUndefined();
  });

  it("keeps each label whole on the sheet of a narrow picture", async () => {
    const result = await compare(
      { "a.png": scene(24, 400), "b.png": scene(24, 400, { paint: red }) },
      { first: "a.png", second: "b.png" },
    );

    const sheet = await sheetOf(result);
    // Two columns, each as wide as "Where they differ" in the sheet's font.
    expect(sheet.width).toBeGreaterThanOrEqual(2 * 202 + 3 * 12);
  });

  it("says a picture whose drawing took too long was stopped, not that it is damaged", async () => {
    const stopped: PixelSource = {
      open: async () => ({ ok: false, failure: "stopped" }),
    };

    const result = await compare(
      { "a.png": scene(64, 64), "b.png": scene(64, 64) },
      { first: "a.png", second: "b.png" },
      { pixels: stopped },
    );

    expect(result).toEqual({
      ok: false,
      reason:
        "a.png could not be drawn: drawing it took too long, or its process stopped, so the pictures were not compared.",
    });
  });

  it("compares where it is told to, and answers a comparison stopped there as cancelled", async () => {
    const stop = new AbortController();
    const elsewhere: PixelComparer = {
      compare: (_first, _second, _size, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve("cancelled"));
          stop.abort();
        }),
    };
    const failing: PixelComparer = { compare: async () => "failed" };
    const files = { "a.png": scene(64, 64), "b.png": scene(64, 64) };

    await expect(
      compare(
        files,
        { first: "a.png", second: "b.png" },
        { comparer: elsewhere, signal: stop.signal },
      ),
    ).resolves.toEqual({ ok: false, reason: "The comparison was cancelled." });
    await expect(
      compare(
        files,
        { first: "a.png", second: "b.png" },
        { comparer: failing },
      ),
    ).resolves.toEqual({
      ok: false,
      reason:
        "The pictures were drawn, but comparing them failed, so there is no answer.",
    });
  });
});

describe("comparing two pictures, for a move", () => {
  const moved = async (shift: { x: number; y: number }, zoom = 1) =>
    valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { shift, zoom }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

  it("says a move of 1% of the width is a move", async () => {
    // 1% of 640 is six pixels.
    const value = await moved({ x: 0.01, y: 0 });

    expect(value.alignment).toMatchObject({ right: 1, down: 0, larger: 0 });
    expect(value.alignment?.similarityAligned).toBeGreaterThan(0.99);
  });

  it("says nothing of a zoom or a move past what it looks for, rather than the nearest it looked for", async () => {
    const zoomed = await moved({ x: 0, y: 0 }, 1.3);
    const far = await moved({ x: 0.17, y: 0 });
    const inside = await moved({ x: 0, y: 0 }, 1.25);

    expect(zoomed.alignment).toBeUndefined();
    expect(far.alignment).toBeUndefined();
    expect(inside.alignment).toMatchObject({ larger: 25 });
  });
});

describe("comparing two pictures, for what is overall", () => {
  it("names a change in one part as that part's area", async () => {
    // A red patch over 12% of the picture; the rest is the same.
    const patch = (context: Context, width: number, height: number) => {
      context.fillStyle = "#e01010";
      context.fillRect(width * 0.05, height * 0.66, width * 0.4, height * 0.3);
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: patch }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.areas?.[0]).toMatchObject({ second: "#e01010" });
  });

  it("refuses an area on the picture's far edge, which has nothing in it to compare", async () => {
    const tools = new ToolsDecodingHere(await workspace({}), {
      acceptsImages: () => true,
    });

    const inspection = await tools.inspect("compare_pictures", {
      first: "a.png",
      second: "b.png",
      area: { left: 1, top: 0, width: 0.0004, height: 1 },
    });

    expect(inspection).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/^area is left, top, width and height/),
    });
  });

  it("marks nothing in red on the sheet where nothing differs visibly", async () => {
    const flat =
      (colour: string) => (context: Context, w: number, h: number) => {
        context.fillStyle = colour;
        context.fillRect(0, 0, w, h);
      };

    const result = await compare(
      {
        "a.png": scene(320, 180, { paint: flat("#808080") }),
        "b.png": scene(320, 180, { paint: flat("#8a8a8a") }),
      },
      { first: "a.png", second: "b.png" },
    );

    // Lighter all over by a shade, which no one part shows on its own.
    expect(valueOf(result).differs).toBe(
      "No one part differs visibly; the change is across the whole picture.",
    );
    const sheet = await sheetOf(result);
    // The middle of the bottom right panel: pale grey, not pink.
    const at =
      (Math.round(sheet.height * 0.75) * sheet.width +
        Math.round(sheet.width * 0.75)) *
      4;
    const [r, g, b] = [...sheet.data.subarray(at, at + 3)];
    expect(Math.abs(r! - g!)).toBeLessThan(4);
    expect(Math.abs(g! - b!)).toBeLessThan(4);
  });
});

describe("comparing two pictures, where one part holds the change", () => {
  it("names one part greyed as one area, however much of the colour it held", async () => {
    // White, with a red band over 30%; the second greys the band's left 55%.
    const band =
      (greyed: boolean) => (context: Context, w: number, h: number) => {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, w, h);
        context.fillStyle = "#d02020";
        context.fillRect(0, h * 0.35, w, h * 0.3);
        if (greyed) {
          context.fillStyle = "#808080";
          context.fillRect(0, h * 0.35, w * 0.55, h * 0.3);
        }
      };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(400, 400, { paint: band(false) }),
          "b.png": scene(400, 400, { paint: band(true) }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.areas).toHaveLength(1);
  });

  it("names a photo whose header runs long by its own size", async () => {
    const canvas = loadCanvas().createCanvas(2400, 1600);
    const context = canvas.getContext("2d");
    context.fillStyle = "#9cc8ee";
    context.fillRect(0, 0, 2400, 1600);
    const jpeg = canvas.toBuffer("image/jpeg");
    // Three 60 KB segments of metadata before the picture's own header, as a
    // photo editor's history leaves.
    const segment = () => {
      const body = Buffer.alloc(60_000, 0x20);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(body.length + 2);
      return Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
    };
    const long = Buffer.concat([
      jpeg.subarray(0, 2),
      segment(),
      segment(),
      segment(),
      jpeg.subarray(2),
    ]);

    const value = valueOf(
      await compare(
        { "a.jpg": long, "b.jpg": long },
        { first: "a.jpg", second: "b.jpg" },
      ),
    );

    expect(value.first).toBe("a.jpg, 2400 × 1600");
  });

  it("says a move right at the farthest it looks for", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { shift: { x: 0.15, y: 0 } }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.alignment).toMatchObject({ right: 15, down: 0 });
  });

  it("does not call a scene seen from elsewhere a move, where near things shift more than far ones", async () => {
    const parallax = (context: Context, width: number, height: number) => {
      context.fillStyle = "#9cc8ee";
      context.fillRect(0, 0, width, height * 0.62);
      context.fillStyle = "#6a9a4a";
      context.fillRect(0, height * 0.62, width, height);
      const blocks: [number, number, number, number, string, number][] = [
        [0.12, 0.38, 0.14, 0.26, "#a0522d", 0.02],
        [0.36, 0.3, 0.18, 0.34, "#7f8c8d", 0.07],
        [0.64, 0.44, 0.1, 0.2, "#2c3e50", 0.13],
      ];
      for (const [x, y, w, h, colour, shift] of blocks) {
        context.fillStyle = colour;
        context.fillRect(
          (x + shift) * width,
          y * height,
          w * width,
          h * height,
        );
      }
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: parallax }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.alignment).toBeUndefined();
  });

  it("draws the second only once the first is drawn, and not after a cancel", async () => {
    let draws = 0;
    const stop = new AbortController();
    const slow = (cancel: boolean): PixelSource => ({
      open: async () => ({
        ok: true,
        pages: [{ width: 64, height: 64 }],
        draw: async () => {
          draws += 1;
          if (cancel) stop.abort();
          return "stopped";
        },
        close: () => undefined,
      }),
    });
    const files = { "a.png": scene(64, 64), "b.png": scene(64, 64) };

    const stopped = await compare(
      files,
      { first: "a.png", second: "b.png" },
      { pixels: slow(false) },
    );
    const afterStopped = draws;
    const cancelled = await compare(
      files,
      { first: "a.png", second: "b.png" },
      { pixels: slow(true), signal: stop.signal },
    );

    expect(stopped).toMatchObject({ ok: false });
    expect(afterStopped).toBe(1);
    expect(cancelled).toEqual({
      ok: false,
      reason: "The comparison was cancelled.",
    });
    expect(draws).toBe(2);
  });
});

describe("comparing two pictures, along a short side", () => {
  it("measures a move along a wide strip's short side, and says nothing of one past the bound", async () => {
    // A strip of bars of many heights and widths.
    const strip = (down: number) => {
      const canvas = loadCanvas().createCanvas(960, 100);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 960, 100);
      let seed = 7;
      const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let bar = 0; bar < 60; bar += 1) {
        context.fillStyle = `hsl(${Math.round(next() * 360)}, 70%, 40%)`;
        context.fillRect(
          next() * 900,
          next() * 80 + down * 100 - 10,
          10 + next() * 50,
          10 + next() * 30,
        );
      }
      return canvas.toBuffer("image/png");
    };
    const moved = async (down: number) =>
      valueOf(
        await compare(
          { "a.png": strip(0), "b.png": strip(down) },
          { first: "a.png", second: "b.png" },
        ),
      ).alignment;

    expect((await moved(0.1))?.down).toBe(10);
    expect(await moved(0.2)).toBeUndefined();
  });
});
