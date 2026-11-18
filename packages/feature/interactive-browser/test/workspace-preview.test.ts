import { execFileSync } from "node:child_process";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspacePreview } from "../src/workspace-preview.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("workspace preview", () => {
  it("serves workspace HTML and assets until explicitly stopped and confirms shutdown", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(
      join(root, "index.html"),
      '<link rel="stylesheet" href="style.css"><h1>Preview</h1>',
    );
    await writeFile(join(root, "style.css"), "h1 { color: red }");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      const response = await fetch(url);
      expect(await response.text()).toContain("<h1>Preview</h1>");
      const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        await (
          await fetch(new URL("/style.css", url), { headers: { cookie } })
        ).text(),
      ).toContain("color: red");
      expect(await (await fetch(new URL("style.css", url))).text()).toContain(
        "color: red",
      );
      await preview.close();
      await expect(fetch(url)).rejects.toThrow();
    } finally {
      await preview.close();
    }
  });

  it("answers the browser's own favicon request instead of leaving an error", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      const cookie = (await fetch(url)).headers
        .get("set-cookie")!
        .split(";")[0]!;

      // Every browser asks for this without being told to. Unanswered, it is
      // an error in the console of a page that has nothing wrong with it, and
      // the agent spends a turn chasing it.
      const response = await fetch(new URL("/favicon.ico", url), {
        headers: { cookie },
      });

      expect(response.status).toBe(204);
    } finally {
      await preview.close();
    }
  });

  it("serves a favicon the workspace does have", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    await writeFile(join(root, "favicon.ico"), "icon bytes");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      const cookie = (await fetch(url)).headers
        .get("set-cookie")!
        .split(";")[0]!;

      const response = await fetch(new URL("/favicon.ico", url), {
        headers: { cookie },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("icon bytes");
    } finally {
      await preview.close();
    }
  });

  it("serves the files a page loads: video, sound, fonts, 3D models, data and documents", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const expected: Record<string, string> = {
      "clip.mp4": "video/mp4",
      "clip.webm": "video/webm",
      "sound.mp3": "audio/mpeg",
      "sound.wav": "audio/wav",
      "face.ttf": "font/ttf",
      "face.otf": "font/otf",
      "model.glb": "model/gltf-binary",
      "model.gltf": "model/gltf+json",
      "model.bin": "application/octet-stream",
      "table.csv": "text/csv; charset=utf-8",
      "feed.xml": "application/xml",
      "report.pdf": "application/pdf",
      "photo.avif": "image/avif",
    };
    for (const name of Object.keys(expected))
      await writeFile(join(root, name), "bytes");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      const cookie = (await fetch(url)).headers
        .get("set-cookie")!
        .split(";")[0]!;

      const served: Record<string, string | null> = {};
      for (const name of Object.keys(expected)) {
        const response = await fetch(new URL(`/${name}`, url), {
          headers: { cookie },
        });
        served[name] =
          response.status === 200 ? response.headers.get("content-type") : null;
      }

      expect(served).toEqual(expected);
    } finally {
      await preview.close();
    }
  });

  it("answers a missing file as missing and a file it does not serve as unsupported, and names each for the model", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    await writeFile(join(root, "notes.docx"), "bytes");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      await fetch(url);

      const missing = await fetch(new URL("assets/model.glb", url));
      const unsupported = await fetch(new URL("notes.docx", url));
      // Asked twice, named once.
      await fetch(new URL("assets/model.glb", url));

      expect(missing.status).toBe(404);
      expect(unsupported.status).toBe(415);
      expect(preview.takeUnserved()).toEqual([
        "assets/model.glb was not served: there is no such file.",
        "notes.docx was not served: the preview does not serve .docx files.",
      ]);
      expect(preview.takeUnserved()).toEqual([]);
    } finally {
      await preview.close();
    }
  });

  it("names a file too large to serve and one outside the workspace, with why", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    await writeFile(join(root, "clip.mp4"), Buffer.alloc(21 * 1024 * 1024));
    await writeFile(join(root, ".env"), "SECRET=1");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      await fetch(url);

      const large = await fetch(new URL("clip.mp4", url));
      const hidden = await fetch(new URL(".env", url));

      expect(large.status).toBe(413);
      expect(hidden.status).toBe(403);
      expect(preview.takeUnserved()).toEqual([
        "clip.mp4 was not served: it is larger than the 20 MB the preview serves.",
        ".env was not served: it is outside the workspace, or in a folder or file whose name starts with a dot.",
      ]);
    } finally {
      await preview.close();
    }
  });

  it("names a file asked for by an address that does not decode, with why", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");

      const response = await fetch(new URL("bad%zz.png", url));

      expect(response.status).toBe(400);
      expect(preview.takeUnserved()).toEqual([
        "bad%zz.png was not served: its address is not a valid encoded path.",
      ]);
    } finally {
      await preview.close();
    }
  });

  it("names a folder asked for that has no index.html as such", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "other.html"), "<p>other</p>");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");

      const response = await fetch(new URL("sub/", url));

      expect(response.status).toBe(404);
      expect(preview.takeUnserved()).toEqual([
        "sub/ was not served: it is a folder with no index.html.",
      ]);
    } finally {
      await preview.close();
    }
  });

  it("names a file Windows refuses to let it read, with why", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const locked = join(root, "locked.png");
    await writeFile(locked, "bytes");
    const user = process.env.USERNAME!;
    execFileSync("icacls", [locked, "/deny", `${user}:(R)`]);
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");

      const response = await fetch(new URL("locked.png", url));

      expect(response.status).toBe(403);
      expect(preview.takeUnserved()).toEqual([
        "locked.png was not served: permission to read it was refused.",
      ]);
    } finally {
      execFileSync("icacls", [locked, "/remove:d", user]);
      await preview.close();
    }
  });

  it("names up to 20 files at a time and counts the rest", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");
      for (let index = 1; index <= 23; index += 1)
        await fetch(new URL(`frames/${index}.png`, url));

      const named = preview.takeUnserved();

      expect(named).toHaveLength(21);
      expect(named[19]).toBe(
        "frames/20.png was not served: there is no such file.",
      );
      expect(named[20]).toBe("3 more files were not served.");
    } finally {
      await preview.close();
    }
  });

  it("names nothing for a request that is not the preview's own", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = await preview.open("index.html");

      // No token in the address and no cookie: not the page's request.
      const stranger = await fetch(new URL("/missing.png", url));

      expect(stranger.status).toBe(403);
      expect(preview.takeUnserved()).toEqual([]);
    } finally {
      await preview.close();
    }
  });

  it("refuses traversal, outside links, unauthorized requests, and a changed workspace", async () => {
    let root = await folders.make("zhiyin-preview-");
    const outside = await folders.make("zhiyin-preview-outside-");
    await writeFile(join(root, "index.html"), "inside");
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(outside, join(root, "linked"), "junction");
    const preview = new WorkspacePreview(() => root);
    try {
      await expect(preview.open("../secret.txt")).rejects.toThrow();
      await expect(preview.open("linked/secret.txt")).rejects.toThrow();
      const url = await preview.open("index.html");
      expect((await fetch(new URL("linked/secret.txt", url))).status).toBe(403);
      expect((await fetch(new URL("/index.html", url))).status).toBe(403);
      expect((await fetch(url, { method: "POST" })).status).toBe(405);
      expect(
        (await fetch(url, { headers: { origin: "https://outside.example" } }))
          .status,
      ).toBe(403);
      root = outside;
      expect((await fetch(url)).status).toBe(409);
    } finally {
      await preview.close();
    }
  });

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "refuses a file a link carries to a folder named like the workspace but for case",
    async () => {
      const parent = await folders.makeCaseSensitive("zhiyin-preview-case-");
      const root = join(parent, "work");
      await mkdir(join(parent, "WORK"), { recursive: true });
      await mkdir(root);
      await writeFile(join(root, "index.html"), "inside");
      await writeFile(join(parent, "WORK", "secret.html"), "outside");
      await symlink(join(parent, "WORK"), join(root, "linked"), "junction");
      const preview = new WorkspacePreview(() => root);
      try {
        await expect(preview.inspect("linked/secret.html")).rejects.toThrow(
          "Preview files must stay inside the selected workspace.",
        );
        const url = await preview.open("index.html");
        expect((await fetch(new URL("linked/secret.html", url))).status).toBe(
          403,
        );
      } finally {
        await preview.close();
      }
    },
  );

  it("refuses a file under a dot-named folder, and a request that names another host", async () => {
    const root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "inside");
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, ".hidden", "data.json"), "{}");
    await writeFile(join(root, ".env"), "SECRET=1");
    const preview = new WorkspacePreview(() => root);
    try {
      const url = new URL(await preview.open("index.html"));
      const cookie = (await fetch(url)).headers
        .get("set-cookie")!
        .split(";")[0]!;
      for (const name of [".hidden/data.json", ".env"])
        expect(
          (await fetch(new URL(name, url), { headers: { cookie } })).status,
        ).toBe(403);

      // fetch sends its own Host header; a plain request can name another.
      const status = await new Promise<number | undefined>((resolve, reject) =>
        httpGet(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { host: `evil.example:${url.port}` },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject),
      );
      expect(status).toBe(403);
    } finally {
      await preview.close();
    }
  });

  it("refuses an approved preview when its workspace changes before execution", async () => {
    let root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "first");
    const preview = new WorkspacePreview(() => root);
    const binding = JSON.stringify(await preview.inspect("index.html"));
    root = await folders.make("zhiyin-preview-");
    await writeFile(join(root, "index.html"), "second");
    await expect(
      preview.open("index.html", undefined, binding),
    ).rejects.toThrow("changed after approval");
    await preview.close();
  });

  it("does not start or retain a preview after cancellation", async () => {
    const root = await folders.make("zhiyin-preview-");
    await mkdir(join(root, "site"));
    await writeFile(join(root, "site/index.html"), "preview");
    const preview = new WorkspacePreview(() => root);
    const controller = new AbortController();
    controller.abort();
    await expect(
      preview.open("site/index.html", controller.signal),
    ).rejects.toThrow();
    await preview.close();
  });

  it("says a page is its own only while it serves that page's address for the workspace it opened on", async () => {
    const root = await folders.make("zhiyin-preview-");
    const other = await folders.make("zhiyin-preview-other-");
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>");
    let selected = root;
    const preview = new WorkspacePreview(() => selected);
    try {
      expect(preview.serves("http://127.0.0.1:8080/index.html")).toBe(false);

      const url = await preview.open("index.html");
      const origin = new URL(url).origin;
      expect(preview.serves(url)).toBe(true);
      expect(preview.serves(`${origin}/style.css#top`)).toBe(true);
      expect(preview.serves("https://example.com/")).toBe(false);
      expect(preview.serves(url.replace("127.0.0.1", "localhost"))).toBe(false);
      expect(preview.serves("not an address")).toBe(false);

      selected = other;
      expect(preview.serves(url)).toBe(false);
      selected = root;

      await preview.close();
      expect(preview.serves(url)).toBe(false);
    } finally {
      await preview.close();
    }
  });
});
