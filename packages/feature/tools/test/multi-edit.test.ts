import {
  chmod,
  link,
  mkdir,
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

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await folders.make("zhiyin-edit-");
  for (const [path, text] of Object.entries(files))
    await writeFile(join(root, path), text, "utf8");
  return root;
}

describe("multi_edit", () => {
  it("applies replacements across several files in one approved action", async () => {
    const root = await workspace({
      "notes.md": "Owner: Dana\nStatus: draft",
      "plan.md": "Owner: Dana",
    });
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "notes.md",
          replacements: [
            { find: "Dana", replace: "Rowan" },
            { find: "draft", replace: "final" },
          ],
        },
        { path: "plan.md", replacements: [{ find: "Dana", replace: "Rowan" }] },
      ],
    };

    expect(await tools.inspect("multi_edit", args)).toMatchObject({
      ok: true,
      action: "Edit workspace files",
      target: "2 files: notes.md, plan.md",
      detail:
        "This applies 3 replacements to 2 existing files. Nothing else is changed.",
    });

    // `details` is the same answer said for a person rather than for the
    // model: what changed, per file, without reading the JSON.
    await expect(tools.execute("multi_edit", args)).resolves.toEqual({
      details: [
        {
          kind: "facts",
          items: [
            { label: "notes.md", value: "2 replacements" },
            { label: "plan.md", value: "1 replacement" },
          ],
        },
      ],
      ok: true,
      value: {
        files: [
          {
            path: "notes.md",
            replacements: 2,
            lines: "1→Owner: Rowan\n2→Status: final",
          },
          { path: "plan.md", replacements: 1, lines: "1→Owner: Rowan" },
        ],
      },
      produced: [
        { path: "notes.md", change: "updated", bytes: 26 },
        { path: "plan.md", change: "updated", bytes: 12 },
      ],
    });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Owner: Rowan\nStatus: final",
    );
    await expect(readFile(join(root, "plan.md"), "utf8")).resolves.toBe(
      "Owner: Rowan",
    );
  });

  it("still declares the files it changed when a later one cannot be written", async () => {
    const root = await workspace({
      "notes.md": "Owner: Dana",
      "plan.md": "Owner: Dana",
    });
    // Windows refuses to replace a read-only file.
    await chmod(join(root, "plan.md"), 0o444);
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      edits: [
        {
          path: "notes.md",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
        { path: "plan.md", replacements: [{ find: "Dana", replace: "Rowan" }] },
      ],
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "plan.md could not be written. These files were already changed: notes.md. These were not: plan.md.",
      produced: [{ path: "notes.md", change: "updated", bytes: 12 }],
    });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Owner: Rowan",
    );
  });

  it("edits a Windows file without rewriting every line ending", async () => {
    const root = await workspace({
      "notes.md": "﻿Owner: Dana\r\nStatus: draft\r\n",
    });
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "notes.md",
            // The model proposes the block with Unix endings, as models do.
            replacements: [
              {
                find: "Owner: Dana\nStatus: draft",
                replace: "Owner: Rowan\nStatus: final",
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "﻿Owner: Rowan\r\nStatus: final\r\n",
    );
  });

  it("matches a block the file indents differently and keeps the file's indentation", async () => {
    const root = await workspace({
      "run.ts": "function run() {\n    const a = 1;\n    return a;\n}\n",
    });
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "run.ts",
            replacements: [
              {
                find: "const a = 1;\nreturn a;",
                replace: "const a = 2;\nreturn a * 2;",
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(join(root, "run.ts"), "utf8")).resolves.toBe(
      "function run() {\n    const a = 2;\n    return a * 2;\n}\n",
    );
  });

  it("says which replacement was found only with indentation set aside, and shows the lines it wrote", async () => {
    const root = await workspace({
      "run.ts": "function run() {\n    const a = 1;\n    return a;\n}\n",
    });

    const result = await new WorkspaceTools(root).execute("multi_edit", {
      path: "run.ts",
      replacements: [
        { find: "function run() {", replace: "function go() {" },
        { find: "const a = 1;\nreturn a;", replace: "const a = 2;\nreturn a;" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            path: "run.ts",
            lines: "1→function go() {\n2→    const a = 2;\n3→    return a;",
            note: "Replacement 2 was found only with indentation and trailing spaces set aside, and was written at the file's indentation.",
          },
        ],
      },
    });
  });

  it("shows the lines each edit produced, numbered, with one line around each, and nothing between", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const root = await workspace({ "list.txt": lines.join("\n") });

    const result = await new WorkspaceTools(root).execute("multi_edit", {
      path: "list.txt",
      replacements: [
        { find: "line 5\n", replace: "five\n" },
        { find: "line 15\n", replace: "fifteen\nfifteen and a half\n" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            lines:
              "4→line 4\n5→five\n6→line 6\n…\n14→line 14\n15→fifteen\n16→fifteen and a half\n17→line 16",
          },
        ],
      },
    });
  });

  it("says when an edit adds or removes the line break at the end of the file, and shows the last line", async () => {
    const root = await workspace({
      "open.txt": "a\nb",
      "closed.txt": "a\nb\n",
    });
    const tools = new WorkspaceTools(root);

    const added = await tools.execute("multi_edit", {
      path: "open.txt",
      replacements: [{ find: "b", replace: "b\n" }],
    });
    const removed = await tools.execute("multi_edit", {
      path: "closed.txt",
      replacements: [{ find: "b\n", replace: "b" }],
    });

    expect(await readFile(join(root, "open.txt"), "utf8")).toBe("a\nb\n");
    expect(await readFile(join(root, "closed.txt"), "utf8")).toBe("a\nb");
    expect(added).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            lines: "2→b",
            note: "A line break was added at the end of the file.",
          },
        ],
      },
    });
    expect(removed).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            lines: "2→b",
            note: "The line break at the end of the file was removed.",
          },
        ],
      },
    });
  });

  it("shows at most 40 lines of what an edit produced, and says how many more changed", async () => {
    const lines = Array.from({ length: 300 }, (_, index) => `item ${index}`);
    const root = await workspace({ "items.txt": lines.join("\n") });

    const result = await new WorkspaceTools(root).execute("multi_edit", {
      path: "items.txt",
      replacements: [{ find: "item", replace: "entry", replaceAll: true }],
    });

    if (!result.ok) throw new Error(result.reason);
    const [file] = (
      result.value as { files: { lines: string; note?: string }[] }
    ).files;
    expect(file?.lines.split("\n")).toHaveLength(40);
    expect(file?.lines.split("\n")[0]).toBe("1→entry 0");
    expect(file?.note).toBe(
      "260 more changed lines are not shown; read_file shows them.",
    );
  });

  it("fails a proposal that cannot be applied before anyone is asked to approve it", async () => {
    const root = await workspace({
      "notes.md": "Owner: Dana",
      "plan.md": "Owner: Dana",
    });
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "notes.md",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
        { path: "plan.md", replacements: [{ find: "Kim", replace: "Rowan" }] },
      ],
    };

    // Inspection is what a permission request is built from, so the failure has
    // to be here, not at execution.
    expect(await tools.inspect("multi_edit", args)).toEqual({
      ok: false,
      correctable: true,
      reason:
        "“Kim” was not found in plan.md. Read the file again and retry with its exact current text. No file was changed.",
    });
    await expect(tools.execute("multi_edit", args)).resolves.toMatchObject({
      ok: false,
    });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Owner: Dana",
    );
  });

  it("points at the closest region without quoting the file back", async () => {
    const root = await workspace({
      "notes.md": ["alpha", "beta", "gamma", "delta"].join("\n"),
    });
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("multi_edit", {
      edits: [
        {
          path: "notes.md",
          replacements: [
            { find: "beta\nGAMMA\ndelta", replace: "beta\ngamma\nepsilon" },
          ],
        },
      ],
    });

    expect(inspection).toMatchObject({ ok: false, correctable: true });
    expect(inspection).toHaveProperty(
      "reason",
      expect.stringContaining("closest similar text is at line 2"),
    );
    expect(JSON.stringify(inspection)).not.toContain("alpha");
  });

  it("refuses an ambiguous replacement instead of guessing which one", async () => {
    const root = await workspace({ "notes.md": "Dana and Dana" });
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "notes.md",
            replacements: [{ find: "Dana", replace: "Rowan" }],
          },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      correctable: true,
      reason:
        "“Dana” appears 2 times in notes.md. Include surrounding text to make it unique, or set replaceAll. No file was changed.",
    });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Dana and Dana",
    );

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "notes.md",
            replacements: [
              { find: "Dana", replace: "Rowan", replaceAll: true },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Rowan and Rowan",
    );
  });

  it("refuses an edit that would leave its file as it is, saying why", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana" });
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "notes.md",
            replacements: [{ find: "Dana", replace: "Dana" }],
          },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      correctable: true,
      reason:
        "notes.md would not change. Replacement 1 puts back the same text, so it was skipped. No file was changed.",
    });
    await expect(
      tools.execute("multi_edit", {
        path: "notes.md",
        replacements: [{ find: "’", replace: "'", replaceAll: true }],
      }),
    ).resolves.toEqual({
      ok: false,
      correctable: true,
      reason:
        "notes.md would not change. Replacement 1 matched nothing: 0 replaced. No file was changed.",
    });
  });

  it("refuses to edit a file that does not exist, and never quietly retries an escape", async () => {
    const parent = await folders.make("zhiyin-edit-");
    const root = join(parent, "inside");
    await mkdir(root);
    await writeFile(join(parent, "outside.md"), "secret", "utf8");
    const tools = new WorkspaceTools(root);

    // Leaving the workspace is a refusal a person should see, so it is not
    // marked correctable.
    expect(
      await tools.inspect("multi_edit", {
        edits: [
          {
            path: "../outside.md",
            replacements: [{ find: "secret", replace: "public" }],
          },
        ],
      }),
    ).toEqual({
      ok: false,
      reason: "Every edited file must stay inside the current workspace.",
    });

    expect(
      await tools.inspect("multi_edit", {
        edits: [
          { path: "absent.md", replacements: [{ find: "a", replace: "b" }] },
        ],
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "absent.md was not found in this workspace. multi_edit only changes files that already exist.",
    });
  });

  it("rejects the same file listed twice in one edit", async () => {
    const root = await workspace({ "notes.md": "a b" });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("multi_edit", {
        edits: [
          { path: "notes.md", replacements: [{ find: "a", replace: "c" }] },
          { path: "notes.md", replacements: [{ find: "b", replace: "d" }] },
        ],
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "notes.md is listed twice. Put every replacement for one file in a single entry.",
    });
  });

  it.each(["./notes.md", "NOTES.md", "docs/../notes.md"])(
    "rejects one file named twice, once as %s, and changes nothing",
    async (other) => {
      const root = await workspace({
        "notes.md": "Owner: Dana\nStatus: draft",
      });
      const tools = new WorkspaceTools(root);
      const args = {
        edits: [
          {
            path: "notes.md",
            replacements: [{ find: "Dana", replace: "Rowan" }],
          },
          { path: other, replacements: [{ find: "draft", replace: "final" }] },
        ],
      };

      const refused = {
        ok: false,
        correctable: true,
        reason: `${other} is the same file as notes.md. Put every replacement for one file in a single entry.`,
      };
      expect(await tools.inspect("multi_edit", args)).toEqual(refused);
      await expect(tools.execute("multi_edit", args)).resolves.toEqual(refused);
      expect(await readFile(join(root, "notes.md"), "utf8")).toBe(
        "Owner: Dana\nStatus: draft",
      );
    },
  );

  it("answers a file in Zhiyin's own folders to the model, which can choose another", async () => {
    const parent = await folders.make("zhiyin-edit-own-");
    const root = join(parent, "inside");
    const own = join(parent, "zhiyin-data");
    await mkdir(root);
    await mkdir(own);
    const path = join(own, "settings.json");
    await writeFile(path, '{"theme": "dark"}', "utf8");
    const tools = new WorkspaceTools(root, { protect: [own] });
    const args = {
      edits: [{ path, replacements: [{ find: "dark", replace: "light" }] }],
    };

    expect(await tools.inspect("multi_edit", args)).toEqual({
      ok: false,
      correctable: true,
      // Named as the tools name every path, with forward slashes.
      reason: `${path.replaceAll("\\", "/")} is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.`,
    });
    expect(await readFile(path, "utf8")).toBe('{"theme": "dark"}');
  });

  it("refuses a path naming a hidden stream of a file, as it does one outside the workspace", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana" });
    await writeFile(join(root, "notes.md:hidden"), "Owner: Dana", "utf8");
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "notes.md:hidden",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
      ],
    };

    const refused = {
      ok: false,
      reason: "Every edited file must stay inside the current workspace.",
    };
    expect(await tools.inspect("multi_edit", args)).toEqual(refused);
    await expect(tools.execute("multi_edit", args)).resolves.toEqual(refused);
    expect(await readFile(join(root, "notes.md:hidden"), "utf8")).toBe(
      "Owner: Dana",
    );
  });

  it("rejects one file named twice through a hard link, and changes nothing", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana\nStatus: draft" });
    await link(join(root, "notes.md"), join(root, "copy.md"));
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "notes.md",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
        {
          path: "copy.md",
          replacements: [{ find: "draft", replace: "final" }],
        },
      ],
    };

    const refused = {
      ok: false,
      correctable: true,
      reason:
        "copy.md is the same file as notes.md. Put every replacement for one file in a single entry.",
    };
    expect(await tools.inspect("multi_edit", args)).toEqual(refused);
    await expect(tools.execute("multi_edit", args)).resolves.toEqual(refused);
    expect(await readFile(join(root, "copy.md"), "utf8")).toBe(
      "Owner: Dana\nStatus: draft",
    );
  });

  it("edits the file Windows reaches when .. follows a link: the one beside the link", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana" });
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "docs", "deeper"));
    await writeFile(join(root, "docs", "notes.md"), "Owner: Dana", "utf8");
    await symlink(join(root, "docs", "deeper"), join(root, "lnk"), "junction");
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "lnk/../notes.md",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
      ],
    };

    expect(await tools.inspect("multi_edit", args)).toMatchObject({
      ok: true,
      target: "notes.md",
    });
    await expect(tools.execute("multi_edit", args)).resolves.toMatchObject({
      ok: true,
      produced: [{ path: "notes.md", change: "updated" }],
    });
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("Owner: Rowan");
    expect(await readFile(join(root, "docs", "notes.md"), "utf8")).toBe(
      "Owner: Dana",
    );
  });

  it("names an edited file by where it really is, a link inside the folder followed", async () => {
    const root = await workspace();
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "brief.md"), "Owner: Dana", "utf8");
    await symlink(join(root, "docs"), join(root, "lnk"), "junction");
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "lnk/brief.md",
          replacements: [{ find: "Dana", replace: "Rowan" }],
        },
      ],
    };

    expect(await tools.inspect("multi_edit", args)).toMatchObject({
      ok: true,
      target: "docs/brief.md",
      changes: [{ path: "docs/brief.md", change: "updated" }],
    });
    await expect(tools.execute("multi_edit", args)).resolves.toMatchObject({
      ok: true,
      produced: [{ path: "docs/brief.md", change: "updated" }],
    });
  });

  it("refuses to edit a file over 10 MiB, saying so, and changes nothing", async () => {
    const root = await workspace();
    const large = Buffer.concat([
      Buffer.from("Owner: Dana\n"),
      Buffer.alloc(11 * 1024 * 1024, "a"),
    ]);
    await writeFile(join(root, "export.csv"), large);
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      edits: [
        {
          path: "export.csv",
          replacements: [{ find: "Owner: Dana", replace: "Owner: Rowan" }],
        },
      ],
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("A file this large is not edited");
    expect(result.reason).toContain("10 MiB");
    expect((await readFile(join(root, "export.csv"))).equals(large)).toBe(true);
  });

  it("says in its description and the write's where a file may be, that it must be read first, and what the answer shows", async () => {
    const tools = new WorkspaceTools(await workspace());
    const described = (name: string) =>
      tools.list().find((tool) => tool.name === name)?.description;

    expect(described("multi_edit")).toMatch(
      /^Replace text in files that already exist: in the current workspace by a workspace-relative path, or elsewhere by an absolute path, which the person is asked about by that path\./,
    );
    expect(described("multi_edit")).toContain(
      "The file must have been read in this conversation since it last changed.",
    );
    expect(described("multi_edit")).toContain(
      "The answer shows the lines each edit wrote, numbered, with one line around each.",
    );
    expect(described("write_file")).toMatch(
      /^Create a UTF-8 text file, in the current workspace by a workspace-relative path or elsewhere by an absolute path, or replace one that already exists\./,
    );
    expect(described("write_file")).toContain(
      "A file that already exists must have been read completely in this conversation before it is replaced.",
    );
  });

  it("says in its description how large a file it changes and where matching is flexible", async () => {
    const tools = new WorkspaceTools(await workspace());

    expect(
      tools.list().find((tool) => tool.name === "multi_edit")?.description,
    ).toContain(
      "That flexible matching works in files of at most 20,000 lines, for text to find of at most 500 lines. A file larger than 10 MiB is not changed.",
    );
  });

  it("names the line limit, and an exact match as the way round it, for text it cannot find in a long file", async () => {
    const lines = Array.from({ length: 20_001 }, (_, index) => `line ${index}`);
    const root = await workspace({ "log.txt": lines.join("\n") });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("multi_edit", {
        path: "log.txt",
        replacements: [{ find: "  line 5\n  line 6", replace: "line five" }],
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "log.txt: The file has 20,001 lines. Text that does not match exactly is looked for line by line only in files of at most 20,000 lines. Copy the text exactly as the file has it, spaces included, or match it with regex. No file was changed.",
    });
  });

  it("names the line limit, and a shorter piece as the way round it, for long text it cannot find", async () => {
    const lines = Array.from({ length: 600 }, (_, index) => `line ${index}`);
    const root = await workspace({ "log.txt": lines.join("\n") });
    const tools = new WorkspaceTools(root);
    const find = lines
      .slice(0, 501)
      .map((line) => `  ${line}`)
      .join("\n");

    expect(
      await tools.inspect("multi_edit", {
        path: "log.txt",
        replacements: [{ find, replace: "gone" }],
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "log.txt: The text to find has 501 lines. Text that does not match exactly is looked for line by line only when it has at most 500 lines. Find a shorter, more specific piece, or copy it exactly as the file has it. No file was changed.",
    });
  });

  it("changes no file when a later file in the same edit cannot be applied", async () => {
    const root = await workspace({
      "a.md": "keep",
      "b.md": "keep",
    });
    const tools = new WorkspaceTools(root);

    await expect(
      tools.execute("multi_edit", {
        edits: [
          {
            path: "a.md",
            replacements: [{ find: "keep", replace: "changed" }],
          },
          { path: "b.md", replacements: [{ find: "absent", replace: "x" }] },
        ],
      }),
    ).resolves.toMatchObject({ ok: false, correctable: true });

    await expect(readFile(join(root, "a.md"), "utf8")).resolves.toBe("keep");
    await expect(readFile(join(root, "b.md"), "utf8")).resolves.toBe("keep");
  });
});

describe("replacing every occurrence of text that overlaps itself", () => {
  it("replaces the occurrences that do not overlap, from the first, and changes nothing else", async () => {
    const root = await workspace({
      "a.py": "def f():\n        return 1\n",
      "b.txt": "}\n}\n}\n",
      "c.txt": "a\n\n\n\nb\n",
    });
    const tools = new WorkspaceTools(root);
    const every = (path: string, find: string, replace: string) => ({
      edits: [{ path, replacements: [{ find, replace, replaceAll: true }] }],
    });

    for (const [path, find, replace] of [
      ["a.py", "    ", "\t"],
      ["b.txt", "}\n}", "};"],
      ["c.txt", "\n\n", "\n"],
    ] as const)
      expect(
        await tools.execute("multi_edit", every(path, find, replace)),
      ).toMatchObject({ ok: true });

    expect(await readFile(join(root, "a.py"), "utf8")).toBe(
      "def f():\n\t\treturn 1\n",
    );
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("};\n}\n");
    expect(await readFile(join(root, "c.txt"), "utf8")).toBe("a\n\nb\n");
  });

  it("replaces the occurrences that do not overlap when the text is found only with its indentation set aside", async () => {
    const root = await workspace({ "d.rb": "}\n}\n}\nend\n" });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.execute("multi_edit", {
        edits: [
          {
            path: "d.rb",
            replacements: [
              { find: "  }\n  }", replace: "};", replaceAll: true },
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: true });

    expect(await readFile(join(root, "d.rb"), "utf8")).toBe("};\n}\nend\n");
  });

  it("replaces every occurrence in a file of many lines, however they chain together", async () => {
    const lines = Array.from({ length: 300_000 }, (_, index) => `v${index}`);
    const root = await workspace({ "values.csv": `${lines.join(",\n")}\n` });
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      edits: [
        {
          path: "values.csv",
          replacements: [{ find: ",\n", replace: ", ", replaceAll: true }],
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    expect(await readFile(join(root, "values.csv"), "utf8")).toBe(
      `${lines.join(", ")}\n`,
    );
  });

  it("still refuses text that overlaps itself as ambiguous when only one occurrence is meant", async () => {
    const root = await workspace({ "a.txt": "aaa\n" });
    const tools = new WorkspaceTools(root);

    const result = await tools.inspect("multi_edit", {
      edits: [{ path: "a.txt", replacements: [{ find: "aa", replace: "b" }] }],
    });

    expect(result).toMatchObject({ ok: false, correctable: true });
    if (result.ok) throw new Error("An ambiguous find is refused");
    expect(result.reason).toContain("appears 2 times");
  });
});

describe("text copied from a numbered read", () => {
  it("is found without its line numbers, and the replacement is written without them", async () => {
    const root = await workspace({
      "notes.md": "Owner: Dana\nStatus: draft\n",
    });
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      edits: [
        {
          path: "notes.md",
          replacements: [
            {
              find: "1→Owner: Dana\n2→Status: draft",
              replace: "1→Owner: Rowan\n2→Status: final",
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe(
      "Owner: Rowan\nStatus: final\n",
    );
  });

  it("keeps a file whose lines really start with numbers editable exactly", async () => {
    const root = await workspace({ "steps.md": "1→mix\n2→bake\n" });
    const tools = new WorkspaceTools(root);

    await tools.execute("multi_edit", {
      edits: [
        {
          path: "steps.md",
          replacements: [{ find: "2→bake", replace: "2→cool" }],
        },
      ],
    });

    expect(await readFile(join(root, "steps.md"), "utf8")).toBe(
      "1→mix\n2→cool\n",
    );
  });

  it("refuses a file that is not UTF-8 rather than rewrite the characters it does not touch", async () => {
    const root = await workspace();
    // "café" in Windows-1252: the é is one byte, 0xE9, which UTF-8 cannot read.
    const legacy = Buffer.from("caf\xe9\nStatus: draft\n", "latin1");
    await writeFile(join(root, "menu.txt"), legacy);
    const tools = new WorkspaceTools(root);
    const args = {
      edits: [
        {
          path: "menu.txt",
          replacements: [{ find: "draft", replace: "final" }],
        },
      ],
    };

    const inspection = await tools.inspect("multi_edit", args);
    const execution = await tools.execute("multi_edit", args);

    expect(inspection).toMatchObject({ ok: false });
    expect(inspection.ok || inspection.reason).toContain("not UTF-8 text");
    expect(execution).toMatchObject({ ok: false });
    expect(await readFile(join(root, "menu.txt"))).toEqual(legacy);
  });

  /**
   * Both whole versions of a large file are too much to carry to the window,
   * but an edit to one line is not: the approval carries the lines it changes.
   */
  it("shows an edit to a large file as the lines it changes", async () => {
    const lines = Array.from(
      { length: 10_000 },
      (_, i) => `row ${i}: a line long enough to make the file large`,
    );
    const root = await workspace({ "data.txt": lines.join("\n") });
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("multi_edit", {
      edits: [
        {
          path: "data.txt",
          replacements: [{ find: "row 5000:", replace: "row five thousand:" }],
        },
      ],
    });

    expect(inspection.ok && inspection.changes?.[0]).toMatchObject({
      path: "data.txt",
      change: "updated",
      diff: { added: 1, removed: 1 },
    });
    const change = inspection.ok ? inspection.changes?.[0] : undefined;
    expect(change?.omitted).toBeUndefined();
    expect(change?.before).toBeUndefined();
    expect(JSON.stringify(change?.diff)).toContain("row five thousand:");
  });

  it("says a change is too large to show when the change itself is that large", async () => {
    const lines = Array.from(
      { length: 10_000 },
      (_, i) => `row ${i}: a line long enough to make the file large`,
    );
    const text = lines.join("\n");
    const root = await workspace({ "data.txt": text });
    const tools = new WorkspaceTools(root);

    const inspection = await tools.inspect("multi_edit", {
      edits: [
        {
          path: "data.txt",
          replacements: [{ find: text, replace: text.toUpperCase() }],
        },
      ],
    });

    expect(inspection.ok && inspection.changes?.[0]).toEqual({
      path: "data.txt",
      change: "updated",
      omitted: "This change is too large to show here.",
    });
  });
});

describe("a replacement found by a pattern", () => {
  const edit = (
    path: string,
    replacements: Record<string, unknown>[],
  ): Record<string, unknown> => ({ edits: [{ path, replacements }] });

  it("replaces every place a pattern matches, putting back what its groups matched", async () => {
    const root = await workspace({
      "page.html": [
        '<span class="anchor" id="d1"></span>',
        '<section class="day">Friday</section>',
        '<span class="anchor" id="money"></span>',
        '<section class="day">Money</section>',
      ].join("\n"),
    });
    const tools = new WorkspaceTools(root);

    const result = await tools.execute(
      "multi_edit",
      edit("page.html", [
        {
          find: '<span class="anchor" id="(\\w+)"></span>\\n<section class="day">',
          replace: '<section class="day" id="$1">',
          regex: true,
          replaceAll: true,
        },
      ]),
    );

    expect(result).toMatchObject({ ok: true });
    await expect(readFile(join(root, "page.html"), "utf8")).resolves.toBe(
      [
        '<section class="day" id="d1">Friday</section>',
        '<section class="day" id="money">Money</section>',
      ].join("\n"),
    );
  });

  it("matches ^ and $ at the start and end of each line", async () => {
    const root = await workspace({ "list.md": "- one\n- two\nthree - four" });
    const tools = new WorkspaceTools(root);

    await tools.execute(
      "multi_edit",
      edit("list.md", [
        { find: "^- (.*)$", replace: "* $1", regex: true, replaceAll: true },
      ]),
    );

    await expect(readFile(join(root, "list.md"), "utf8")).resolves.toBe(
      "* one\n* two\nthree - four",
    );
  });

  it("keeps a Windows file's line endings when a pattern spans lines", async () => {
    const root = await workspace({ "notes.txt": "a: 1\r\nb: 2\r\nc: 3\r\n" });
    const tools = new WorkspaceTools(root);

    await tools.execute(
      "multi_edit",
      edit("notes.txt", [
        { find: "a: (\\d)\\nb: (\\d)", replace: "b: $2\na: $1", regex: true },
      ]),
    );

    await expect(readFile(join(root, "notes.txt"), "utf8")).resolves.toBe(
      "b: 2\r\na: 1\r\nc: 3\r\n",
    );
  });

  it("refuses a pattern matching several places when one is meant, and one matching none, changing nothing", async () => {
    const text = "x1 x2 x3";
    const root = await workspace({ "a.txt": text });
    const tools = new WorkspaceTools(root);

    const several = await tools.inspect(
      "multi_edit",
      edit("a.txt", [{ find: "x\\d", replace: "y", regex: true }]),
    );
    const none = await tools.inspect(
      "multi_edit",
      edit("a.txt", [{ find: "z\\d", replace: "y", regex: true }]),
    );

    expect(several).toMatchObject({ ok: false, correctable: true });
    expect(several.ok || several.reason).toMatch(/3 places/);
    expect(none).toMatchObject({ ok: false, correctable: true });
    expect(none.ok || none.reason).toMatch(/matched nothing/);
    await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toBe(text);
  });

  it("says why a pattern is not one, and refuses one that matches empty text", async () => {
    const root = await workspace({ "a.txt": "abc" });
    const tools = new WorkspaceTools(root);

    const broken = await tools.inspect(
      "multi_edit",
      edit("a.txt", [{ find: "(abc", replace: "x", regex: true }]),
    );
    const empty = await tools.inspect(
      "multi_edit",
      edit("a.txt", [{ find: "q*", replace: "x", regex: true }]),
    );

    expect(broken).toMatchObject({ ok: false, correctable: true });
    expect(broken.ok || broken.reason).toMatch(/not a valid pattern/i);
    expect(empty).toMatchObject({ ok: false, correctable: true });
    expect(empty.ok || empty.reason).toMatch(/empty text/);
  });

  it("stops a pattern that would take too long, and refuses it", async () => {
    const root = await workspace({ "a.txt": `${"a".repeat(40)}!` });
    const tools = new WorkspaceTools(root);
    const started = Date.now();

    const slow = await tools.inspect(
      "multi_edit",
      edit("a.txt", [{ find: "^(a+)+$", replace: "x", regex: true }]),
    );

    expect(slow).toMatchObject({ ok: false, correctable: true });
    expect(slow.ok || slow.reason).toMatch(/too long/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("expands a replacement as JavaScript's own replace does", async () => {
    const text = "id=7 name=ada; id=12 name=bo";
    const pattern = "id=(?<id>\\d+) name=(\\w+)";
    for (const replace of [
      "$2#$1",
      "$<id>:$&",
      "$$1 costs $$",
      "[$`|$']",
      "$3 $0 $<missing> $<id",
      "$10 $01",
    ]) {
      const root = await workspace({ "a.txt": text });
      const tools = new WorkspaceTools(root);

      await tools.execute(
        "multi_edit",
        edit("a.txt", [
          { find: pattern, replace, regex: true, replaceAll: true },
        ]),
      );

      expect(await readFile(join(root, "a.txt"), "utf8"), replace).toBe(
        text.replace(new RegExp(pattern, "gm"), replace),
      );
    }
  });

  it("takes find as plain text unless regex is set", async () => {
    const root = await workspace({ "a.txt": "cost (x1)" });
    const tools = new WorkspaceTools(root);

    await tools.execute(
      "multi_edit",
      edit("a.txt", [{ find: "(x1)", replace: "(x2)" }]),
    );

    await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toBe(
      "cost (x2)",
    );
  });
});

describe("one file given at the top of the call", () => {
  it("edits the file named by path with its replacements, as one entry of edits would", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana\nStatus: draft" });
    const tools = new WorkspaceTools(root);
    const args = {
      path: "notes.md",
      replacements: [
        { find: "Dana", replace: "Rowan" },
        { find: "draft", replace: "final" },
      ],
    };

    expect(await tools.inspect("multi_edit", args)).toMatchObject({
      ok: true,
      action: "Edit a workspace file",
      target: "notes.md",
    });
    expect(await tools.execute("multi_edit", args)).toMatchObject({
      ok: true,
      value: { files: [{ path: "notes.md", replacements: 2 }] },
    });
    await expect(readFile(join(root, "notes.md"), "utf8")).resolves.toBe(
      "Owner: Rowan\nStatus: final",
    );
  });

  it("refuses one file at the top and edits beside it, changing nothing", async () => {
    const root = await workspace({ "a.md": "one", "b.md": "two" });
    const tools = new WorkspaceTools(root);

    const both = await tools.inspect("multi_edit", {
      path: "a.md",
      replacements: [{ find: "one", replace: "1" }],
      edits: [{ path: "b.md", replacements: [{ find: "two", replace: "2" }] }],
    });

    expect(both).toMatchObject({ ok: false, correctable: true });
    expect(both.ok || both.reason).toMatch(/not both/);
  });
});

describe("a batch whose replacements cannot all be made", () => {
  it("names every replacement that cannot be made, by its number, and changes nothing", async () => {
    const text = "Owner: Dana\nStatus: draft\nDue: Friday\nRoom: 4";
    const root = await workspace({ "notes.md": text });
    const tools = new WorkspaceTools(root);
    const args = {
      path: "notes.md",
      replacements: [
        { find: "Dana", replace: "Rowan" },
        { find: "Status: draft\nDue: Monday", replace: "Status: final" },
        { find: "Due: Friday", replace: "Due: Saturday" },
        { find: ": ", replace: " = " },
      ],
    };

    const refused = {
      ok: false,
      correctable: true,
      reason: [
        "Replacement 2 in notes.md: “Status: draft⏎Due: Monday” was not found. The closest similar text is at line 2, sharing about 50% of the block. Read the file again and retry with its exact current text.",
        "Replacement 4 in notes.md: “: ” appears 4 times. Include surrounding text to make it unique, or set replaceAll.",
        "Each replacement is checked against the text left by the ones before it that can be made, and a line number counts in that text. Send the whole edit again with these corrected. No file was changed.",
      ].join("\n"),
    };
    expect(await tools.inspect("multi_edit", args)).toEqual(refused);
    await expect(tools.execute("multi_edit", args)).resolves.toEqual(refused);
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe(text);
  });

  it("names the replacements that cannot be made in every file of the call", async () => {
    const root = await workspace({ "a.md": "one", "b.md": "two two" });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("multi_edit", {
        edits: [
          { path: "a.md", replacements: [{ find: "uno", replace: "1" }] },
          {
            path: "b.md",
            replacements: [
              { find: "two two", replace: "2 2" },
              { find: "three", replace: "3" },
            ],
          },
        ],
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason: [
        "“uno” was not found in a.md. Read the file again and retry with its exact current text.",
        "Replacement 2 in b.md: “three” was not found. Read the file again and retry with its exact current text.",
        "Each replacement is checked against the text left by the ones before it that can be made, and a line number counts in that text. Send the whole edit again with these corrected. No file was changed.",
      ].join("\n"),
    });
  });

  it("checks a later replacement against the text the ones before it that can be made leave", async () => {
    const root = await workspace({ "notes.md": "alpha beta" });
    const tools = new WorkspaceTools(root);

    const result = await tools.inspect("multi_edit", {
      path: "notes.md",
      replacements: [
        { find: "alpha", replace: "one" },
        { find: "gamma", replace: "three" },
        // Found only in the text replacement 1 leaves.
        { find: "one beta", replace: "one two" },
        // Would be found only in the text replacement 2 would have left.
        { find: "three", replace: "3" },
      ],
    });

    expect(result).toMatchObject({ ok: false, correctable: true });
    if (result.ok)
      throw new Error("A batch with a wrong replacement is refused");
    expect(result.reason).toContain("Replacement 2 in notes.md:");
    expect(result.reason).not.toContain("Replacement 3");
    expect(result.reason).toContain("Replacement 4 in notes.md:");
  });

  it("skips a replacement that puts back the same text, applies the others, and says which it skipped", async () => {
    const root = await workspace({ "notes.md": "Owner: Dana\nStatus: draft" });
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      path: "notes.md",
      replacements: [
        { find: "Dana", replace: "Dana" },
        { find: "draft", replace: "final" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            path: "notes.md",
            replacements: 1,
            note: "Replacement 1 puts back the same text, so it was skipped.",
          },
        ],
      },
    });
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe(
      "Owner: Dana\nStatus: final",
    );
  });

  it("replaces nothing for a replaceAll that matches nothing, applies the others, and says 0 replaced", async () => {
    const root = await workspace({ "trip.md": "Day 1: Guilin\nStatus: draft" });
    const tools = new WorkspaceTools(root);

    const result = await tools.execute("multi_edit", {
      path: "trip.md",
      replacements: [
        { find: "’", replace: "'", replaceAll: true },
        { find: "draft", replace: "final" },
        { find: "^#+ ", replace: "", regex: true, replaceAll: true },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: [
          {
            path: "trip.md",
            replacements: 1,
            note: "Replacements 1 and 3 matched nothing: 0 replaced.",
          },
        ],
      },
    });
    expect(await readFile(join(root, "trip.md"), "utf8")).toBe(
      "Day 1: Guilin\nStatus: final",
    );
  });
});
