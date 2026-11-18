/**
 * Two pictures compared for the model: what the tool reads, refuses and is
 * told, the sheet it shows, and a comparison stopped part way. The pictures
 * are real PNGs drawn here, so the comparison runs on what a decoder makes of
 * them.
 */

import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import { WorkspaceTools } from "../src/index.js";
import { ToolsDecodingHere } from "./decoding-here.js";
import { simplePdf } from "./pdf-fixture.js";
import type { PixelSource } from "../src/documents/picture-pixels.js";
import {
  folders,
  scene,
  workspace,
  compare,
  valueOf,
  sheetOf,
  red,
  painted,
  hsv,
  exposed,
} from "./compare-pictures-fixtures.js";
import type { Context } from "./compare-pictures-fixtures.js";

afterEach(() => folders.removeAll());

describe("comparing two pictures", () => {
  it("is offered, described for what it is for, and asks nothing to look", async () => {
    const tools = new ToolsDecodingHere(await workspace({}), {
      acceptsImages: () => true,
    });
    const spec = tools.list().find((tool) => tool.name === "compare_pictures");
    expect(spec?.description).toContain("side by side");
    expect(spec?.inputSchema).toMatchObject({
      required: ["first", "second"],
      additionalProperties: false,
    });

    const inspection = await tools.inspect("compare_pictures", {
      first: "render.png",
      second: "reference.jpg",
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Compare two pictures",
      target: "render.png and reference.jpg",
      effects: expect.objectContaining({ reads: "workspace", changes: "none" }),
    });
  });

  it("says the same picture is the same: similarity 1, nothing differs, no areas", async () => {
    const picture = scene(640, 360);

    const value = valueOf(
      await compare(
        { "a.png": picture, "b.png": picture },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.similarity).toBe(1);
    expect(value.averageDifference).toBe(0);
    expect(value.differs).toBe("Nothing differs visibly.");
    expect(value.areas ?? []).toEqual([]);
    expect(value.alignment).toBeUndefined();
  });

  it("finds a changed area where it is, with each picture's colour there", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: red }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    // SSIM follows lightness, which the two colours nearly share; the colour
    // difference does not.
    expect(value.averageDifference).toBeGreaterThan(0.005);
    expect(value.areas).toHaveLength(1);
    const [area] = value.areas!;
    expect(area!.box.left).toBeCloseTo(0.12, 2);
    expect(area!.box.top).toBeCloseTo(0.7, 2);
    expect(area!.box.width).toBeCloseTo(0.2, 2);
    expect(area!.box.height).toBeCloseTo(0.15, 2);
    // Green ground in the first, the red patch in the second.
    expect(area!.first).toBe("#6a9a4a");
    expect(area!.second).toBe("#e01010");
    expect(value.differs).toMatch(/^3% of the picture differs visibly/);
  });

  it("names areas by the first picture's own pixels as well as by share", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(1280, 720),
          "b.png": scene(1280, 720, { paint: red }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.areas?.[0]?.where).toMatch(
      /^x 15[0-9]–41[0-9], y 50[0-9]–61[0-9] of the first picture's 1280 × 720$/,
    );
  });

  it("compares pictures of different sizes but the same shape as they look", async () => {
    const value = valueOf(
      await compare(
        { "small.png": scene(320, 180), "large.png": scene(1280, 720) },
        { first: "small.png", second: "large.png" },
      ),
    );

    expect(value.similarity).toBeGreaterThan(0.95);
    expect(value.areas ?? []).toEqual([]);
    expect(value.fitted).toBeUndefined();
  });

  it("stretches a second picture of another shape to the first's, and says so; or crops it when asked", async () => {
    const files = {
      "wide.png": scene(640, 360),
      "square.png": scene(400, 400),
    };

    const stretched = valueOf(
      await compare(files, { first: "wide.png", second: "square.png" }),
    );
    const cropped = valueOf(
      await compare(files, {
        first: "wide.png",
        second: "square.png",
        fit: "crop",
      }),
    );

    expect(stretched.fitted).toBe(
      "The second is 1:1 and the first 16:9, so the second was stretched to the first's shape.",
    );
    expect(cropped.fitted).toBe(
      "The second is 1:1 and the first 16:9, so the second was cut to the first's shape, keeping its middle.",
    );
  });

  it("says how far the second's content is moved and zoomed, and how alike they are once aligned", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { shift: { x: 0.06, y: -0.04 }, zoom: 1.1 }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.alignment).toBeDefined();
    const { right, down, larger, similarityAligned } = value.alignment!;
    // Zoomed about the middle after the shift, the shift grows with it.
    expect(right).toBeGreaterThanOrEqual(5);
    expect(right).toBeLessThanOrEqual(8);
    expect(down).toBeGreaterThanOrEqual(-6);
    expect(down).toBeLessThanOrEqual(-3);
    expect(larger).toBeGreaterThanOrEqual(5);
    expect(larger).toBeLessThanOrEqual(15);
    expect(similarityAligned).toBeGreaterThan(value.similarity);
  });

  it("says no move when the second is not the first moved, as a scene rearranged", async () => {
    const rearranged = (context: Context, width: number, height: number) => {
      context.fillStyle = "#9cc8ee";
      context.fillRect(0, 0, width, height * 0.62);
      context.fillStyle = "#7f8c8d";
      context.fillRect(width * 0.05, height * 0.2, width * 0.3, height * 0.42);
      context.fillStyle = "#a0522d";
      context.fillRect(width * 0.6, height * 0.1, width * 0.08, height * 0.52);
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: rearranged }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.areas?.length).toBeGreaterThan(0);
    expect(value.alignment).toBeUndefined();
  });

  it("names where it differs most when most of the picture differs, and says so", async () => {
    // A dusk sky over the top 62%, and a dark moon that differs far more.
    const dusk = (context: Context, width: number, height: number) => {
      context.fillStyle = "#7090b8";
      context.fillRect(0, 0, width, height * 0.62);
      context.fillStyle = "#101010";
      context.fillRect(width * 0.75, height * 0.12, width * 0.1, height * 0.16);
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { paint: dusk }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.differs).toMatch(
      /^6\d% of the picture differs visibly; the areas named are where it differs most\.$/,
    );
    expect(value.areas?.length).toBeGreaterThan(0);
    for (const area of value.areas ?? [])
      expect(area.box.width * area.box.height).toBeLessThan(0.35);
    // The moon is among them, boxed with the sun it covers, which the dusk
    // covers too and which differs nearly as much.
    const moon = value.areas?.find(({ second }) => second === "#101010");
    expect(moon?.box.left).toBeLessThanOrEqual(0.75);
    expect(moon?.box.top).toBeLessThanOrEqual(0.12);
    expect(
      (moon?.box.left ?? 0) + (moon?.box.width ?? 0),
    ).toBeGreaterThanOrEqual(0.85);
    expect(
      (moon?.box.top ?? 0) + (moon?.box.height ?? 0),
    ).toBeGreaterThanOrEqual(0.28);
    expect(moon?.box.width).toBeLessThan(0.13);
  });

  it("names a change as strong all across as one area, however large", async () => {
    const sky = (context: Context, width: number, height: number) => {
      context.fillStyle = "#9cc8ee";
      context.fillRect(0, 0, width, height);
    };
    const night = (context: Context, width: number, height: number) => {
      sky(context, width, height);
      context.fillStyle = "#101830";
      context.fillRect(0, 0, width, height * 0.62);
    };

    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360, { paint: sky }),
          "b.png": scene(640, 360, { paint: night }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.differs).toBe(
      "62% of the picture differs visibly, in 1 area.",
    );
    expect(value.areas).toEqual([
      expect.objectContaining({
        // 62% of 360 rows is 223.2: the last is partly painted, and counted.
        box: { left: 0, top: 0, width: 1, height: 0.622 },
        second: "#101830",
      }),
    ]);
  });

  it("keeps the sheet small enough to send, even for pictures that do not compress", async () => {
    const noise = (seed: number) => {
      const canvas = loadCanvas().createCanvas(1600, 1600);
      const context = canvas.getContext("2d");
      let state = seed;
      for (let y = 0; y < 1600; y += 4)
        for (let x = 0; x < 1600; x += 4) {
          state = (state * 1664525 + 1013904223) >>> 0;
          context.fillStyle = `#${(state >>> 8).toString(16).padStart(6, "0")}`;
          context.fillRect(x, y, 4, 4);
        }
      return canvas.toBuffer("image/png");
    };

    const result = await compare(
      { "a.png": noise(1), "b.png": noise(2) },
      { first: "a.png", second: "b.png" },
    );

    const images = (result as { images?: { data: string }[] }).images ?? [];
    expect(Buffer.byteLength(images[0]!.data, "base64")).toBeLessThanOrEqual(
      3 * 1024 * 1024,
    );
    const sheet = await sheetOf(result);
    expect(sheet.width * sheet.height).toBeLessThanOrEqual(1_150_000);
  });

  it("names a picture outside the folder as leaving it, for the person to decide", async () => {
    const elsewhere = await workspace({ "reference.png": scene(64, 64) });
    const tools = new ToolsDecodingHere(
      await workspace({ "a.png": scene(64, 64) }),
      {
        acceptsImages: () => true,
      },
    );

    const inspection = await tools.inspect("compare_pictures", {
      first: join(elsewhere, "reference.png"),
      second: "a.png",
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Compare two pictures, one outside the workspace",
      effects: expect.objectContaining({ reads: "elsewhere", changes: "none" }),
    });
    await expect(
      tools.inspect("compare_pictures", {
        first: join(elsewhere, "reference.png"),
        second: join(elsewhere, "reference.png"),
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "Compare two pictures outside the workspace",
      effects: expect.objectContaining({ reads: "elsewhere" }),
    });
    // What it asks, in words: the pictures by where they are, and the rest.
    await expect(
      tools.inspect("compare_pictures", {
        first: join(elsewhere, "reference.png"),
        second: "a.pdf",
        secondPage: 3,
        area: { left: 0.1, top: 0.2, width: 0.5, height: 0.25 },
        fit: "crop",
      }),
    ).resolves.toMatchObject({
      invocation: {
        name: "Compare two pictures, one outside the workspace",
        arguments: [
          {
            name: "First picture",
            // Named as the approval names it: in full, outside the folder.
            value: join(elsewhere, "reference.png").replaceAll("\\", "/"),
            readable: true,
          },
          { name: "Second picture", value: "a.pdf, page 3", readable: true },
          {
            name: "Area",
            value:
              "from 10% to 60% across and 20% to 45% down the first picture",
            readable: true,
          },
          {
            name: "Of another shape",
            value: "the second cut to the first's shape, keeping its middle",
            readable: true,
          },
        ],
      },
    });
  });

  it("does not compare through a folder link that leads out of the workspace", async () => {
    const parent = await folders.make("zhiyin-compare-links-");
    const root = join(parent, "workspace");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "private.png"), scene(64, 64));
    await writeFile(join(root, "a.png"), scene(64, 64));
    await symlink(outside, join(root, "linked"), "junction");
    const tools = new ToolsDecodingHere(root, { acceptsImages: () => true });

    const inspection = await tools.inspect("compare_pictures", {
      first: "a.png",
      second: "linked/private.png",
    });
    const result = await tools.execute("compare_pictures", {
      first: "a.png",
      second: "linked/private.png",
    });

    // Named as a read inside the folder, refused once the link is followed.
    expect(inspection).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ reads: "workspace" }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "linked/private.png leads outside the workspace.",
    });
  });

  it("says how far and towards which hue the average colour moved, and how saturated the second is against the first", async () => {
    const warm = (context: Context, width: number, height: number) => {
      context.fillStyle = "rgba(255, 150, 0, 0.3)";
      context.fillRect(0, 0, width, height);
    };
    const grey = (context: Context, width: number, height: number) => {
      const blend = context as Context & { globalCompositeOperation: string };
      blend.globalCompositeOperation = "saturation";
      context.fillStyle = "#808080";
      context.fillRect(0, 0, width, height);
      blend.globalCompositeOperation = "source-over";
    };

    const warmer = valueOf(
      await compare(
        { "a.png": scene(320, 180), "b.png": scene(320, 180, { paint: warm }) },
        { first: "a.png", second: "b.png" },
      ),
    );
    const greyed = valueOf(
      await compare(
        { "a.png": scene(320, 180), "b.png": scene(320, 180, { paint: grey }) },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(warmer.overall?.join(" ")).toMatch(
      /The second's average colour moved 0\.\d{3} in OKLab, towards (red|yellow)\./,
    );
    expect(greyed.overall?.join(" ")).toMatch(
      /The second's colours are 0\.[0-2]\d times as saturated as the first's on average\./,
    );
  });

  it("says how much less light the second has on average, in stops", async () => {
    const value = valueOf(
      await compare(
        {
          "a.png": scene(640, 360),
          "b.png": scene(640, 360, { darker: 0.35 }),
        },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.overall?.join(" ")).toMatch(
      /The second has [0-9]+% less light than the first on average, [0-9.]+ stops? less: average lightness \d+ and \d+ of 100\./,
    );
  });

  it("gives a camera's halved exposure as one stop less light", async () => {
    const photo = (times: number) =>
      painted(360, 240, (x, y) =>
        exposed(times)(...hsv(x, 0.5, 120 + (100 * (x + y)) / 600)),
      );

    const value = valueOf(
      await compare(
        { "a.png": photo(1), "b.png": photo(0.5) },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.overall?.[0]).toMatch(
      /^The second has (4[6-9]|5[0-4])% less light than the first on average, (0\.9|1|1\.1) stops? less/,
    );
    expect(value.differs).toMatch(/differs visibly/);
  });

  it("says two copies of one picture have the same light, colour and saturation, and that nothing differs", async () => {
    const value = valueOf(
      await compare(
        { "a.png": scene(320, 180), "b.png": scene(320, 180) },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(value.overall).toEqual([
      expect.stringMatching(/^The two have the same light on average/),
      "The average colour is the same in both, moved 0.000 in OKLab.",
      "The two are as saturated as each other on average.",
    ]);
    expect(value.differs).toBe("Nothing differs visibly.");
  });

  it("gives no share of light against a nearly black picture, and no saturation ratio for one without colour", async () => {
    const black = painted(200, 120, () => [2, 2, 2]);
    const grey = painted(200, 120, () => [128, 128, 128]);
    const coloured = painted(200, 120, () => [200, 80, 40]);

    const lit = valueOf(
      await compare(
        { "a.png": black, "b.png": grey },
        { first: "a.png", second: "b.png" },
      ),
    );
    const tinted = valueOf(
      await compare(
        { "a.png": grey, "b.png": coloured },
        { first: "a.png", second: "b.png" },
      ),
    );

    expect(lit.overall?.[0]).toMatch(
      /^One of the two is nearly black, so no share of light is given: average lightness \d+ and \d+ of 100\.$/,
    );
    expect(tinted.overall?.[2]).toMatch(
      /^The first has almost no colour to compare saturation by: average chroma 0\.0\d\d in the first and 0\.\d{3} in the second, in OKLab\.$/,
    );
  });

  it("places each area in the shares the area input takes, so one can be looked at closer as given", async () => {
    const files = {
      "a.png": scene(640, 360),
      "b.png": scene(640, 360, { paint: red }),
    };
    const whole = valueOf(
      await compare(files, { first: "a.png", second: "b.png" }),
    );
    const box = whole.areas?.[0]?.box;

    const closer = valueOf(
      await compare(files, { first: "a.png", second: "b.png", area: box }),
    );

    expect(closer.areas?.[0]).toMatchObject({ first: "#6a9a4a" });
  });

  it("compares only the area asked for, in both, drawn larger", async () => {
    const files = {
      "a.png": scene(1280, 720),
      "b.png": scene(1280, 720, { paint: red }),
    };

    const away = valueOf(
      await compare(files, {
        first: "a.png",
        second: "b.png",
        area: { left: 0.5, top: 0, width: 0.5, height: 0.5 },
      }),
    );
    const over = valueOf(
      await compare(files, {
        first: "a.png",
        second: "b.png",
        area: { left: 0, top: 0.5, width: 0.5, height: 0.5 },
      }),
    );

    expect(away.differs).toBe("Nothing differs visibly.");
    expect(away.compared).toMatch(/^640 × 360 pixels/);
    // Placed in the whole picture, not in the area.
    expect(over.areas?.[0]?.box.left).toBeCloseTo(0.12, 2);
    expect(over.areas?.[0]?.box.top).toBeCloseTo(0.7, 2);
    // But measured as a share of the area: the patch is a fifth of the width
    // and 15% of the height, and the area a quarter of the picture.
    expect(over.areas?.[0]?.share).toMatch(/^1[12]% of the area$/);
    expect(over.differs).toMatch(
      /^1[12]% of the area differs visibly, in 1 area\.$/,
    );
  });

  it("refuses an area that is not inside the picture before it runs, so the call can be mended", async () => {
    const tools = new ToolsDecodingHere(await workspace({}), {
      acceptsImages: () => true,
    });

    const inspection = await tools.inspect("compare_pictures", {
      first: "a.png",
      second: "b.png",
      area: { left: 0.6, top: 0, width: 0.6, height: 0.5 },
    });

    expect(inspection).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringMatching(/^area is left, top, width and height/),
    });
  });

  it("shows a sheet: both pictures, one over the other, and where they differ marked in red", async () => {
    const result = await compare(
      {
        "a.png": scene(640, 360),
        "b.png": scene(640, 360, { paint: red }),
      },
      { first: "a.png", second: "b.png" },
    );

    const sheet = await sheetOf(result);
    // Two panels across, two down, each 640 × 360 with a label above it.
    expect(sheet.width).toBeGreaterThan(1280);
    expect(sheet.width).toBeLessThan(1400);
    expect(sheet.height).toBeGreaterThan(720);
    expect(sheet.height).toBeLessThan(860);
    const pixel = (x: number, y: number) => {
      const at = (Math.round(y) * sheet.width + Math.round(x)) * 4;
      return [...sheet.data.subarray(at, at + 3)];
    };
    // The bottom right panel: the changed patch shows red, the sky stays pale.
    const panel = { x: sheet.width / 2, y: sheet.height / 2 };
    const inPatch = pixel(
      panel.x + 0.12 * 640 + 60,
      panel.y + 28 + 0.7 * 360 + 26,
    );
    const inSky = pixel(panel.x + 300, panel.y + 60);
    expect(inPatch[0]! - inPatch[1]!).toBeGreaterThan(100);
    expect(Math.abs(inSky[0]! - inSky[1]!)).toBeLessThan(20);
    expect(valueOf(result).picture).toMatch(
      /^The picture shows the first top left/,
    );
  });

  it("compares a PDF page with a picture, and names a page the PDF does not have", async () => {
    const files = {
      "report.pdf": simplePdf(["One", "Two"]),
      "a.png": scene(64, 64),
    };

    const drawn = await compare(files, {
      first: "report.pdf",
      firstPage: 2,
      second: "a.png",
    });
    const missing = await compare(files, {
      first: "report.pdf",
      firstPage: 3,
      second: "a.png",
    });

    expect(valueOf(drawn).first).toBe(
      "report.pdf, page 2 of 2, 816 × 1056 at 96 pixels per inch",
    );
    expect(missing).toEqual({
      ok: false,
      reason: "report.pdf has 2 pages, so it has no page 3.",
    });
  });

  it("answers that what is not a picture or a PDF cannot be compared, naming it", async () => {
    const result = await compare(
      { "notes.md": "Just words.", "a.png": scene(64, 64) },
      { first: "a.png", second: "notes.md" },
    );

    expect(result).toEqual({
      ok: false,
      reason:
        "notes.md is a text file, not a picture or a PDF, so it cannot be compared.",
    });
  });

  it("says in its description how large a picture it compares", async () => {
    const tools = new ToolsDecodingHere(await workspace({}), {
      acceptsImages: () => true,
    });

    expect(
      tools.list().find((tool) => tool.name === "compare_pictures")
        ?.description,
    ).toContain("Each can be at most 50 MB.");
  });

  it("names the size limit for a picture over it, and a smaller copy as the way round it", async () => {
    const result = await compare(
      {
        "a.png": scene(64, 64),
        "huge.png": Buffer.concat([
          scene(64, 64),
          Buffer.alloc(51 * 1024 * 1024),
        ]),
      },
      { first: "a.png", second: "huge.png" },
    );

    expect(result).toEqual({
      ok: false,
      reason:
        "huge.png is over 50 MB, too large to compare. Make a smaller copy with a command or a script, such as the one page or a scaled-down picture, and compare that.",
    });
  }, 60_000);

  it("answers a model that cannot see pictures in words, and still makes the sheet for the person", async () => {
    const result = await compare(
      {
        "a.png": scene(320, 180),
        "b.png": scene(320, 180, { paint: red }),
      },
      { first: "a.png", second: "b.png" },
      { acceptsImages: false },
    );

    expect(valueOf(result).areas).toHaveLength(1);
    expect(valueOf(result).picture).toBeUndefined();
    expect((result as { images?: unknown[] }).images).toHaveLength(1);
  });

  it("never asks for a page drawn past 4,000 pixels on its long side, however small the area", async () => {
    const asked: number[] = [];
    // A poster-sized page: 3,000 wide and 6,000 tall.
    const poster: PixelSource = {
      open: async () => ({
        ok: true,
        pages: [{ width: 3000, height: 6000 }],
        draw: async (_page, width) => {
          asked.push(width);
          const height = Math.round(width * 2);
          return {
            rgba: new Uint8Array(width * height * 4).fill(255),
            width,
            height,
          };
        },
        close: () => undefined,
      }),
    };

    await compare(
      { "a.png": scene(64, 64), "b.png": scene(64, 64) },
      {
        first: "a.png",
        second: "b.png",
        area: { left: 0.5, top: 0.5, width: 0.02, height: 0.01 },
      },
      { pixels: poster },
    );

    expect(asked).toHaveLength(2);
    for (const width of asked) expect(width).toBeLessThanOrEqual(2000);
  });

  it("decodes through the source it is given, and says when that source cannot start", async () => {
    const unstartable: PixelSource = {
      open: async () => ({ ok: false, failure: "unstartable" }),
    };

    const result = await compare(
      { "a.png": scene(64, 64), "b.png": scene(64, 64) },
      { first: "a.png", second: "b.png" },
      { pixels: unstartable },
    );

    expect(result).toMatchObject({
      ok: false,
      reason:
        "No contained process could draw the pictures, so they were not compared.",
    });
    expect((result as { correctable?: boolean }).correctable).toBeUndefined();
  });

  it("draws nothing in its own process when the app hands it no pixel source", async () => {
    const tools = new WorkspaceTools(
      await workspace({ "a.png": scene(64, 64), "b.png": scene(64, 64) }),
      { acceptsImages: () => true },
    );

    expect(
      await tools.execute("compare_pictures", {
        first: "a.png",
        second: "b.png",
      }),
    ).toEqual({
      ok: false,
      reason:
        "No contained process could draw the pictures, so they were not compared.",
    });
  });
});

describe("comparing photos a camera marked as turned", () => {
  /** A JPEG of `width` by `height` as stored, marked to be shown turned a quarter clockwise. */
  function turnedJpeg(width: number, height: number, patch: boolean): Buffer {
    const canvas = loadCanvas().createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#9cc8ee";
    context.fillRect(0, 0, width, height);
    if (patch) {
      context.fillStyle = "#e01010";
      // As stored: 60–80% across, 10–30% down.
      context.fillRect(width * 0.6, height * 0.1, width * 0.2, height * 0.2);
    }
    const jpeg = canvas.toBuffer("image/jpeg");
    // EXIF with one entry: orientation (0x0112), a short, 6.
    const tiff = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01,
      0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ]);
    const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2);
    return Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([0xff, 0xe1]),
      length,
      body,
      jpeg.subarray(2),
    ]);
  }

  it("names a large turned photo by its own size as shown, and places areas in its pixels", async () => {
    const value = valueOf(
      await compare(
        {
          "a.jpg": turnedJpeg(2400, 1600, false),
          "b.jpg": turnedJpeg(2400, 1600, true),
        },
        { first: "a.jpg", second: "b.jpg" },
      ),
    );

    // Shown turned: 1600 wide and 2400 high; the patch 70–90% across and
    // 60–80% down.
    expect(value.first).toBe("a.jpg, 1600 × 2400");
    expect(value.areas?.[0]?.where).toMatch(
      /^x 11[0-3][0-9]–14[3-6][0-9], y 14[2-5][0-9]–19[1-3][0-9] of the first picture's 1600 × 2400$/,
    );
  });
});

describe("comparing two pictures whose drawing fails", () => {
  /** A source that opens any picture as 64 × 64 and answers each draw as given. */
  const drawing = (answer: "stopped" | "unstartable"): PixelSource => ({
    open: async () => ({
      ok: true,
      pages: [{ width: 64, height: 64 }],
      draw: async () => answer,
      close: () => undefined,
    }),
  });
  const files = { "a.png": scene(64, 64), "b.png": scene(64, 64) };

  it("says a picture whose drawing took too long was stopped", async () => {
    await expect(
      compare(
        files,
        { first: "a.png", second: "b.png" },
        { pixels: drawing("stopped") },
      ),
    ).resolves.toEqual({
      ok: false,
      reason:
        "a.png could not be drawn: drawing it took too long, or its process stopped, so the pictures were not compared.",
    });
  });

  it("says no process could draw when none could start for a drawing", async () => {
    await expect(
      compare(
        files,
        { first: "a.png", second: "b.png" },
        { pixels: drawing("unstartable") },
      ),
    ).resolves.toEqual({
      ok: false,
      reason:
        "No contained process could draw the pictures, so they were not compared.",
    });
  });
});

describe("comparing two pictures, when stopped", () => {
  it("opens nothing once a comparison is stopped while the pictures are read", async () => {
    const stop = new AbortController();
    const calls: string[] = [];
    const source: PixelSource = {
      open: async () => {
        calls.push("open");
        return { ok: false, failure: "unopenable" };
      },
    };
    const picture = scene(64, 64).toString("base64");
    const tools = new ToolsDecodingHere(undefined, {
      shell: undefined,
      acceptsImages: () => true,
      pixels: source,
      items: {
        locate: async () => ({ status: "missing", reason: "Not a text." }),
        keepOutput: async () => ({ status: "refused", reason: "Not here." }),
        lastRead: async () => undefined,
        noteRead: async () => {},
        readPicture: async () => {
          stop.abort();
          return { status: "ready", mediaType: "image/png", data: picture };
        },
      },
    });

    const result = await tools.execute(
      "compare_pictures",
      { first: "attachment://before", second: "attachment://after" },
      stop.signal,
      "task-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "The comparison was cancelled.",
    });
    expect(calls).toEqual([]);
  });

  it("opens nothing more once a comparison is stopped while the first is opened", async () => {
    const stop = new AbortController();
    const calls: string[] = [];
    const source: PixelSource = {
      open: async () => {
        calls.push("open");
        stop.abort();
        return {
          ok: true,
          pages: [{ width: 64, height: 64 }],
          draw: async () => {
            calls.push("draw");
            return undefined;
          },
          close: () => undefined,
        };
      },
    };

    const result = await compare(
      { "a.png": scene(64, 64), "b.png": scene(64, 64) },
      { first: "a.png", second: "b.png" },
      { pixels: source, signal: stop.signal },
    );

    expect(result).toEqual({
      ok: false,
      reason: "The comparison was cancelled.",
    });
    expect(calls).toEqual(["open"]);
  });
});
