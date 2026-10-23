import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

describe("WorkspaceTools", () => {
  it("offers a conversation no file tools until it enters a folder, and keeps each conversation in its own", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "note.txt"), "first");
    await writeFile(join(second, "note.txt"), "second");
    expect(tools.list("a").map((tool) => tool.name)).not.toContain("read_file");

    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "a"),
    ).toMatchObject({ ok: true, value: { text: "1→first" } });
    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "b"),
    ).toMatchObject({ ok: true, value: { text: "1→second" } });
    expect(tools.list("a").map((tool) => tool.name)).toContain("read_file");
    expect(tools.list("c").map((tool) => tool.name)).not.toContain("read_file");
    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "c"),
    ).toEqual({ ok: false, reason: "Choose a folder before using files." });
    expect(tools.workspaceRoot("a")).toBe(await realpath(first));
    expect(tools.workspaceRoot("b")).toBe(await realpath(second));
    expect((await tools.describeWorkspace("b")).entries).toEqual([
      { path: "note.txt", kind: "file" },
    ]);
  });

  it("writes each conversation's file in its own folder", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    const wroteA = await tools.execute(
      "write_file",
      { path: "note.txt", content: "from a" },
      undefined,
      "a",
    );
    const wroteB = await tools.execute(
      "write_file",
      { path: "note.txt", content: "from b" },
      undefined,
      "b",
    );

    expect(wroteA).toMatchObject({ ok: true });
    expect(wroteB).toMatchObject({ ok: true });
    expect(await readFile(join(first, "note.txt"), "utf8")).toBe("from a");
    expect(await readFile(join(second, "note.txt"), "utf8")).toBe("from b");
  });

  it("lists and searches each conversation's own folder", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "reports.md"), "quarterly costs");
    await writeFile(join(second, "notes.md"), "quarterly costs");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    const listed = await tools.execute(
      "list_directory",
      { path: "." },
      undefined,
      "a",
    );
    const found = await tools.execute(
      "search_files",
      { query: "quarterly" },
      undefined,
      "a",
    );

    expect(JSON.stringify(listed)).toContain("reports.md");
    expect(JSON.stringify(listed)).not.toContain("notes.md");
    expect(JSON.stringify(found)).toContain("reports.md");
    expect(JSON.stringify(found)).not.toContain("notes.md");
  });

  it("checks a folder without moving any conversation into it", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await tools.enterFolder("a", first);

    await tools.checkFolder(second);

    expect(tools.workspaceRoot("a")).toBe(await realpath(first));
    expect(tools.workspaceRoot("b")).toBeUndefined();
  });

  it("describes to each conversation its own folder", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "reports.md"), "first");
    await writeFile(join(second, "notes.md"), "second");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    expect((await tools.describeWorkspace("a")).entries).toEqual([
      { path: "reports.md", kind: "file" },
    ]);
    expect((await tools.describeWorkspace("b")).entries).toEqual([
      { path: "notes.md", kind: "file" },
    ]);
  });

  it("edits each conversation's file in its own folder", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "note.txt"), "draft");
    await writeFile(join(second, "note.txt"), "draft");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);

    const edited = await tools.execute(
      "multi_edit",
      {
        edits: [
          {
            path: "note.txt",
            replacements: [{ find: "draft", replace: "final" }],
          },
        ],
      },
      undefined,
      "b",
    );

    expect(edited).toMatchObject({ ok: true });
    expect(await readFile(join(first, "note.txt"), "utf8")).toBe("draft");
    expect(await readFile(join(second, "note.txt"), "utf8")).toBe("final");
  });

  it("refuses to inspect a call that needs a folder, from a conversation with none", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    await tools.enterFolder("a", first);

    expect(
      await tools.inspect(
        "write_file",
        { path: "note.txt", content: "new" },
        "c",
      ),
    ).toEqual({ ok: false, reason: "Choose a folder before using files." });
  });

  it("inspects each conversation's call against its own folder", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(second, "note.txt"), "second");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", second);
    const write = { path: "note.txt", content: "new" };

    const inA = await tools.inspect("write_file", write, "a");
    const inB = await tools.inspect("write_file", write, "b");

    // Only the second folder holds note.txt, so only there is it replaced.
    expect(inA).toMatchObject({ ok: true, action: "Create a workspace file" });
    expect(inB).toMatchObject({
      ok: true,
      action: "Overwrite an existing workspace file",
    });
  });

  it("moves one conversation to another folder without moving the others", async () => {
    const tools = new WorkspaceTools();
    const first = await folders.make("zhiyin-tools-");
    const second = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "note.txt"), "first");
    await writeFile(join(second, "note.txt"), "second");
    await tools.enterFolder("a", first);
    await tools.enterFolder("b", first);

    await tools.enterFolder("a", second);

    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "a"),
    ).toMatchObject({ ok: true, value: { text: "1→second" } });
    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "b"),
    ).toMatchObject({ ok: true, value: { text: "1→first" } });
  });

  it("answers a folder's name when it is entered or checked, and forgets a conversation's folder when told", async () => {
    const tools = new WorkspaceTools();
    const root = await folders.make("zhiyin-tools-");
    const named = join(root, "Reports");
    await mkdir(named);

    expect(await tools.enterFolder("a", named)).toBe("Reports");
    expect(await tools.checkFolder(named)).toBe("Reports");
    expect(tools.workspaceRoot("b")).toBeUndefined();

    tools.leaveFolder("a");

    expect(tools.workspaceRoot("a")).toBeUndefined();
  });

  it("takes an empty folder name for no folder, not for the folder Zhiyin was started in", () => {
    const tools = new WorkspaceTools("");

    expect(tools.workspaceRoot(undefined)).toBeUndefined();
    expect(tools.list().map((tool) => tool.name)).not.toContain("read_file");
  });

  it("refuses an empty folder name to enter or check, rather than taking the folder Zhiyin was started in", async () => {
    const tools = new WorkspaceTools();

    await expect(tools.enterFolder("a", "")).rejects.toThrow();
    await expect(tools.checkFolder("")).rejects.toThrow();
    expect(tools.workspaceRoot("a")).toBeUndefined();
  });

  /**
   * A folder that cannot be opened is a change that did not happen. Leaving the
   * conversation with no folder would take its file tools away for a folder it
   * never moved to.
   */
  it("keeps a conversation in its previous folder when a folder change fails", async () => {
    const first = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "note.txt"), "first");
    const tools = new WorkspaceTools();
    await tools.enterFolder("a", first);

    await expect(
      tools.enterFolder("a", join(first, "no-such-folder")),
    ).rejects.toThrow();
    await expect(
      tools.checkFolder(join(first, "no-such-folder")),
    ).rejects.toThrow();

    expect(tools.workspaceRoot("a")).toBe(await realpath(first));
    expect(tools.list("a").map((tool) => tool.name)).toContain("read_file");
    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "a"),
    ).toMatchObject({ ok: true, value: { text: "1→first" } });
  });

  it("keeps a conversation in its previous folder when the chosen path is a file", async () => {
    const first = await folders.make("zhiyin-tools-");
    await writeFile(join(first, "note.txt"), "first");
    const tools = new WorkspaceTools();
    await tools.enterFolder("a", first);

    await expect(
      tools.enterFolder("a", join(first, "note.txt")),
    ).rejects.toThrow("Choose an existing folder.");
    await expect(tools.checkFolder(join(first, "note.txt"))).rejects.toThrow(
      "Choose an existing folder.",
    );

    expect(tools.workspaceRoot("a")).toBe(await realpath(first));
    expect(
      await tools.execute("read_file", { path: "note.txt" }, undefined, "a"),
    ).toMatchObject({ ok: true, value: { text: "1→first" } });
  });

  it("advertises and reads a UTF-8 file inside the workspace", async () => {
    const root = await folders.make("zhiyin-tools-");
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "notes.md"), "Project notes", "utf8");
    const tools = new WorkspaceTools(root);

    expect(tools.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_file",
          inputSchema: expect.objectContaining({ type: "object" }),
        }),
      ]),
    );
    expect(await tools.inspect("read_file", { path: "docs/notes.md" })).toEqual(
      {
        ok: true,
        action: "Read a workspace file",
        target: "docs/notes.md",
        access: "read",
        scope: "workspace",
        command: 'read_file({"path":"docs/notes.md"})',
      },
    );
    await expect(
      tools.execute("read_file", { path: "docs/notes.md" }),
    ).resolves.toEqual({
      ok: true,
      value: { path: "docs/notes.md", text: "1→Project notes", totalLines: 1 },
      details: [
        {
          kind: "facts",
          items: [
            { label: "File", value: "docs/notes.md" },
            { label: "Size", value: "13 bytes" },
            { label: "Lines", value: "1" },
          ],
        },
        { kind: "text", label: "Contents", text: "Project notes" },
      ],
    });
  });

  it("describes the workspace and lists a directory without reading file contents", async () => {
    const root = await folders.make("zhiyin-tools-");
    await mkdir(join(root, "apps"));
    await mkdir(join(root, "apps", "desktop"));
    await writeFile(join(root, "package.json"), '{"private":true}', "utf8");
    const tools = new WorkspaceTools(root);

    await expect(tools.describeWorkspace(undefined)).resolves.toMatchObject({
      entries: [
        { path: "apps", kind: "directory" },
        { path: "package.json", kind: "file" },
      ],
      truncated: false,
    });
    expect(tools.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "list_directory" }),
      ]),
    );
    expect(
      await tools.inspect("list_directory", { path: "apps", depth: 2 }),
    ).toEqual({
      ok: true,
      action: "List a workspace directory",
      target: "apps",
      access: "read",
      scope: "workspace",
      command: 'list_directory({"path":"apps","depth":2})',
    });
    await expect(
      tools.execute("list_directory", { path: "apps", depth: 2 }),
    ).resolves.toEqual({
      ok: true,
      value: {
        path: "apps",
        entries: [{ path: "apps/desktop", kind: "directory" }],
        truncated: false,
      },
      details: [
        {
          kind: "list",
          label: "1 in apps",
          items: ["apps/desktop/"],
        },
      ],
    });
  });

  /**
   * The selected folder is the scope a person consented to, so leaving it is a
   * different action, described as one. It is not forbidden: refusing outright
   * only teaches the model to reach for the shell, which is the action nobody
   * can bound.
   */
  it("names a listing outside the workspace as leaving it", async () => {
    const parent = await folders.make("zhiyin-tools-");
    const root = join(parent, "workspace");
    await mkdir(root);
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "note.txt"), "hello", "utf8");
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("list_directory", {
      path: "../outside",
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "List a folder outside the workspace",
      access: "read",
      scope: "outside",
    });
    expect(inspection).toHaveProperty(
      "detail",
      expect.stringContaining("outside the folder you selected"),
    );
    await expect(
      tools.execute("list_directory", { path: "../outside" }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        entries: [expect.objectContaining({ path: expect.any(String) })],
      },
    });
  });

  it("rejects invalid arguments before presenting a permission request", async () => {
    const root = await folders.make("zhiyin-tools-");
    const tools = new WorkspaceTools(root);

    expect(await tools.inspect("read_file", {})).toEqual({
      ok: false,
      reason: "Choose a file path to read.",
      // The model can fix the shape of its own call; a person cannot.
      correctable: true,
    });
    await expect(tools.execute("read_file", {})).resolves.toEqual({
      ok: false,
      reason: "Choose a file path to read.",
      correctable: true,
    });
  });

  it("names a read outside the workspace as leaving it", async () => {
    const parent = await folders.make("zhiyin-tools-");
    const root = join(parent, "workspace");
    await mkdir(root);
    await writeFile(join(parent, "secret.txt"), "outside", "utf8");
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("read_file", {
      path: "../secret.txt",
    });

    expect(inspection).toMatchObject({
      ok: true,
      action: "Read a file outside the workspace",
      access: "read",
      scope: "outside",
    });
    await expect(
      tools.execute("read_file", { path: "../secret.txt" }),
    ).resolves.toMatchObject({ ok: true, value: { text: "1→outside" } });
  });

  /**
   * The difference that matters is between the answer given before approval
   * and the answer that holds when the action runs. A link makes them differ:
   * the request looked contained, so nobody was asked, and the read must not
   * then follow the link out. This is the case the two containment checks
   * exist for, and the only one where refusing is right.
   */
  it("refuses a link that leads out of a workspace read nobody was asked about", async () => {
    const parent = await folders.make("zhiyin-tools-");
    const root = join(parent, "workspace");
    await mkdir(root);
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "secret.txt"), "outside", "utf8");
    // A junction: Windows makes one without any privilege.
    await symlink(join(parent, "outside"), join(root, "innocent"), "junction");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_file", { path: "innocent/secret.txt" }),
    ).toMatchObject({ scope: "workspace" });
    await expect(
      tools.execute("read_file", { path: "innocent/secret.txt" }),
    ).resolves.toEqual({
      ok: false,
      reason: "The file leads outside the current workspace.",
    });
  });

  /**
   * The same path, a different thing behind it by the time it is read.
   *
   * The case above plants the link before anybody looks, so inspection and
   * execution disagree from the start. This is the adversarial one: an ordinary
   * file is inspected, found contained, and nobody is asked — and only then is
   * it replaced by a link leading out. Containment is settled again when the
   * action runs, against what the path resolves to then, which is the whole
   * reason it is settled twice.
   */
  it("refuses a workspace file swapped for a link out, after it was inspected", async () => {
    const parent = await folders.make("zhiyin-tools-");
    const root = join(parent, "workspace");
    await mkdir(root);
    // Distinctive on purpose: the refusal says the word "outside" itself, so a
    // leak check against that word would pass on the refusal and prove nothing.
    const secret = "secret-contents-that-must-not-leak";
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "note.txt"), secret, "utf8");
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "note.txt"), "inside", "utf8");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_file", { path: "notes/note.txt" }),
    ).toMatchObject({ scope: "workspace" });

    // A junction: Windows makes one without any privilege.
    await rm(join(root, "notes"), { recursive: true });
    await symlink(join(parent, "outside"), join(root, "notes"), "junction");

    const result = await tools.execute("read_file", { path: "notes/note.txt" });

    expect(result).toEqual({
      ok: false,
      reason: "The file leads outside the current workspace.",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  /**
   * The same swap, for something that is not a file at all. It must be refused
   * for what it is rather than read, or crash on the way.
   */
  it("refuses a workspace file swapped for a folder, after it was inspected", async () => {
    const root = await folders.make("zhiyin-tools-");
    await writeFile(join(root, "report.txt"), "a report", "utf8");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("read_file", { path: "report.txt" }),
    ).toMatchObject({ scope: "workspace" });

    await rm(join(root, "report.txt"));
    await mkdir(join(root, "report.txt"));

    await expect(
      tools.execute("read_file", { path: "report.txt" }),
    ).resolves.toEqual({
      ok: false,
      reason: "The selected path is not a file.",
    });
  });

  it("finds which workspace files contain a piece of text, without asking", async () => {
    const root = await folders.make("zhiyin-tools-");
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "node_modules"));
    await writeFile(
      join(root, "notes", "budget.md"),
      "Q3 Budget total\n",
      "utf8",
    );
    await writeFile(join(root, "readme.md"), "nothing here\n", "utf8");
    await writeFile(join(root, "node_modules", "x.md"), "budget\n", "utf8");
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("search_files", { query: "budget" }),
    ).toMatchObject({ ok: true, access: "read", scope: "workspace" });
    const result = await tools.execute("search_files", { query: "budget" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        // Case-insensitive, and generated folders are left out rather than
        // burying the answer.
        matches: [
          { path: "notes/budget.md", line: 1, text: "Q3 Budget total" },
        ],
        truncated: false,
      },
    });
  });

  it("keeps a search inside the workspace", async () => {
    const parent = await folders.make("zhiyin-tools-");
    const root = join(parent, "workspace");
    await mkdir(root);
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("search_files", { query: "x", path: ".." }),
    ).toEqual({
      ok: false,
      reason: "The search must stay inside the current workspace.",
    });
  });

  it("names a missing workspace file in the failure", async () => {
    const root = await folders.make("zhiyin-tools-");
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("read_file", { path: "README.md" }),
    ).resolves.toEqual({
      ok: false,
      reason: "README.md was not found in this workspace.",
    });
  });
});
