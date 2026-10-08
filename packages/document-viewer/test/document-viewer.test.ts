import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { DocumentPanelState } from "@zhiyin/contract";
import { loadCanvas } from "@zhiyin/pdf-engine";
import {
  DocumentViewer,
  mayOpenInItsOwnApp,
  type DrawingProcess,
} from "../src/index.js";
import { pdf, protectedPdf } from "./pdf-builder.js";
import { containment, serviceProcess } from "./processes.js";

async function workspace() {
  const parent = await mkdtemp(join(tmpdir(), "zhiyin-documents-"));
  const root = join(parent, "work");
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports", "q3.pdf"), pdf({ pages: 3 }));
  await writeFile(join(parent, "secret.pdf"), pdf());
  return { parent, root };
}

function viewer(root: string, options: { redrawIntervalMs?: number } = {}) {
  const started: DrawingProcess[] = [];
  const changes: DocumentPanelState[] = [];
  const documents = new DocumentViewer({
    start: async () => {
      const process = await serviceProcess();
      started.push(process);
      return process;
    },
    containment,
    ...options,
  });
  documents.onChange((conversation, state) => {
    if (conversation === "c1") changes.push(state);
  });
  return { documents, started, changes };
}

function png(width: number, height: number): Buffer {
  const canvas = loadCanvas().createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

const settled = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("the documents a conversation shows", () => {
  it("shows a workspace PDF with its name, its folder and the size of each page", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await expect(documents.show("c1", root, "reports/q3.pdf")).resolves.toEqual(
      {
        ok: true,
      },
    );
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      path: "reports/q3.pdf",
      name: "q3.pdf",
      folder: "reports",
      kind: "pdf",
      pages: [
        { width: 816, height: 1056 },
        { width: 816, height: 1056 },
        { width: 816, height: 1056 },
      ],
      openable: true,
      documents: [
        { path: "reports/q3.pdf", name: "q3.pdf", folder: "reports" },
      ],
    });
  });

  it("draws a page of the shown document as a PNG, at the width asked for", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);
    const page = await documents.drawPage("c1", state.revision, 2, 400);
    expect(page).toMatchObject({ ok: true, width: 400, height: 518 });
    expect(page.ok && page.data.startsWith("data:image/png;base64,")).toBe(
      true,
    );
  });

  it("refuses a path outside the workspace, or through a link out of it, and shows nothing", async () => {
    const { parent, root } = await workspace();
    await symlink(parent, join(root, "up"), "junction");
    const { documents, started } = viewer(root);
    for (const path of [
      "../secret.pdf",
      join(parent, "secret.pdf"),
      "up/secret.pdf",
    ]) {
      await expect(documents.show("c1", root, path), path).resolves.toEqual({
        ok: false,
        reason: `${path.replaceAll("\\", "/")} is outside the folder this conversation works in, so it is not shown.`,
      });
    }
    expect(documents.state("c1")).toMatchObject({ status: "closed" });
    expect(started).toHaveLength(0);
  });

  it("says a file too large to draw is too large, how large it is, and reads none of it", async () => {
    const { root } = await workspace();
    const file = await open(join(root, "huge.pdf"), "w");
    await file.truncate(100 * 1024 * 1024 + 1);
    await file.close();
    const { documents, started } = viewer(root);
    await documents.show("c1", root, "huge.pdf");
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      reason:
        "huge.pdf is 100.0 MB, larger than the 100 MB this panel draws. Open it in its own app or save a copy instead.",
    });
    expect(started).toHaveLength(0);
  });

  it("says a PDF with more pages than it draws has too many", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "long.pdf"), pdf({ pages: 2001 }));
    const { documents } = viewer(root);
    await documents.show("c1", root, "long.pdf");
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      reason: "long.pdf has 2001 pages, more than the 2,000 this panel draws.",
    });
  });

  it("says which: damaged, protected, a picture with no size, not a document, or gone", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "broken.pdf"), "%PDF-1.7\nnothing here");
    await writeFile(join(root, "locked.pdf"), protectedPdf());
    await writeFile(
      join(root, "empty.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
    );
    await writeFile(join(root, "notes.txt"), "plain words");
    const { documents } = viewer(root);
    const reasons: Record<string, string> = {
      "broken.pdf": "broken.pdf could not be opened. It may be damaged.",
      "locked.pdf":
        "locked.pdf is protected by a password, so its pages cannot be shown.",
      "empty.svg":
        "empty.svg could not be read as a picture. It may be damaged.",
      "notes.txt": "notes.txt is not a PDF or a picture this panel can draw.",
      "gone.pdf":
        "gone.pdf is not in the workspace. It may have been moved, renamed or deleted.",
    };
    for (const [path, reason] of Object.entries(reasons)) {
      await documents.show("c1", root, path);
      expect(documents.state("c1"), path).toMatchObject({
        status: "failed",
        reason,
      });
    }
  });

  /*
   * A file is recognised by its head, and an SVG's head may open with comments.
   * Read with a pattern that could split "--><!--" either way, each one would
   * double the time: twenty-six would take seconds, and the kilobyte read would
   * not finish, holding the app's main process with it.
   */
  it("says at once what a file of many comments is, whether or not a picture follows them", async () => {
    const { root } = await workspace();
    const comments = "<!--" + "--><!--".repeat(26) + "-->";
    await writeFile(join(root, "comments.svg"), comments);
    await writeFile(
      join(root, "unclosed.svg"),
      `${comments}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"`,
    );
    const { documents } = viewer(root);
    const reasons: Record<string, string> = {
      "comments.svg":
        "comments.svg is not a PDF or a picture this panel can draw.",
      "unclosed.svg":
        "unclosed.svg could not be read as a picture. It may be damaged.",
    };
    for (const [path, reason] of Object.entries(reasons)) {
      const started = performance.now();
      await documents.show("c1", root, path);
      expect({
        state: documents.state("c1"),
        atOnce: performance.now() - started < 2_000,
      }).toMatchObject({ state: { status: "failed", reason }, atOnce: true });
    }
  });

  it("shows a picture as one page, no larger than 2,000 pixels on its long side", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "chart.png"), png(3000, 1000));
    const { documents } = viewer(root);
    await documents.show("c1", root, "chart.png");
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      kind: "picture",
      pages: [{ width: 2000, height: 667 }],
    });
  });

  it("shows an SVG picture as one page, sized from its own width, height or viewBox, no larger than 2,000 pixels, even one that declares itself enormous", async () => {
    const { root } = await workspace();
    const svg = (attributes: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="10" height="10"/></svg>`;
    await writeFile(join(root, "sized.svg"), svg('width="120" height="80"'));
    await writeFile(join(root, "inches.svg"), svg('width="2in" height="1in"'));
    await writeFile(join(root, "box.svg"), svg('viewBox="0 0 240 160"'));
    await writeFile(
      join(root, "wide.svg"),
      svg('width="100%" height="100%" viewBox="0 0 50 25"'),
    );
    // Decoded at the size it declares, this one ends the drawing process.
    await writeFile(
      join(root, "huge.svg"),
      svg('width="100000" height="100000"'),
    );
    const { documents } = viewer(root);
    const expected: Record<string, { width: number; height: number }> = {
      "sized.svg": { width: 120, height: 80 },
      "inches.svg": { width: 192, height: 96 },
      "box.svg": { width: 240, height: 160 },
      "wide.svg": { width: 50, height: 25 },
      "huge.svg": { width: 2000, height: 2000 },
    };
    for (const [path, size] of Object.entries(expected)) {
      await documents.show("c1", root, path);
      const state = documents.state("c1");
      expect(state, path).toMatchObject({
        status: "shown",
        kind: "picture",
        pages: [size],
      });
      if (state.status !== "shown") continue;
      await expect(
        documents.drawPage("c1", state.revision, 1, size.width),
        path,
      ).resolves.toMatchObject({ ok: true, ...size });
    }
  });

  it("draws what an SVG holds and nothing it refers to: no address, file or font is reached", async () => {
    const { root } = await workspace();
    const reached: string[] = [];
    const red = png(20, 20);
    const server = createServer((request, response) => {
      reached.push(request.url ?? "");
      response.end(red);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const remote = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const onDisk = join(root, "red.png");
    await writeFile(onDisk, red);
    const elsewhere = [
      `<image href="${remote}/a.png" width="100" height="100"/>`,
      `<image href="${pathToFileURL(onDisk).href}" width="100" height="100"/>`,
      `<image href="red.png" width="100" height="100"/>`,
      `<use href="${remote}/b.svg#x"/>`,
      `<style>@import url(${remote}/c.css); @font-face { font-family: F; src: url(${remote}/d.woff) }</style>`,
      `<filter id="f"><feImage href="${remote}/e.png"/></filter><rect width="10" height="10" filter="url(#f)"/>`,
    ].join("");
    await writeFile(
      join(root, "logo.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff"/>${elsewhere}</svg>`,
    );
    const { documents } = viewer(root);
    try {
      await documents.show("c1", root, "logo.svg");
      const state = documents.state("c1");
      if (state.status !== "shown") throw new Error(state.status);
      const page = await documents.drawPage("c1", state.revision, 1, 100);
      if (!page.ok) throw new Error(page.reason);
      const canvas = loadCanvas();
      const image = await canvas.loadImage(
        Buffer.from(page.data.slice(page.data.indexOf(",") + 1), "base64"),
      );
      const drawn = canvas.createCanvas(100, 100).getContext("2d");
      drawn.drawImage(image, 0, 0);
      const pixels = drawn.getImageData(0, 0, 100, 100).data;
      let blue = 0;
      let reddish = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        if (pixels[at + 2]! > 200 && pixels[at]! < 50) blue++;
        if (pixels[at]! > 200 && pixels[at + 2]! < 50) reddish++;
      }
      // The filtered corner paints black: its picture is not fetched.
      expect(blue).toBe(9_900);
      expect(reddish).toBe(0);
      await settled(300);
      expect(reached).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("points at a page it was asked for, and refuses one past the end with the count", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf", { page: 2 });
    expect(documents.state("c1")).toMatchObject({
      pointed: { page: 2, count: 1 },
    });
    await expect(
      documents.show("c1", root, "reports/q3.pdf", { page: 5 }),
    ).resolves.toEqual({
      ok: false,
      reason: "q3.pdf has 3 pages, so there is no page 5.",
    });
    expect(documents.state("c1")).toMatchObject({
      pointed: { page: 2, count: 1 },
    });
  });

  it("shows the document written last, and lists the conversation's documents", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "flyer.png"), png(40, 60));
    await writeFile(join(root, "notes.md"), "words");
    const { documents } = viewer(root);
    await expect(
      documents.written("c1", root, [
        "reports/q3.pdf",
        "notes.md",
        "flyer.png",
      ]),
    ).resolves.toEqual(["reports/q3.pdf", "flyer.png"]);
    await settled(50);
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      path: "flyer.png",
      documents: [
        { path: "flyer.png", name: "flyer.png", folder: "" },
        { path: "reports/q3.pdf", name: "q3.pdf", folder: "reports" },
      ],
    });
  });

  it("draws writes in a burst at most once per interval, the latest last", async () => {
    const { root } = await workspace();
    const interval = 400;
    const { documents, changes } = viewer(root, { redrawIntervalMs: interval });
    const drawn = () => changes.filter((state) => state.status === "shown");
    // The burst is timed rather than assumed to fit in one interval: under
    // load, five writes can span two, and a third draw is then correct.
    const started = Date.now();
    for (let pages = 1; pages <= 5; pages++) {
      await writeFile(join(root, "draft.pdf"), pdf({ pages }));
      await documents.written("c1", root, ["draft.pdf"]);
      await settled(40);
    }
    const burst = Date.now() - started;
    for (let waited = 0; waited < 5000; waited += 50) {
      const last = drawn().at(-1);
      if (last?.status === "shown" && last.pages.length === 5) break;
      await settled(50);
    }
    await settled(interval + 100);

    // The first write, then at most one draw per interval the burst spanned,
    // then the latest once the burst is over.
    expect(drawn().length).toBeLessThanOrEqual(
      Math.floor(burst / interval) + 2,
    );
    expect(drawn().at(-1)).toMatchObject({ pages: { length: 5 } });
  });

  it("draws a document shown and reported written at the same moment", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "logo.png"), png(200, 200));

    // A command wrote the picture, and the agent read it as the command's
    // changes were reported: two loads of the same bytes, one revision. Which
    // finishes first varies, so both orders are tried, several times.
    const drawn: boolean[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const { documents } = viewer(root);
      const show = () => documents.show("c1", root, "logo.png");
      const written = () => documents.written("c1", root, ["logo.png"]);
      await Promise.all(
        attempt % 2 ? [show(), written()] : [written(), show()],
      );
      // The written file's load may still be on its way; wait for it to land
      // rather than for a guessed time.
      const deadline = Date.now() + 10_000;
      while (
        documents.state("c1").status === "opening" &&
        Date.now() < deadline
      )
        await settled(25);
      const state = documents.state("c1");
      if (state.status !== "shown") throw new Error(state.status);
      drawn.push((await documents.drawPage("c1", state.revision, 1, 400)).ok);
      documents.shutdown();
    }

    expect(drawn).toEqual(Array.from({ length: 8 }, () => true));
  });

  it("says a page of a version no longer shown is not drawn", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    await writeFile(join(root, "reports", "q3.pdf"), pdf({ pages: 4 }));
    await documents.show("c1", root, "reports/q3.pdf");
    await expect(
      documents.drawPage("c1", before.revision, 1, 300),
    ).resolves.toEqual({
      ok: false,
      reason: "This version of the document is no longer shown.",
    });
  });

  it("keeps each conversation's document apart, and closing one leaves the other", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "other.pdf"), pdf());
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf");
    await documents.show("c2", root, "other.pdf");
    documents.close("c1");
    expect(documents.state("c1")).toMatchObject({ status: "closed" });
    expect(documents.state("c2")).toMatchObject({
      status: "shown",
      path: "other.pdf",
    });
  });

  it("draws the shown document again as it now is after going back, or says it is gone", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf");
    await writeFile(join(root, "reports", "q3.pdf"), pdf({ pages: 2 }));
    await documents.refresh("c1", root);
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      pages: { length: 2 },
    });
    await rm(join(root, "reports", "q3.pdf"));
    await documents.refresh("c1", root);
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      reason:
        "q3.pdf is not in the workspace. It may have been moved, renamed or deleted.",
    });
  });

  it("leaves a closed panel closed when asked to draw again", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);
    await documents.show("c1", root, "reports/q3.pdf");
    documents.close("c1");
    await documents.refresh("c1", root);
    expect(documents.state("c1")).toMatchObject({ status: "closed" });
  });

  it("finds a file to open or show in its folder only inside the workspace, and says whether Windows may open it", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "setup.exe"), "MZ");
    const { documents } = viewer(root);
    const found = await documents.locate(root, "reports/q3.pdf");
    expect(found).toMatchObject({ ok: true, openable: true });
    expect(found.ok && (await realpath(found.path))).toBe(
      await realpath(join(root, "reports", "q3.pdf")),
    );
    await expect(documents.locate(root, "setup.exe")).resolves.toMatchObject({
      ok: true,
      openable: false,
    });
    await expect(documents.locate(root, "../secret.pdf")).resolves.toEqual({
      ok: false,
      reason: "../secret.pdf is outside the folder this conversation works in.",
    });
    await expect(documents.locate(root, "gone.pdf")).resolves.toEqual({
      ok: false,
      reason:
        "gone.pdf is not in the workspace. It may have been moved, renamed or deleted.",
    });
  });

  it("offers Windows' own app for documents and pictures, and never for a program", () => {
    for (const path of [
      "a.pdf",
      "b.PNG",
      "c.jpeg",
      "d.docx",
      "e.xlsx",
      "f.pptx",
    ])
      expect(mayOpenInItsOwnApp(path), path).toBe(true);
    for (const path of [
      "setup.exe",
      "run.bat",
      "script.js",
      "a.pdf.exe",
      "x.lnk",
      "page.html",
      // Its own app is a browser, which would run the scripts it can hold.
      "logo.svg",
    ])
      expect(mayOpenInItsOwnApp(path), path).toBe(false);
  });
});
