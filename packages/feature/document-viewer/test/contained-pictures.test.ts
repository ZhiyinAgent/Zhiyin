/**
 * A picture made smaller for the model is decoded in a contained process, as a
 * PDF is read in one: a picture that brings its decoder down or takes more
 * memory than allowed costs that picture, not the core.
 */

import { describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import {
  ContainedPictures,
  type DrawingProcess,
  type DrawingReply,
} from "../src/index.js";
import { pdf } from "./pdf-builder.js";
import {
  alive,
  containment,
  fixtureProcess,
  serviceProcess,
} from "./processes.js";

function png(width: number, height: number): Uint8Array {
  const canvas = loadCanvas().createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function sizeOf(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

function starting(...kinds: (() => Promise<DrawingProcess>)[]) {
  const started: DrawingProcess[] = [];
  return {
    started,
    start: async () => {
      const next = kinds[Math.min(started.length, kinds.length - 1)]!;
      const process = await next();
      started.push(process);
      return process;
    },
  };
}

/** The pixels a draw answered, failing the test on anything else. */
function pixelsOf(drawn: unknown) {
  if (!drawn || typeof drawn !== "object")
    throw new Error(`Nothing was drawn: ${String(drawn)}`);
  return drawn as { rgba: Uint8Array; width: number; height: number };
}

describe.runIf(process.platform === "win32")(
  "a picture made smaller for the model",
  () => {
    it("is drawn to the width asked for in the drawing process, as a PNG", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });

      const smaller = await pictures.smaller(png(3000, 1000), 600);

      expect(smaller).toMatchObject({ width: 600, height: 200 });
      expect(smaller && sizeOf(smaller.png)).toEqual({
        width: 600,
        height: 200,
      });
      pictures.close();
    });

    it("keeps the picture's transparency", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });
      const canvas = loadCanvas().createCanvas(3000, 1000);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(1000, 300, 1000, 400);

      const smaller = await pictures.smaller(
        new Uint8Array(canvas.toBuffer("image/png")),
        600,
      );

      const drawn = await loadCanvas().loadImage(Buffer.from(smaller!.png));
      // The engine's canvas type leaves out reading pixels, which it has.
      const check = loadCanvas().createCanvas(600, 200) as unknown as {
        getContext(kind: "2d"): {
          drawImage(
            image: unknown,
            x: number,
            y: number,
            w: number,
            h: number,
          ): void;
          getImageData(
            x: number,
            y: number,
            w: number,
            h: number,
          ): {
            data: Uint8ClampedArray;
          };
        };
      };
      check.getContext("2d").drawImage(drawn, 0, 0, 600, 200);
      const pixel = (x: number, y: number) => [
        ...check.getContext("2d").getImageData(x, y, 1, 1).data,
      ];
      expect(pixel(5, 5)).toEqual([0, 0, 0, 0]);
      expect(pixel(300, 100)).toEqual([255, 255, 255, 255]);
      pictures.close();
    });

    it("starts its process on the first picture and ends it once none has been asked for a while", async () => {
      const processes = starting(() => fixtureProcess("draws.mjs"));
      const pictures = new ContainedPictures({
        start: processes.start,
        containment,
        idleMs: 200,
      });
      expect(processes.started).toHaveLength(0);

      await pictures.smaller(png(3000, 1000), 600);
      expect(processes.started).toHaveLength(1);
      const pid = processes.started[0]!.pid;
      const deadline = Date.now() + 10_000;
      while (alive(pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));

      expect(alive(pid)).toBe(false);
      pictures.close();
    });

    it("is nothing when its bytes are not a picture", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });

      await expect(
        pictures.smaller(new Uint8Array(Buffer.from("not a picture")), 600),
      ).resolves.toBeUndefined();
      pictures.close();
    });

    it("is nothing when its process falls over, and the next picture is drawn by another", async () => {
      const processes = starting(
        () => fixtureProcess("ends-at-once.mjs"),
        serviceProcess,
      );
      const pictures = new ContainedPictures({
        start: processes.start,
        containment,
      });

      await expect(
        pictures.smaller(png(3000, 1000), 600),
      ).resolves.toBeUndefined();
      expect(alive(processes.started[0]!.pid)).toBe(false);
      await expect(
        pictures.smaller(png(3000, 1000), 600),
      ).resolves.toMatchObject({ width: 600, height: 200 });
      pictures.close();
    });

    it("opens a picture for its pixels, says its size, and draws them at the width asked, on white", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });
      // Transparent, with a red band across the middle third.
      const canvas = loadCanvas().createCanvas(300, 100);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ff0000";
      context.fillRect(100, 0, 100, 100);

      const opened = await pictures.open(
        new Uint8Array(canvas.toBuffer("image/png")),
        "picture",
      );

      expect(opened).toMatchObject({
        ok: true,
        pages: [{ width: 300, height: 100 }],
      });
      if (!opened.ok) return;
      const drawn = pixelsOf(await opened.draw(1, 150));
      expect(drawn).toMatchObject({ width: 150, height: 50 });
      const pixel = (x: number, y: number) => {
        const at = (y * drawn.width + x) * 4;
        return [...drawn.rgba.subarray(at, at + 4)];
      };
      expect(drawn.rgba.length).toBe(150 * 50 * 4);
      expect(pixel(10, 25)).toEqual([255, 255, 255, 255]);
      expect(pixel(75, 25)).toEqual([255, 0, 0, 255]);
      opened.close();
      pictures.close();
    });

    it("opens a PDF for its pixels, page by page, each page sized as the panel sizes it", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });

      const opened = await pictures.open(
        new Uint8Array(pdf({ pages: 2, size: { width: 300, height: 150 } })),
        "pdf",
      );

      expect(opened).toMatchObject({
        ok: true,
        pages: [
          { width: 400, height: 200 },
          { width: 400, height: 200 },
        ],
      });
      if (!opened.ok) return;
      const drawn = pixelsOf(await opened.draw(2, 200));
      expect(drawn).toMatchObject({ width: 200, height: 100 });
      expect(drawn!.rgba.length).toBe(200 * 100 * 4);
      expect(await opened.draw(3, 200)).toBeUndefined();
      opened.close();
      pictures.close();
    });

    it("cannot open bytes that are not a picture for their pixels", async () => {
      const pictures = new ContainedPictures({
        start: starting(serviceProcess).start,
        containment,
      });

      await expect(
        pictures.open(new Uint8Array(Buffer.from("not a picture")), "picture"),
      ).resolves.toEqual({ ok: false, failure: "unopenable" });
      pictures.close();
    });

    it("takes no pixels that are not as many as their size, wider than asked, or of another shape than the page", async () => {
      // A process that answers each draw with the pixels it is told to.
      const answering =
        (pixels: { rgba: Uint8Array; width: number; height: number }) =>
        async (): Promise<DrawingProcess> => {
          const listeners: ((reply: DrawingReply) => void)[] = [];
          return {
            pid: process.pid,
            send: (request) => {
              const reply: DrawingReply =
                request.kind === "open"
                  ? {
                      id: request.id,
                      ok: true,
                      kind: "opened",
                      pages: [{ width: 10, height: 10 }],
                    }
                  : request.kind === "draw"
                    ? { id: request.id, ok: true, kind: "pixels", ...pixels }
                    : { id: request.id, ok: true, kind: "released" };
              queueMicrotask(() =>
                listeners.forEach((listen) => listen(reply)),
              );
            },
            onReply: (listener) => listeners.push(listener),
            onExit: () => undefined,
            kill: () => undefined,
          };
        };
      const drawnBy = async (
        pixels: { rgba: Uint8Array; width: number; height: number },
        width: number,
      ) => {
        const pictures = new ContainedPictures({
          start: starting(answering(pixels)).start,
          containment,
        });
        const opened = await pictures.open(png(10, 10), "picture");
        expect(opened.ok).toBe(true);
        const drawn = opened.ok ? await opened.draw(1, width) : undefined;
        if (opened.ok) opened.close();
        pictures.close();
        return drawn;
      };

      const whole = { rgba: new Uint8Array(400), width: 10, height: 10 };
      await expect(drawnBy(whole, 10)).resolves.toMatchObject({
        width: 10,
        height: 10,
      });
      await expect(
        drawnBy({ rgba: new Uint8Array(12), width: 10, height: 10 }, 10),
      ).resolves.toBeUndefined();
      await expect(drawnBy(whole, 5)).resolves.toBeUndefined();
      // As many pixels as they say, for a page ten wide and ten high, but
      // eight hundred high.
      await expect(
        drawnBy(
          { rgba: new Uint8Array(10 * 800 * 4), width: 10, height: 800 },
          10,
        ),
      ).resolves.toBeUndefined();
    });

    it("says a page whose drawing took too long was stopped", async () => {
      // A process that opens the picture, then never answers a draw.
      const opensOnly = async (): Promise<DrawingProcess> => {
        const listeners: ((reply: DrawingReply) => void)[] = [];
        return {
          pid: process.pid,
          send: (request) => {
            if (request.kind !== "open") return;
            const reply: DrawingReply = {
              id: request.id,
              ok: true,
              kind: "opened",
              pages: [{ width: 10, height: 10 }],
            };
            queueMicrotask(() => listeners.forEach((listen) => listen(reply)));
          },
          onReply: (listener) => listeners.push(listener),
          onExit: () => undefined,
          kill: () => undefined,
        };
      };
      const pictures = new ContainedPictures({
        start: starting(opensOnly).start,
        containment,
        timeoutMs: 50,
      });

      const opened = await pictures.open(png(10, 10), "picture");

      expect(opened.ok).toBe(true);
      if (opened.ok) await expect(opened.draw(1, 10)).resolves.toBe("stopped");
      pictures.close();
    });

    it("says an open that took too long was stopped, not that the picture is damaged", async () => {
      // A process that never answers.
      const silent = async (): Promise<DrawingProcess> => ({
        pid: process.pid,
        send: () => undefined,
        onReply: () => undefined,
        onExit: () => undefined,
        kill: () => undefined,
      });
      const pictures = new ContainedPictures({
        start: starting(silent).start,
        containment,
        timeoutMs: 50,
      });

      await expect(pictures.open(png(10, 10), "picture")).resolves.toEqual({
        ok: false,
        failure: "stopped",
      });
      pictures.close();
    });

    it("is nothing when its process takes more memory than allowed, which ends that process", async () => {
      const processes = starting(() => fixtureProcess("allocates.mjs"));
      const pictures = new ContainedPictures({
        start: processes.start,
        containment,
        processMemoryLimit: 256 * 1024 * 1024,
      });

      await expect(
        pictures.smaller(png(3000, 1000), 600),
      ).resolves.toBeUndefined();
      const pid = processes.started[0]!.pid;
      const deadline = Date.now() + 10_000;
      while (alive(pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(alive(pid)).toBe(false);
      pictures.close();
    });
  },
);
