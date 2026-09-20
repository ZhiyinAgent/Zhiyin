import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { CanvasPictureFitting } from "../src/fit-picture.js";
import { imageSize } from "../src/image-size.js";

/** A picture of a stated size, as a tool would hand one over. */
function pictureOf(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#3366cc";
  context.fillRect(0, 0, width, height);
  return {
    mediaType: "image/png",
    data: canvas.toBuffer("image/png").toString("base64"),
  };
}

function sizeOf(data: string) {
  return imageSize(Buffer.from(data, "base64"));
}

describe("fitting a picture to what a model accepts", () => {
  it("leaves a picture that already fits exactly as it was", async () => {
    const picture = pictureOf(1_600, 900);

    const fitted = await new CanvasPictureFitting().fit(picture);

    expect(fitted).toEqual({ status: "unchanged", image: picture });
  });

  it("fits a picture to the resolution models actually read", async () => {
    // Not the size a provider would refuse — those range from 2048 to 65535
    // depending on a model chosen later. This is the size above which the
    // pixels are discarded on arrival, and it is the same for every model.
    const fitted = await new CanvasPictureFitting().fit(
      pictureOf(3_000, 1_500),
    );

    expect(fitted.status).toBe("resized");
    if (fitted.status !== "resized") return;
    expect(sizeOf(fitted.image.data)).toEqual({ width: 2_000, height: 1_000 });
  });

  it("shrinks a picture past the limit instead of refusing it", async () => {
    const fitting = new CanvasPictureFitting({ maximumPixels: 1_000 });

    const fitted = await fitting.fit(pictureOf(2_000, 1_000));

    expect(fitted.status).toBe("resized");
    if (fitted.status !== "resized") return;
    // Both sides inside the limit, and the shape of the thing preserved.
    expect(sizeOf(fitted.image.data)).toEqual({ width: 1_000, height: 500 });
    expect(fitted.note).toContain("2000 by 1000");
    expect(fitted.note).toContain("1000 by 500");
  });

  it("warns that a page too tall to read is too tall to read", async () => {
    const fitting = new CanvasPictureFitting({ maximumPixels: 1_000 });

    const fitted = await fitting.fit(pictureOf(390, 6_231));

    expect(fitted.status).toBe("resized");
    if (fitted.status !== "resized") return;
    // Scaling a whole tall page to fit leaves text no one can read. Saying so
    // is the difference between the model trusting a blur and looking again.
    expect(fitted.note).toContain("may be unreadable");
    expect(fitted.note).toContain("a section at a time");
  });

  it("says a picture is unusable rather than sending something illegible", async () => {
    const fitting = new CanvasPictureFitting({ maximumPixels: 100 });

    const fitted = await fitting.fit(pictureOf(80, 9_000));

    expect(fitted.status).toBe("unusable");
    if (fitted.status !== "unusable") return;
    expect(fitted.note).toContain("80 by 9000");
  });

  it("passes through a picture it cannot read rather than dropping it", async () => {
    const opaque = { mediaType: "image/heic", data: "bm90IGFuIGltYWdl" };

    const fitted = await new CanvasPictureFitting().fit(opaque);

    expect(fitted).toEqual({ status: "unchanged", image: opaque });
  });
});
