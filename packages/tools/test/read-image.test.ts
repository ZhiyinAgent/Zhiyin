import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";
import { imageSize } from "../src/image-size.js";

/** A one-pixel PNG, so the bytes are a real picture rather than a stand-in. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-image-"));
}

describe("looking at an image", () => {
  it("is offered only to a model that can be shown one", async () => {
    const root = await workspace();

    expect(
      new WorkspaceTools(root, { acceptsImages: () => true })
        .list()
        .map((tool) => tool.name),
    ).toContain("read_image");
    expect(
      new WorkspaceTools(root, { acceptsImages: () => false })
        .list()
        .map((tool) => tool.name),
    ).not.toContain("read_image");
    // Silence is not a claim: an unasked question is answered as no.
    expect(
      new WorkspaceTools(root).list().map((tool) => tool.name),
    ).not.toContain("read_image");
  });

  it("hands the picture back on the channel a model can see", async () => {
    const root = await workspace();
    await writeFile(join(root, "chart.png"), png);
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_image", { path: "chart.png" });

    if (!result.ok) throw new Error(result.reason);
    expect(result.images).toEqual([
      { mediaType: "image/png", data: png.toString("base64") },
    ]);
    // The text channel says what was opened, and does not repeat the picture.
    expect(JSON.stringify(result.value)).not.toContain(
      png.toString("base64").slice(0, 40),
    );
    expect(result.value).toMatchObject({ path: "chart.png" });
  });

  it("reads it without interrupting anyone when it is inside the workspace", async () => {
    const root = await workspace();
    await writeFile(join(root, "chart.png"), png);
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    expect(
      await tools.inspect("read_image", { path: "chart.png" }),
    ).toMatchObject({ ok: true, access: "read", scope: "workspace" });
  });

  it("refuses a file that is not a picture, and says which tool is", async () => {
    const root = await workspace();
    await writeFile(join(root, "notes.md"), "Just words.", "utf8");
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_image", { path: "notes.md" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Text is not a picture");
    expect(result.reason).toContain("read_file");
  });

  it("refuses a picture larger than a request may carry", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "huge.png"),
      Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]),
    );
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_image", { path: "huge.png" });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Too large to send");
    expect(result.reason).toMatch(/too large/i);
  });

  it("hands over a picture with more pixels than a model takes, and says how many", async () => {
    const root = await workspace();
    const { createCanvas } = createRequire(import.meta.url)(
      "@napi-rs/canvas",
    ) as {
      createCanvas(
        width: number,
        height: number,
      ): { toBuffer(mime: string, quality?: number): Buffer };
    };
    // Wide rather than large: past the limit on one side, and small in bytes,
    // which is exactly the shape a size check alone lets through.
    await writeFile(
      join(root, "panorama.jpg"),
      createCanvas(6400, 40).toBuffer("image/jpeg", 60),
    );
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_image", { path: "panorama.jpg" });

    // Reading a picture is not where a model's size is decided: what the file
    // holds is handed over, measured, and made to fit on its way to a model
    // that has a limit. Refusing here left the person with nothing at all.
    if (!result.ok) throw new Error(result.reason);
    expect(
      imageSize(Buffer.from(result.images?.[0]?.data ?? "", "base64")),
    ).toEqual({ width: 6400, height: 40 });
    expect(JSON.stringify(result.details)).toContain("6400");
  });

  it("passes a picture inside the limit through, measured and named", async () => {
    const root = await workspace();
    const { createCanvas } = createRequire(import.meta.url)(
      "@napi-rs/canvas",
    ) as {
      createCanvas(
        width: number,
        height: number,
      ): { toBuffer(mime: string, quality?: number): Buffer };
    };
    // Right up against the limit on both sides, which must be accepted: the
    // rule is "no more than", and an off-by-one here refuses a legal picture.
    await writeFile(
      join(root, "wide.jpg"),
      createCanvas(6000, 30).toBuffer("image/jpeg", 60),
    );
    const tools = new WorkspaceTools(root, { acceptsImages: () => true });

    const result = await tools.execute("read_image", { path: "wide.jpg" });

    if (!result.ok) throw new Error(result.reason);
    const sent = Buffer.from(result.images?.[0]?.data ?? "", "base64");
    expect(imageSize(sent)).toEqual({ width: 6000, height: 30 });
    // And what the person is shown says the size, not just the byte count.
    expect(JSON.stringify(result.details)).toContain("6000");
  });
});
