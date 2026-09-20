import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspacePreview } from "../src/workspace-preview.js";

describe("workspace preview", () => {
  it("serves workspace HTML and assets until explicitly stopped and confirms shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
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
    const root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
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

  it("refuses traversal, outside links, unauthorized requests, and a changed workspace", async () => {
    let root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
    const outside = await mkdtemp(join(tmpdir(), "zhiyin-preview-outside-"));
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

  it("refuses an approved preview when its workspace changes before execution", async () => {
    let root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
    await writeFile(join(root, "index.html"), "first");
    const preview = new WorkspacePreview(() => root);
    const binding = JSON.stringify(await preview.inspect("index.html"));
    root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
    await writeFile(join(root, "index.html"), "second");
    await expect(
      preview.open("index.html", undefined, binding),
    ).rejects.toThrow("changed after approval");
    await preview.close();
  });

  it("does not start or retain a preview after cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-preview-"));
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
});
