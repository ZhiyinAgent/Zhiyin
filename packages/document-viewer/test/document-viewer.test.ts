import {
  mkdir,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, onTestFailed } from "vitest";
import type { DocumentPanelState } from "@zhiyin/contract";
import { loadCanvas } from "@zhiyin/pdf-engine";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { changed, until } from "@zhiyin/test-waits";
import {
  DocumentViewer,
  mayOpenInItsOwnApp,
  type DrawingProcess,
  type DrawingRequest,
} from "../src/index.js";
import { pdf, protectedPdf } from "./pdf-builder.js";
import { containment, serviceProcess } from "./processes.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace() {
  const parent = await folders.make("zhiyin-documents-");
  const root = join(parent, "work");
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports", "q3.pdf"), pdf({ pages: 3 }));
  await writeFile(join(parent, "secret.pdf"), pdf());
  return { parent, root };
}

function viewer(
  _root: string,
  options: {
    redrawIntervalMs?: number;
    idleMs?: number;
    /** Runs before each start, may hold it, and may refuse it by throwing. */
    starting?: () => void | Promise<void>;
  } = {},
) {
  const started: DrawingProcess[] = [];
  const changes: DocumentPanelState[] = [];
  const { starting, ...limits } = options;
  const documents = new DocumentViewer({
    start: async () => {
      await starting?.();
      const process = await serviceProcess();
      started.push(process);
      return process;
    },
    containment,
    ...limits,
  });
  documents.onChange((conversation, state) => {
    if (conversation === "c1") changes.push(state);
    changed();
  });
  return { documents, started, changes };
}

/**
 * A viewer whose processes are the real service, with what each is asked
 * kept, and its containers' closing, which ends a process, counted. Given
 * `drawnBytes`, every page comes back as a PNG that long; a request `hold`
 * answers with a promise reaches the process once that settles.
 */
function watchedViewer(
  options: {
    idleMs?: number;
    drawnBytes?: number;
    hold?: (request: DrawingRequest) => Promise<void> | undefined;
  } = {},
) {
  const asked: DrawingRequest[] = [];
  const started: DrawingProcess[] = [];
  let ended = 0;
  const { drawnBytes, hold } = options;
  const documents = new DocumentViewer({
    start: async () => {
      const process = await serviceProcess();
      started.push(process);
      return {
        ...process,
        send: (request) => {
          asked.push(request);
          const held = hold?.(request);
          if (held) void held.then(() => process.send(request));
          else process.send(request);
        },
        onReply: (listener) =>
          process.onReply((reply) =>
            listener(
              drawnBytes && reply.ok && reply.kind === "drawn"
                ? { ...reply, png: new Uint8Array(drawnBytes) }
                : reply,
            ),
          ),
      };
    },
    containment: {
      open: (limits) => {
        const container = containment.open(limits);
        return {
          contain: (pid) => container.contain(pid),
          close: () => {
            ended += 1;
            container.close();
          },
        };
      },
    },
    ...(options.idleMs ? { idleMs: options.idleMs } : {}),
  });
  return {
    documents,
    started,
    ended: () => ended,
    asked: (kind: DrawingRequest["kind"]) =>
      asked.filter((request) => request.kind === kind).length,
  };
}

function png(width: number, height: number): Buffer {
  const canvas = loadCanvas().createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/** How many pixels of a drawn 100-pixel square page are blue, and how many red. */
async function colours(
  data: string,
): Promise<{ blue: number; reddish: number }> {
  const canvas = loadCanvas();
  const image = await canvas.loadImage(
    Buffer.from(data.slice(data.indexOf(",") + 1), "base64"),
  );
  // The drawing library's own context, which reads pixels back.
  const drawn = canvas.createCanvas(100, 100).getContext("2d") as unknown as {
    drawImage(image: unknown, x: number, y: number): void;
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
    ): { data: Uint8ClampedArray };
  };
  drawn.drawImage(image, 0, 0);
  const pixels = drawn.getImageData(0, 0, 100, 100).data;
  let blue = 0;
  let reddish = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 2]! > 200 && pixels[at]! < 50) blue++;
    if (pixels[at]! > 200 && pixels[at + 2]! < 50) reddish++;
  }
  return { blue, reddish };
}

/**
 * A fixed time, for the two things a condition cannot stand for: spacing
 * what a test does, and giving something that must not happen the time to.
 * What the viewer is expected to reach is waited for with `until`.
 */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it("draws a page asked for behind one that never finishes, though the process drawing both is ended", async () => {
    const { root } = await workspace();
    const documents = new DocumentViewer({
      // A drawing process that never answers for page 2, and draws the rest.
      start: async () => {
        const served = await serviceProcess();
        return {
          ...served,
          send: (request) => {
            if (request.kind !== "draw" || request.page !== 2)
              served.send(request);
          },
        };
      },
      containment,
      timeoutMs: 1_500,
    });
    await documents.show("c1", root, "reports/q3.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);

    const [stuck, next] = await Promise.all([
      documents.drawPage("c1", state.revision, 2, 300),
      documents.drawPage("c1", state.revision, 3, 300),
    ]);

    expect(stuck).toEqual({ ok: false, reason: "Page 2 could not be drawn." });
    expect(next).toMatchObject({ ok: true, width: 300 });
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

  it("knows a file by its bytes as the agent's tools do: a PDF after a line break, but no text that mentions a header or begins with a signature's letters", async () => {
    const { root } = await workspace();
    await writeFile(
      join(root, "export.pdf"),
      Buffer.concat([Buffer.from("\r\n"), pdf()]),
    );
    await writeFile(
      join(root, "about.pdf"),
      "A PDF starts with %PDF- and a version.\n",
    );
    await writeFile(join(root, "cars.bmp"), "BMW,320i,2019\nAudi,A4,2020\n");
    const { documents } = viewer(root);

    await documents.show("c1", root, "export.pdf");
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      kind: "pdf",
    });
    for (const path of ["about.pdf", "cars.bmp"]) {
      await documents.show("c1", root, path);
      expect(documents.state("c1"), path).toMatchObject({
        status: "failed",
        reason: `${path} is not a PDF or a picture this panel can draw.`,
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
    const doctype = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">';
    await writeFile(join(root, "comments.svg"), comments);
    await writeFile(
      join(root, "unclosed.svg"),
      `${comments}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"`,
    );
    await writeFile(
      join(root, "declared.svg"),
      `${comments}${doctype}${comments}`,
    );
    await writeFile(
      join(root, "declared-unclosed.svg"),
      `${comments}${doctype}${comments}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"`,
    );
    const { documents } = viewer(root);
    const reasons: Record<string, string> = {
      "comments.svg":
        "comments.svg is not a PDF or a picture this panel can draw.",
      "unclosed.svg":
        "unclosed.svg could not be read as a picture. It may be damaged.",
      "declared.svg":
        "declared.svg is not a PDF or a picture this panel can draw.",
      "declared-unclosed.svg":
        "declared-unclosed.svg could not be read as a picture. It may be damaged.",
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

  it("shows an SVG that opens with a byte-order mark, or with a DOCTYPE among comments, as matplotlib, Graphviz and Illustrator write them", async () => {
    const { root } = await workspace();
    const dtd =
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
    const body = '<rect width="10" height="10"/></svg>\n';
    await writeFile(
      join(root, "matplotlib.svg"),
      `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n${dtd}\n<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="460.8pt" height="345.6pt" viewBox="0 0 460.8 345.6" xmlns="http://www.w3.org/2000/svg" version="1.1">\n${body}`,
    );
    await writeFile(
      join(root, "graphviz.svg"),
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${dtd}\n<!-- Generated by graphviz version 2.43.0 (0)\n -->\n<!-- Title: G Pages: 1 -->\n<svg width="62pt" height="116pt"\n viewBox="0.00 0.00 62.00 116.00" xmlns="http://www.w3.org/2000/svg">\n${body}`,
    );
    await writeFile(
      join(root, "illustrator.svg"),
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n${dtd}\n<svg version="1.1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="200px" height="100px" viewBox="0 0 200 100" xml:space="preserve">\n${body}`,
    );
    await writeFile(
      join(root, "marked.svg"),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">${body}`,
        ),
      ]),
    );
    const { documents } = viewer(root);
    const expected: Record<string, { width: number; height: number }> = {
      "matplotlib.svg": { width: 614, height: 461 },
      "graphviz.svg": { width: 83, height: 155 },
      "illustrator.svg": { width: 200, height: 100 },
      "marked.svg": { width: 120, height: 80 },
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

  it("does not take for a picture an SVG whose DOCTYPE declares anything of its own", async () => {
    const { root } = await workspace();
    await writeFile(
      join(root, "entities.svg"),
      '<?xml version="1.0"?>\n<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&b;</text></svg>',
    );
    const { documents, started } = viewer(root);
    await documents.show("c1", root, "entities.svg");
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      reason: "entities.svg is not a PDF or a picture this panel can draw.",
    });
    expect(started).toHaveLength(0);
  });

  /*
   * A file has no way to say it was read, so the file named is a pipe, which
   * sees whoever opens it.
   */
  it("draws an SVG whose DOCTYPE names a local address or file without reaching either", async () => {
    const { root } = await workspace();
    const reached: string[] = [];
    const server = createServer((request, response) => {
      reached.push(request.url ?? "");
      response.end('<!ENTITY fill "#ff0000">');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const remote = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const pipe = `\\\\.\\pipe\\zhiyin-dtd-${process.pid}-${Date.now()}`;
    const file = createNetServer((socket) => {
      reached.push(pipe);
      socket.end('<!ENTITY fill "#ff0000">');
    });
    await new Promise<void>((resolve) => file.listen(pipe, resolve));
    const square =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff"/></svg>';
    await writeFile(
      join(root, "remote.svg"),
      `<?xml version="1.0"?>\n<!DOCTYPE svg SYSTEM "${remote}/colours.dtd">\n${square}`,
    );
    await writeFile(
      join(root, "local.svg"),
      `<!DOCTYPE svg PUBLIC "-//Zhiyin//Test//EN" "${pipe}">\n${square}`,
    );
    const { documents } = viewer(root);
    try {
      for (const path of ["remote.svg", "local.svg"]) {
        await documents.show("c1", root, path);
        const state = documents.state("c1");
        if (state.status !== "shown")
          throw new Error(`${path}: ${state.status}`);
        const page = await documents.drawPage("c1", state.revision, 1, 100);
        expect(page, path).toMatchObject({ ok: true, width: 100 });
        if (!page.ok) continue;
        expect(await colours(page.data), path).toEqual({
          blue: 10_000,
          reddish: 0,
        });
      }
      // Nothing is waited for here: a fetch, had one been made, has had time.
      await pause(300);
      expect(reached).toEqual([]);
    } finally {
      server.close();
      file.close();
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
      // The filtered corner paints black: its picture is not fetched.
      expect(await colours(page.data)).toEqual({ blue: 9_900, reddish: 0 });
      // Nothing is waited for here: a fetch, had one been made, has had time.
      await pause(300);
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
    await until(() => documents.state("c1").status === "shown");
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
      await pause(40);
    }
    const burst = Date.now() - started;
    await until(() => {
      const last = drawn().at(-1);
      return last?.status === "shown" && last.pages.length === 5;
    });
    // A draw too many, had one been owed, has had its interval to come.
    await pause(interval + 100);

    // The first write, then at most one draw per interval the burst spanned,
    // then the latest once the burst is over.
    expect(drawn().length).toBeLessThanOrEqual(
      Math.floor(burst / interval) + 2,
    );
    expect(drawn().at(-1)).toMatchObject({ pages: { length: 5 } });
  });

  it("never goes back to a document written earlier once another is written or shown", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "a.pdf"), pdf());
    await writeFile(join(root, "b.pdf"), pdf({ pages: 2 }));
    const interval = 1500;
    for (const then of ["written", "shown"] as const) {
      const { documents, changes } = viewer(root, {
        redrawIntervalMs: interval,
      });
      await documents.written("c1", root, ["a.pdf"]);
      await until(() => documents.state("c1").status === "shown");
      // Drawn at once the first time, a.pdf written again waits its interval.
      await documents.written("c1", root, ["a.pdf"]);
      if (then === "written") await documents.written("c1", root, ["b.pdf"]);
      else await documents.show("c1", root, "b.pdf");
      await until(() => {
        const state = documents.state("c1");
        return state.status === "shown" && state.path === "b.pdf";
      });
      // a.pdf's interval has ended: a redraw still owed would have come.
      await pause(interval + 300);

      const shown = changes.flatMap((state) =>
        state.status === "shown" ? [state.path] : [],
      );
      expect(shown, then).toEqual(["a.pdf", "b.pdf"]);
      documents.shutdown();
    }
  });

  it("still draws a document written again when a page of another was asked for and refused", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "a.pdf"), pdf());
    await writeFile(join(root, "b.pdf"), pdf({ pages: 2 }));
    const interval = 1500;
    const { documents } = viewer(root, { redrawIntervalMs: interval });
    await documents.written("c1", root, ["a.pdf"]);
    await until(() => documents.state("c1").status === "shown");
    await writeFile(join(root, "a.pdf"), pdf({ pages: 3 }));
    await documents.written("c1", root, ["a.pdf"]);
    await expect(
      documents.show("c1", root, "b.pdf", { page: 9 }),
    ).resolves.toEqual({
      ok: false,
      reason: "b.pdf has 2 pages, so there is no page 9.",
    });

    await until(() => {
      const state = documents.state("c1");
      return state.status === "shown" && state.pages.length === 3;
    });
    expect(documents.state("c1")).toMatchObject({ path: "a.pdf" });
    documents.shutdown();
  });

  it.each(["another document", "the same document"])(
    "goes back to what it showed when a page of %s that is not there overtakes one still opening",
    async (which) => {
      const { root } = await workspace();
      await writeFile(join(root, "b.pdf"), pdf({ pages: 2 }));
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      const { documents } = viewer(root, { starting: () => held });

      const opening = documents.show("c1", root, "reports/q3.pdf");
      await until(() => documents.state("c1").status === "opening");
      const missing = documents.show(
        "c1",
        root,
        which === "another document" ? "b.pdf" : "reports/q3.pdf",
        { page: 99 },
      );
      await pause(100);
      release();

      await expect(opening).resolves.toEqual({ ok: true });
      await expect(missing).resolves.toMatchObject({ ok: false });
      expect(documents.state("c1").status).toBe("closed");
      documents.shutdown();
    },
  );

  it("goes back to the document it showed when a page that is not there overtakes another still opening", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "b.pdf"), pdf({ pages: 2 }));
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let starts = 0;
    // The first process ends once idle, so the next document waits on a new one.
    const { documents } = viewer(root, {
      idleMs: 50,
      starting: () => (++starts > 1 ? held : undefined),
    });
    await expect(documents.show("c1", root, "b.pdf")).resolves.toEqual({
      ok: true,
    });
    await pause(200);

    const opening = documents.show("c1", root, "reports/q3.pdf");
    await until(() => documents.state("c1").status === "opening");
    const missing = documents.show("c1", root, "b.pdf", { page: 99 });
    await pause(100);
    release();

    await expect(opening).resolves.toEqual({ ok: true });
    await expect(missing).resolves.toMatchObject({ ok: false });
    expect(documents.state("c1")).toMatchObject({
      status: "shown",
      path: "b.pdf",
    });
    documents.shutdown();
  });

  it("says a document could not be drawn when no drawing process could be started, and draws it next time", async () => {
    const { root } = await workspace();
    for (const how of ["shown", "written"] as const) {
      let refuse = true;
      const { documents } = viewer(root, {
        starting: () => {
          if (!refuse) return;
          refuse = false;
          throw new Error("The drawing process ended at once (1).");
        },
      });
      if (how === "shown")
        await expect(
          documents.show("c1", root, "reports/q3.pdf"),
        ).resolves.toEqual({ ok: true });
      else await documents.written("c1", root, ["reports/q3.pdf"]);
      await until(
        () => !["closed", "opening"].includes(documents.state("c1").status),
      );
      expect(documents.state("c1"), how).toMatchObject({
        status: "failed",
        reason:
          "q3.pdf could not be drawn, because Zhiyin could not start a contained process to draw it.",
      });

      await documents.show("c1", root, "reports/q3.pdf");
      expect(documents.state("c1"), how).toMatchObject({
        status: "shown",
        pages: { length: 3 },
      });
      documents.shutdown();
    }
  });

  it("ends a drawing process left unused for a while, and draws the document's pages in a new one", async () => {
    const { root } = await workspace();
    const { documents, started } = viewer(root, { idleMs: 200 });
    await documents.show("c1", root, "reports/q3.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);
    await expect(
      documents.drawPage("c1", state.revision, 1, 400),
    ).resolves.toMatchObject({ ok: true });
    await pause(500);

    expect(documents.state("c1")).toEqual(state);
    await expect(
      documents.drawPage("c1", state.revision, 2, 400),
    ).resolves.toMatchObject({ ok: true, width: 400 });
    expect(started).toHaveLength(2);
  });

  it("keeps the pages of a 30-page document it drew, and answers them again with no process", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "long.pdf"), pdf({ pages: 30 }));
    const { documents, started } = viewer(root, { idleMs: 200 });
    await documents.show("c1", root, "long.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);
    for (let page = 1; page <= 30; page += 1)
      await expect(
        documents.drawPage("c1", state.revision, page, 200),
      ).resolves.toMatchObject({ ok: true });
    await pause(500);

    await expect(
      documents.drawPage("c1", state.revision, 1, 200),
    ).resolves.toMatchObject({ ok: true, width: 200 });
    expect(started).toHaveLength(1);
    documents.shutdown();
  });

  it("keeps the pages it drew to about 64 MB, letting the first drawn go first", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "long.pdf"), pdf({ pages: 20 }));
    // 3 MB of PNG is about 4 MB once written for the panel: 15 pages fit.
    const { documents, asked } = watchedViewer({ drawnBytes: 3 * 1024 * 1024 });
    await documents.show("c1", root, "long.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);
    const draw = (page: number) =>
      expect(
        documents.drawPage("c1", state.revision, page, 200),
      ).resolves.toMatchObject({ ok: true });
    for (let page = 1; page <= 20; page += 1) await draw(page);
    expect(asked("draw")).toBe(20);

    for (let page = 6; page <= 20; page += 1) await draw(page);
    expect(asked("draw")).toBe(20);
    await draw(5);
    expect(asked("draw")).toBe(21);
    documents.shutdown();
  });

  it("keeps the documents of the four conversations used last, and opens another's again from disk when it is back", async () => {
    const { root } = await workspace();
    const { documents, started, ended, asked } = watchedViewer({
      idleMs: 60_000,
    });
    const revisions = new Map<string, string>();
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
      await documents.show(id, root, "reports/q3.pdf", { page: 2 });
      const state = documents.state(id);
      if (state.status !== "shown") throw new Error(state.status);
      revisions.set(id, state.revision);
      await expect(
        documents.drawPage(id, state.revision, 1, 200),
      ).resolves.toMatchObject({ ok: true });
    }
    // The first conversation's process has ended, and its panel is as it was.
    expect(ended()).toBe(1);
    const shown = documents.state("c1");
    expect(shown).toMatchObject({
      status: "shown",
      revision: revisions.get("c1"),
      pointed: { page: 2 },
    });

    // Drawn again from the last to the first, which makes c5 the one used
    // longest ago.
    for (const id of ["c5", "c4", "c3", "c2"])
      await expect(
        documents.drawPage(id, revisions.get(id)!, 1, 200),
      ).resolves.toMatchObject({ ok: true });
    expect(started).toHaveLength(5);
    expect(asked("draw")).toBe(5);

    // Asked for at once, its pages share one opening of the file.
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        documents.drawPage("c1", revisions.get("c1")!, page, 200),
      ),
    );
    expect(pages).toMatchObject([{ ok: true }, { ok: true }, { ok: true }]);
    expect(started).toHaveLength(6);
    expect(asked("open")).toBe(6);
    expect(documents.state("c1")).toEqual(shown);
    // Back to five, the one used longest ago lets go of its document.
    expect(ended()).toBe(2);
    await expect(
      documents.drawPage("c2", revisions.get("c2")!, 2, 200),
    ).resolves.toMatchObject({ ok: true });
    expect(started).toHaveLength(6);
    documents.shutdown();
  });

  it("draws the document of a conversation it let go of as the file is now", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "notes.pdf"), pdf({ pages: 1 }));
    const { documents } = watchedViewer({ idleMs: 60_000 });
    await documents.show("c1", root, "notes.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    for (const id of ["c2", "c3", "c4", "c5"])
      await documents.show(id, root, "reports/q3.pdf");
    await writeFile(join(root, "notes.pdf"), pdf({ pages: 2 }));

    await expect(
      documents.drawPage("c1", before.revision, 1, 200),
    ).resolves.toMatchObject({ ok: false });
    const after = documents.state("c1");
    if (after.status !== "shown") throw new Error(after.status);
    expect(after.revision).not.toBe(before.revision);
    expect(after.pages).toHaveLength(2);
    await expect(
      documents.drawPage("c1", after.revision, 2, 200),
    ).resolves.toMatchObject({ ok: true });
    documents.shutdown();
  });

  it("shows the document asked for while a page is asked for of the one it let go of", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "notes.pdf"), pdf({ pages: 1 }));
    // Which load looks first varies, so it is tried several times.
    for (let attempt = 0; attempt < 6; attempt++) {
      const { documents } = watchedViewer({ idleMs: 60_000 });
      await documents.show("c1", root, "reports/q3.pdf");
      const before = documents.state("c1");
      if (before.status !== "shown") throw new Error(before.status);
      for (const id of ["c2", "c3", "c4", "c5"])
        await documents.show(id, root, "reports/q3.pdf");

      await Promise.all([
        documents.show("c1", root, "notes.pdf"),
        documents.drawPage("c1", before.revision, 1, 200),
      ]);

      expect(documents.state("c1")).toMatchObject({
        status: "shown",
        path: "notes.pdf",
      });
      documents.shutdown();
    }
  });

  it.each(["open", "draw"] as const)(
    "keeps the document of a conversation used longest ago while it waits to %s",
    async (kind) => {
      const { root } = await workspace();
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let holding = true;
      const { documents, ended } = watchedViewer({
        idleMs: 60_000,
        // Only the first request of the kind waits.
        hold: (request) => {
          if (request.kind !== kind || !holding) return undefined;
          holding = false;
          changed();
          return held;
        },
      });
      let revision = "";
      const first =
        kind === "open"
          ? documents.show("c1", root, "reports/q3.pdf")
          : documents.show("c1", root, "reports/q3.pdf").then(() => {
              const state = documents.state("c1");
              if (state.status !== "shown") throw new Error(state.status);
              revision = state.revision;
              return documents.drawPage("c1", revision, 1, 200);
            });
      await until(() => !holding);
      for (const id of ["c2", "c3", "c4", "c5"])
        await documents.show(id, root, "reports/q3.pdf");
      expect(ended()).toBe(0);

      release();
      await expect(first).resolves.toMatchObject({ ok: true });
      const state = documents.state("c1");
      if (state.status !== "shown") throw new Error(state.status);
      await expect(
        documents.drawPage("c1", state.revision, 2, 200),
      ).resolves.toMatchObject({ ok: true });
      documents.shutdown();
    },
  );

  it("draws the pages of a document it let go of after a page that is not there was asked for", async () => {
    const { root } = await workspace();
    const { documents } = watchedViewer({ idleMs: 60_000 });
    await documents.show("c1", root, "reports/q3.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    for (const id of ["c2", "c3", "c4", "c5"])
      await documents.show(id, root, "reports/q3.pdf");

    await expect(
      documents.show("c1", root, "reports/q3.pdf", { page: 99 }),
    ).resolves.toMatchObject({ ok: false });
    expect(documents.state("c1")).toEqual(before);
    await expect(
      documents.drawPage("c1", before.revision, 1, 200),
    ).resolves.toMatchObject({ ok: true });
    documents.shutdown();
  });

  it("draws a page of a document it let go of while a page that is not there is asked for beside it", async () => {
    const { root } = await workspace();
    for (let attempt = 0; attempt < 4; attempt++) {
      const { documents } = watchedViewer({ idleMs: 60_000 });
      await documents.show("c1", root, "reports/q3.pdf");
      const before = documents.state("c1");
      if (before.status !== "shown") throw new Error(before.status);
      for (const id of ["c2", "c3", "c4", "c5"])
        await documents.show(id, root, "reports/q3.pdf");

      const [page] = await Promise.all([
        documents.drawPage("c1", before.revision, 1, 200),
        documents.show("c1", root, "reports/q3.pdf", { page: 99 }),
      ]);
      expect(page).toMatchObject({ ok: true });
      expect(documents.state("c1")).toEqual(before);
      documents.shutdown();
    }
  });

  it("draws a page asked for while the document it let go of is being read again", async () => {
    const { root } = await workspace();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    const { documents, asked } = watchedViewer({
      idleMs: 60_000,
      hold: (request) => {
        if (request.kind !== "open" || !holding) return undefined;
        holding = false;
        changed();
        return held;
      },
    });
    await documents.show("c1", root, "reports/q3.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    for (const id of ["c2", "c3", "c4", "c5"])
      await documents.show(id, root, "reports/q3.pdf");

    holding = true;
    const first = documents.drawPage("c1", before.revision, 1, 200);
    await until(() => !holding);
    const second = documents.drawPage("c1", before.revision, 2, 200);
    // Time for a second reading of the file to reach the process, were it one.
    await pause(200);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    // The second waited for the first's reading rather than reading again.
    expect(asked("open")).toBe(6);
    documents.shutdown();
  });

  it.each(["close", "forget"] as const)(
    "starts no drawing process for a document still being read when the person asks to %s the conversation",
    async (stop) => {
      const { root } = await workspace();
      const { documents, started } = watchedViewer();
      // Past its folder check, the document is read from disk.
      documents.onChange((id, state) => {
        if (id === "c1" && state.status === "opening") documents[stop]("c1");
      });

      await documents.show("c1", root, "reports/q3.pdf");

      expect(started).toHaveLength(0);
      expect(documents.state("c1").status).toBe("closed");
      documents.shutdown();
    },
  );

  it("reads nothing again for a conversation forgotten, or a viewer shut down, while a page waited", async () => {
    const { root } = await workspace();
    const { documents, started } = watchedViewer({ idleMs: 60_000 });
    const seen: string[] = [];
    documents.onChange((id, state) => {
      if (id === "c1") seen.push(state.status);
    });
    await documents.show("c1", root, "reports/q3.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    for (const id of ["c2", "c3", "c4", "c5"])
      await documents.show(id, root, "reports/q3.pdf");
    seen.length = 0;

    const refreshed = documents.refresh("c1", root);
    const page = documents.drawPage("c1", before.revision, 1, 200);
    documents.forget("c1");
    await refreshed;
    await expect(page).resolves.toMatchObject({ ok: false });
    expect(documents.state("c1").status).toBe("closed");
    expect(seen).toEqual([]);

    const processes = started.length;
    documents.shutdown();
    await expect(
      documents.drawPage("c2", before.revision, 1, 200),
    ).resolves.toMatchObject({ ok: false });
    expect(started).toHaveLength(processes);
  });

  it("says a document it let go of is outside the folder when a link now leads it there", async () => {
    const { parent, root } = await workspace();
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "notes.pdf"), pdf({ pages: 2 }));
    await writeFile(join(parent, "notes.pdf"), pdf({ pages: 2 }));
    const { documents } = watchedViewer({ idleMs: 60_000 });
    await documents.show("c1", root, "docs/notes.pdf");
    const before = documents.state("c1");
    if (before.status !== "shown") throw new Error(before.status);
    for (const id of ["c2", "c3", "c4", "c5"])
      await documents.show(id, root, "reports/q3.pdf");
    await rm(join(root, "docs"), { recursive: true });
    await symlink(parent, join(root, "docs"), "junction");

    await expect(
      documents.drawPage("c1", before.revision, 1, 200),
    ).resolves.toMatchObject({ ok: false });
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      path: "docs/notes.pdf",
      reason: expect.stringContaining("outside the folder"),
    });
    documents.shutdown();
  });

  it("draws a document shown and reported written at the same moment", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "logo.png"), png(200, 200));

    // A command wrote the picture, and the agent read it as the command's
    // changes were reported: two loads of the same bytes, one revision. Which
    // finishes first varies, so both orders are tried, several times.
    const drawn: boolean[] = [];
    // A test that runs out of time says where it was, and what the panel went
    // through on the way.
    let waitingFor = "";
    let seen: readonly DocumentPanelState[] = [];
    onTestFailed(({ task }) => {
      task.result?.errors?.push({
        name: "Where it stopped",
        message: `Attempt ${drawn.length + 1} was waiting for ${waitingFor}; the panel went through ${seen.map((state) => state.status).join(", ") || "nothing"}.`,
      });
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      const { documents, changes } = viewer(root);
      seen = changes;
      const show = () => documents.show("c1", root, "logo.png");
      const written = () => documents.written("c1", root, ["logo.png"]);
      waitingFor = "both loads to answer";
      await Promise.all(
        attempt % 2 ? [show(), written()] : [written(), show()],
      );
      // The written file's load may still be on its way, and the load it
      // overtook shows nothing of its own.
      waitingFor = "the panel to show the picture or fail";
      await until(() =>
        ["shown", "failed"].includes(documents.state("c1").status),
      );
      const state = documents.state("c1");
      if (state.status !== "shown") throw new Error(state.status);
      waitingFor = "page 1 to be drawn";
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

  it("draws the pages asked for behind one that brings down every process drawing it", async () => {
    const { root } = await workspace();
    let started = 0;
    const documents = new DocumentViewer({
      // A drawing process that falls over when asked for page 2.
      start: async () => {
        started += 1;
        const served = await serviceProcess();
        const exits: (() => void)[] = [];
        return {
          ...served,
          onExit: (listener: () => void) => void exits.push(listener),
          send: (request) => {
            if (request.kind === "draw" && request.page === 2)
              for (const exit of exits) exit();
            else served.send(request);
          },
        };
      },
      containment,
    });
    await documents.show("c1", root, "reports/q3.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);

    const [fallsOver, first, third] = await Promise.all([
      documents.drawPage("c1", state.revision, 2, 300),
      documents.drawPage("c1", state.revision, 1, 300),
      documents.drawPage("c1", state.revision, 3, 300),
    ]);

    expect(fallsOver).toEqual({
      ok: false,
      reason: "Page 2 could not be drawn.",
    });
    expect(first).toMatchObject({ ok: true, width: 300 });
    expect(third).toMatchObject({ ok: true, width: 300 });
    // The page that brought one down is not asked for again.
    expect(started).toBe(2);
  });

  it("answers a page being drawn when the panel closes as not drawn", async () => {
    const { root } = await workspace();
    let asked = () => {};
    const drawing = new Promise<void>((resolve) => (asked = resolve));
    const documents = new DocumentViewer({
      // A drawing process that never answers for a page.
      start: async () => {
        const served = await serviceProcess();
        return {
          ...served,
          send: (request) => {
            if (request.kind === "draw") asked();
            else served.send(request);
          },
        };
      },
      containment,
    });
    await documents.show("c1", root, "reports/q3.pdf");
    const state = documents.state("c1");
    if (state.status !== "shown") throw new Error(state.status);

    const page = documents.drawPage("c1", state.revision, 1, 300);
    await drawing;
    documents.close("c1");

    await expect(page).resolves.toMatchObject({ ok: false });
  });

  it("stays closed when closed while a document was being looked for", async () => {
    const { root } = await workspace();
    const { documents } = viewer(root);

    const showing = documents.show("c1", root, "reports/q3.pdf");
    documents.close("c1");
    await showing;

    expect(documents.state("c1").status).toBe("closed");
  });

  it("opens a document while a request for a path outside the folder is refused beside it, by its name or through a link", async () => {
    const { parent, root } = await workspace();
    await symlink(parent, join(root, "up"), "junction");
    for (const outside of ["../secret.pdf", "up/secret.pdf"]) {
      const { documents } = viewer(root);

      const [shown, refused] = await Promise.all([
        documents.show("c1", root, "reports/q3.pdf"),
        documents.show("c1", root, outside),
      ]);

      expect(shown).toEqual({ ok: true });
      expect(refused).toMatchObject({ ok: false });
      expect(documents.state("c1")).toMatchObject({
        status: "shown",
        path: "reports/q3.pdf",
      });
      documents.shutdown();
    }
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

  it("judges whether Windows may open a file by the file a link leads to, not the link's name", async () => {
    const { root } = await workspace();
    await writeFile(join(root, "setup.exe"), "MZ");
    await symlink(join(root, "setup.exe"), join(root, "report.pdf"), "file");
    const { documents } = viewer(root);

    await expect(documents.locate(root, "report.pdf")).resolves.toMatchObject({
      ok: true,
      openable: false,
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
