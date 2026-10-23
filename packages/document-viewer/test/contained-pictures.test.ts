/**
 * A picture made smaller for the model is decoded in a contained process, as a
 * PDF is read in one: a picture that brings its decoder down or takes more
 * memory than allowed costs that picture, not the core.
 */

import { describe, expect, it } from "vitest";
import { loadCanvas } from "@zhiyin/pdf-engine";
import { ContainedPictures, type DrawingProcess } from "../src/index.js";
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
