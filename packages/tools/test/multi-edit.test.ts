import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-edit-"));
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
      preserveOnRepair: ["replace"],
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
      preserveOnRepair: ["replace"],
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
      preserveOnRepair: ["replace"],
      reason:
        "A replacement in notes.md puts back the same text. No file was changed.",
    });
  });

  it("refuses to edit a file that does not exist, and never quietly retries an escape", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zhiyin-edit-"));
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
      preserveOnRepair: ["replace"],
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
      preserveOnRepair: ["replace"],
      reason:
        "notes.md is listed twice. Put every replacement for one file in a single entry.",
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
});
