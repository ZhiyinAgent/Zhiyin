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
import { TemporaryFolders } from "@zhiyin/temporary-folders";
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
          { path: "notes.md", replacements: 2 },
          { path: "plan.md", replacements: 1 },
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
      faulty: ["edits[1].replacements[0].find"],
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
      faulty: ["edits[0].replacements[0].find"],
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

  it("reports a replacement that would change nothing as a failure", async () => {
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
        "A replacement in notes.md puts back the same text. No file was changed.",
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
      faulty: ["edits[0].path"],
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
