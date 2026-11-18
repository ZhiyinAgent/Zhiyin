import {
  chmod,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(): Promise<string> {
  return folders.make("zhiyin-write-");
}

describe("write_file", () => {
  it("creates a new workspace file and declares what it produced", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", {
        path: "brief.md",
        content: "A one-page brief.",
      }),
    ).toEqual({
      ok: true,
      action: "Create a workspace file",
      target: "brief.md",
      detail: "This creates a new file. Nothing is replaced.",
      // The whole proposed file, so the request can be reviewed as a change
      // rather than as the call that would make it.
      changes: [
        { path: "brief.md", change: "created", after: "A one-page brief." },
      ],
      command: 'write_file({"path":"brief.md","content":"A one-page brief."})',
      effects: {
        reads: "workspace",
        changes: "workspace",
        sends: "none",
        actsAsPerson: "none",
        runs: "none",
        lasting: false,
        brings: "none",
      },
    });

    await expect(
      tools.execute("write_file", {
        path: "brief.md",
        content: "A one-page brief.",
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
        content: "New.",
      }),
    ).toEqual({
      ok: true,
      action: "Overwrite an existing workspace file",
      target: "brief.md",
      detail: "This replaces the current contents of brief.md (15 bytes).",
      // Both sides: the text on disk and the text proposed for it.
      changes: [
        {
          path: "brief.md",
          change: "updated",
          before: "Existing draft.",
          after: "New.",
        },
      ],
      command: 'write_file({"path":"brief.md","content":"New."})',
      effects: {
        reads: "workspace",
        changes: "workspace",
        sends: "none",
        actsAsPerson: "none",
        runs: "none",
        lasting: false,
        brings: "none",
      },
    });

    await expect(
      tools.execute("write_file", { path: "brief.md", content: "New." }),
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
        content: "Body",
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
        content: "Body",
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
        content: "New first\nNew second\n",
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
        content: "One\nTwo\n",
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(join(root, "fresh.md"), "utf8")).resolves.toBe(
      "One\nTwo\n",
    );
  });

  /**
   * Many short lines are small as text but large as a difference, which
   * carries every line on its own; it is too large to carry, and says so.
   */
  it("says a new file of many short lines is too large to show", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    for (const content of ["x\n".repeat(200_000), "\n".repeat(400_000)]) {
      const inspection = await tools.inspect("write_file", {
        path: "lines.txt",
        content,
      });

      expect(inspection.ok && inspection.changes).toEqual([
        {
          path: "lines.txt",
          change: "created",
          omitted: "This change is too large to show here.",
        },
      ]);
    }
  });

  it("writes outside the workspace only by an absolute path, named as leaving it", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    await mkdir(root);
    const tools = new WorkspaceTools(root);

    // A relative path is the workspace's: one that climbs out is a mistake
    // the model can correct. `C:escape.md` names a drive's own folder, and
    // `notes:x` a hidden stream of a file rather than a file.
    for (const path of ["../escape.md", "C:escape.md", "notes:hidden.md"]) {
      expect(
        await tools.inspect("write_file", { path, content: "x" }),
      ).toMatchObject({ ok: false });
      await expect(
        tools.execute("write_file", { path, content: "x" }),
      ).resolves.toMatchObject({ ok: false });
    }
    await expect(readdir(parent)).resolves.toEqual(["inside"]);

    const outside = join(parent, "escape.md");
    expect(
      await tools.inspect("write_file", { path: outside, content: "x" }),
    ).toMatchObject({
      ok: true,
      action: "Create a file outside the workspace",
      target: outside,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      changes: [{ path: outside, change: "created" }],
      detail: expect.stringContaining(
        "This file is outside the folder you selected.",
      ),
    });
  });

  it("never writes in a folder Zhiyin keeps for itself, by any path", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    const own = join(parent, "zhiyin-data");
    await mkdir(root);
    await mkdir(own);
    const tools = new WorkspaceTools(root, { protect: [own] });
    const args = { path: join(own, "settings.json"), content: "{}" };

    expect(await tools.inspect("write_file", args)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("a folder Zhiyin keeps for itself"),
    });
    await expect(tools.execute("write_file", args)).resolves.toMatchObject({
      ok: false,
    });
    await expect(readdir(own)).resolves.toEqual([]);
  });

  it("answers a place in Zhiyin's own folders to the model, which can choose another", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    const own = join(parent, "zhiyin-data");
    await mkdir(root);
    await mkdir(own);
    const tools = new WorkspaceTools(root, { protect: [own] });
    const path = join(own, "settings.json");

    expect(await tools.inspect("write_file", { path, content: "{}" })).toEqual({
      ok: false,
      correctable: true,
      // Named as the tools name every path, with forward slashes.
      reason: `${path.replaceAll("\\", "/")} is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.`,
    });
  });

  it("answers a device's name, or a colon in a path, to the model, which can name the file again", async () => {
    const tools = new WorkspaceTools(await workspace());

    for (const [path, reason] of [
      [
        "NUL",
        "NUL is named as Windows names a device, such as NUL or CON, which no file can be. Give the file another name.",
      ],
      [
        "notes.md:hidden",
        'notes.md:hidden has a ":" in it. Name the file by a workspace-relative path without one.',
      ],
    ])
      expect(await tools.inspect("write_file", { path, content: "x" })).toEqual(
        { ok: false, correctable: true, reason },
      );
  });

  it("writes a name ending in a dot as Windows names it, and refuses a device's name", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("write_file", { path: "notes.md.", content: "Notes." }),
    ).resolves.toMatchObject({ ok: true });
    for (const path of ["NUL", "con.txt"])
      expect(
        await tools.inspect("write_file", { path, content: "x" }),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining("as Windows names a device"),
      });
    await expect(readdir(root)).resolves.toEqual(["notes.md"]);
  });

  /**
   * Windows takes `..` away by name before it follows any link, so
   * `notes/lnk/../b.md` is `notes/b.md` wherever `lnk` leads. The request
   * names the file the write reaches, by where it really is, and that is the
   * file written.
   */
  it("names and writes the file a path with a link and .. really reaches", async () => {
    const root = await workspace();
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "docs", "deep"), { recursive: true });
    await writeFile(join(root, "docs", "b.md"), "The person's own text.");
    await symlink(
      join(root, "docs", "deep"),
      join(root, "notes", "lnk"),
      "junction",
    );
    const tools = new WorkspaceTools(root);
    const args = { path: "notes/lnk/../b.md", content: "Replaced." };

    expect(await tools.inspect("write_file", args)).toMatchObject({
      ok: true,
      action: "Create a workspace file",
      target: "notes/b.md",
      changes: [{ path: "notes/b.md", change: "created" }],
    });
    await expect(tools.execute("write_file", args)).resolves.toMatchObject({
      ok: true,
      value: { path: "notes/b.md", change: "created" },
      produced: [{ path: "notes/b.md", change: "created" }],
    });
    expect(await readFile(join(root, "notes", "b.md"), "utf8")).toBe(
      "Replaced.",
    );
    expect(await readFile(join(root, "docs", "b.md"), "utf8")).toBe(
      "The person's own text.",
    );
  });

  it("names a file written through a link inside the folder by where it really is", async () => {
    const root = await workspace();
    await mkdir(join(root, "docs", "deep"), { recursive: true });
    await symlink(join(root, "docs", "deep"), join(root, "lnk"), "junction");
    const tools = new WorkspaceTools(root);
    const args = { path: "lnk/new.md", content: "New." };

    expect(await tools.inspect("write_file", args)).toMatchObject({
      ok: true,
      target: "docs/deep/new.md",
      changes: [{ path: "docs/deep/new.md", change: "created" }],
    });
    await expect(tools.execute("write_file", args)).resolves.toMatchObject({
      ok: true,
      produced: [{ path: "docs/deep/new.md", change: "created" }],
    });
    expect(await readFile(join(root, "docs", "deep", "new.md"), "utf8")).toBe(
      "New.",
    );
  });

  it("does not write through a link whose folder is missing, which could appear anywhere", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    await mkdir(root);
    await symlink(join(parent, "later"), join(root, "dangling"), "junction");
    const tools = new WorkspaceTools(root);
    const args = { path: "dangling/planted.md", content: "x" };

    expect(await tools.inspect("write_file", args)).toEqual({
      ok: false,
      reason: "dangling/planted.md is outside the workspace.",
    });
    await expect(tools.execute("write_file", args)).resolves.toEqual({
      ok: false,
      reason: "dangling/planted.md is outside the workspace.",
    });
    expect(await readdir(parent)).toEqual(["inside"]);
  });

  it("shows the person a whole path through a link whose target is missing, and writes nothing", async () => {
    const parent = await workspace();
    const root = join(parent, "inside");
    await mkdir(root);
    await symlink(join(parent, "gone"), join(parent, "later"), "junction");
    const tools = new WorkspaceTools(root);
    const path = join(parent, "later", "planted.md").replaceAll("\\", "/");

    expect(await tools.inspect("write_file", { path, content: "x" })).toEqual({
      ok: false,
      reason: `${path} leads through a link whose target is missing, so where it would be written is not known.`,
    });
    expect((await readdir(parent)).sort()).toEqual(["inside", "later"]);
  });

  it("refuses to replace a file over 10 MiB, saying so, and changes nothing", async () => {
    const root = await workspace();
    const large = Buffer.concat([
      Buffer.alloc(11 * 1024 * 1024, "a"),
      Buffer.from("\nend\n"),
    ]);
    await writeFile(join(root, "export.csv"), large);
    const tools = new WorkspaceTools(root);

    const result = await tools.inspect("write_file", {
      path: "export.csv",
      content: "small",
    });

    expect(result).toMatchObject({ ok: false, correctable: true });
    if (result.ok) throw new Error("A file this large is not replaced");
    expect(result.reason).toContain("10 MiB");
    expect((await readFile(join(root, "export.csv"))).equals(large)).toBe(true);
  });

  it("says in its description how much it writes and how large a file it replaces", async () => {
    const tools = new WorkspaceTools(await workspace());

    expect(
      tools.list().find((tool) => tool.name === "write_file")?.description,
    ).toContain(
      "The text can be at most 2 MiB, and a file larger than 10 MiB is not replaced: change it with a command or a script.",
    );
  });

  it("refuses text over 2 MiB by naming the limit and how to write it instead", async () => {
    const root = await workspace();
    const tools = new WorkspaceTools(root);
    const content = "a".repeat(2 * 1024 * 1024 + 1);

    expect(
      await tools.inspect("write_file", { path: "export.csv", content }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "The text is larger than 2 MiB, the most write_file writes in one action. Write a first part, then add the rest with multi_edit, or have a script write the file. No file was changed.",
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses to write over a folder", async () => {
    const root = await workspace();
    await mkdir(join(root, "reports"));
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("write_file", { path: "reports", content: "x" }),
    ).toEqual({
      ok: false,
      reason: "reports is a folder in this workspace, not a file.",
    });
    await expect(
      tools.execute("write_file", { path: "reports", content: "x" }),
    ).resolves.toEqual({
      ok: false,
      reason: "reports is a folder in this workspace, not a file.",
    });
  });

  it("leaves nothing of its own behind when the file cannot be replaced", async () => {
    const root = await workspace();
    await writeFile(join(root, "locked.md"), "Kept.", "utf8");
    // Windows refuses to replace a read-only file.
    await chmod(join(root, "locked.md"), 0o444);
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("write_file", {
      path: "locked.md",
      content: "Replaced.",
    });

    expect(result).toMatchObject({ ok: false });
    expect(await readdir(root)).toEqual(["locked.md"]);
    await expect(readFile(join(root, "locked.md"), "utf8")).resolves.toBe(
      "Kept.",
    );
  });

  it("takes the contents as content, and refuses them under any other name", async () => {
    const tools = new WorkspaceTools(await workspace());

    expect(
      await tools.inspect("write_file", { path: "a.md", content: "A." }),
    ).toMatchObject({ ok: true, target: "a.md" });
    expect(
      await tools.inspect("write_file", { path: "a.md", text: "A." }),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("refuses input that does not fit its schema, saying how it departs", async () => {
    const tools = new WorkspaceTools(await workspace());

    for (const [args, departs] of [
      [
        { path: "a.md", text: "A." },
        "“text” is not one of its fields; “content” is missing",
      ],
      [{ path: "a.md", content: ["A.", "B."] }, "“content” must be text"],
    ] as const)
      expect(await tools.inspect("write_file", args)).toEqual({
        ok: false,
        correctable: true,
        reason: `Choose a workspace-relative file path and the text to write. The input does not match the tool's schema: ${departs}.`,
      });
  });
});
