import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zhiyin-write-"));
}

describe("write_file", () => {
  it("creates a new workspace file and declares what it produced", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", {
        path: "brief.md",
        text: "A one-page brief.",
      }),
    ).toEqual({
      ok: true,
      action: "Create a workspace file",
      target: "brief.md",
      detail: "This creates a new file. Nothing is replaced.",
      access: "change",
      scope: "workspace",
      // The whole proposed file, so the request can be reviewed as a change
      // rather than as the call that would make it.
      changes: [
        { path: "brief.md", change: "created", after: "A one-page brief." },
      ],
      command: 'write_file({"path":"brief.md","text":"A one-page brief."})',
    });

    await expect(
      tools.execute("write_file", {
        path: "brief.md",
        text: "A one-page brief.",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { path: "brief.md", bytes: 17, change: "created" },
      produced: [{ path: "brief.md", change: "created", bytes: 17 }],
      details: [
        {
          kind: "facts",
          items: [
            { label: "File", value: "brief.md" },
            { label: "Change", value: "Created" },
            { label: "Size", value: "17 bytes" },
          ],
        },
      ],
    });
    await expect(readFile(join(root, "brief.md"), "utf8")).resolves.toBe(
      "A one-page brief.",
    );
  });

  it("says an existing file will be overwritten before it is approved", async () => {
    const root = await workspace();
    await writeFile(join(root, "brief.md"), "Existing draft.", "utf8");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", {
        path: "brief.md",
        text: "New.",
      }),
    ).toEqual({
      ok: true,
      action: "Overwrite an existing workspace file",
      target: "brief.md",
      detail: "This replaces the current contents of brief.md (15 bytes).",
      access: "change",
      scope: "workspace",
      // Both sides: the text on disk and the text proposed for it.
      changes: [
        {
          path: "brief.md",
          change: "updated",
          before: "Existing draft.",
          after: "New.",
        },
      ],
      command: 'write_file({"path":"brief.md","text":"New."})',
    });

    await expect(
      tools.execute("write_file", { path: "brief.md", text: "New." }),
    ).resolves.toEqual({
      ok: true,
      value: { path: "brief.md", bytes: 4, change: "updated" },
      produced: [{ path: "brief.md", change: "updated", bytes: 4 }],
      details: [
        {
          kind: "facts",
          items: [
            { label: "File", value: "brief.md" },
            { label: "Change", value: "Replaced what was there" },
            { label: "Size", value: "4 bytes" },
          ],
        },
      ],
    });
  });

  it("names the folders a new file would create", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", {
        path: "reports/2026/brief.md",
        text: "Body",
      }),
    ).toMatchObject({
      ok: true,
      action: "Create a workspace file",
      detail:
        "This creates a new file and the folder “reports/2026”. Nothing is replaced.",
    });
    await expect(
      tools.execute("write_file", {
        path: "reports/2026/brief.md",
        text: "Body",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      readFile(join(root, "reports/2026/brief.md"), "utf8"),
    ).resolves.toBe("Body");
  });

  it("keeps an existing file's line endings and byte-order mark when replacing it", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "brief.md"),
      "﻿First line\r\nSecond line\r\n",
      "utf8",
    );
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("write_file", {
        path: "brief.md",
        // The model writes Unix endings and no mark, as models do.
        text: "New first\nNew second\n",
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(join(root, "brief.md"), "utf8")).resolves.toBe(
      "﻿New first\r\nNew second\r\n",
    );
  });

  it("writes a new file exactly as it was given, inventing no convention", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("write_file", {
        path: "fresh.md",
        text: "One\nTwo\n",
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(join(root, "fresh.md"), "utf8")).resolves.toBe(
      "One\nTwo\n",
    );
  });

  it("does not write outside the workspace", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    await mkdir(root);
    const tools = new WorkspaceTools(root);

    for (const path of ["../escape.md", join(parent, "escape.md")]) {
      expect(await tools.inspect("write_file", { path, text: "x" })).toEqual({
        ok: false,
        reason: "The file must stay inside the current workspace.",
      });
      await expect(
        tools.execute("write_file", { path, text: "x" }),
      ).resolves.toEqual({
        ok: false,
        reason: "The file must stay inside the current workspace.",
      });
    }
  });

  it("refuses to write over a folder", async () => {
    const root = await workspace();
    await mkdir(join(root, "reports"));
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", { path: "reports", text: "x" }),
    ).toEqual({
      ok: false,
      reason: "reports is a folder in this workspace, not a file.",
    });
    await expect(
      tools.execute("write_file", { path: "reports", text: "x" }),
    ).resolves.toEqual({
      ok: false,
      reason: "reports is a folder in this workspace, not a file.",
    });
  });
});
