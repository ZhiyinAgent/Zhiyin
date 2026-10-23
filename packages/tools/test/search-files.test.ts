/**
 * Searching file contents with the bundled ripgrep: literal text by default, a
 * pattern when asked for one, ignore files honoured, and a count that is
 * either exact or says it is a lower bound.
 */

import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "../src/index.js";
import { runSearchFiles } from "../src/search-files.js";
import { bundledRipgrep } from "../src/ripgrep.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await folders.make("zhiyin-search-");
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return root;
}

type Found = {
  readonly matches: readonly {
    readonly path: string;
    readonly line: number;
    readonly text: string;
  }[];
  readonly total?: number;
  readonly atLeast?: number;
  readonly truncated: boolean;
};

async function search(root: string, args: Record<string, unknown>) {
  const result = await new WorkspaceTools(root).execute("search_files", args);
  if (!result.ok) throw new Error(result.reason);
  return result.value as Found;
}

const where = (found: Found) =>
  found.matches.map((match) => `${match.path}:${match.line}`);

describe("search_files", () => {
  it("finds literal text, ignoring letter case, even text that looks like a pattern", async () => {
    const root = await workspace({
      "notes.md": "Costs (Q3): 12\nnothing here\ncosts (q3): 14",
      "other.md": "Costs Q3 without brackets",
    });

    const found = await search(root, { query: "costs (q3)" });

    expect(where(found)).toEqual(["notes.md:1", "notes.md:3"]);
    expect(found.total).toBe(2);
  });

  it("matches a pattern when asked for one", async () => {
    const root = await workspace({
      "budget.md": "budget 2024\nbudget draft\nBudget   2026",
    });

    const found = await search(root, {
      query: "budget\\s+\\d{4}",
      regex: true,
    });

    expect(where(found)).toEqual(["budget.md:1", "budget.md:3"]);
  });

  it("matches letter case exactly when asked", async () => {
    const root = await workspace({ "a.md": "Paris\nparis" });

    expect(
      where(await search(root, { query: "Paris", caseSensitive: true })),
    ).toEqual(["a.md:1"]);
  });

  it("treats a query that starts with a dash as text to find, never as an option", async () => {
    const root = await workspace({
      "help.md": "run it with -v for detail\nnothing",
    });

    expect(where(await search(root, { query: "-v" }))).toEqual(["help.md:1"]);
  });

  it("leaves out what .gitignore lists and hidden files, unless asked to include them", async () => {
    const root = await workspace({
      ".gitignore": "secret.log\n",
      "secret.log": "the passphrase",
      "notes.md": "the passphrase",
      ".private/notes.md": "the passphrase",
      "node_modules/pkg/readme.md": "the passphrase",
    });

    expect(where(await search(root, { query: "passphrase" }))).toEqual([
      "notes.md:1",
    ]);
    expect(
      where(await search(root, { query: "passphrase", includeIgnored: true })),
    ).toEqual([
      ".private/notes.md:1",
      "node_modules/pkg/readme.md:1",
      "notes.md:1",
      "secret.log:1",
    ]);
  });

  it("follows the workspace's .gitignore in a folder below it, and names an ignored folder's files only when asked", async () => {
    const root = await workspace({
      ".gitignore": "src/gen/\n*.log\n",
      "src/a.txt": "needle",
      "src/gen/b.txt": "needle",
      "src/c.log": "needle",
      "src/lib/d.txt": "needle",
      "other.txt": "needle",
    });

    expect(where(await search(root, { query: "needle", path: "src" }))).toEqual(
      ["src/a.txt:1", "src/lib/d.txt:1"],
    );
    expect(
      where(await search(root, { query: "needle", path: "src/gen" })),
    ).toEqual([]);
    expect(
      where(
        await search(root, {
          query: "needle",
          path: "src",
          includeIgnored: true,
        }),
      ),
    ).toEqual([
      "src/a.txt:1",
      "src/c.log:1",
      "src/gen/b.txt:1",
      "src/lib/d.txt:1",
    ]);
  });

  it("keeps a search of a folder to that folder, and counts only its lines, whatever the .gitignore lets through", async () => {
    const root = await workspace({
      ".gitignore": "*.log\n!/other/\n",
      "src/a.txt": "needle",
      "src/b.log": "needle",
      "other/c.txt": "needle\nneedle",
      "top.txt": "needle",
    });

    const found = await search(root, { query: "needle", path: "src" });

    expect(where(found)).toEqual(["src/a.txt:1"]);
    expect(found.total).toBe(1);
  });

  it("follows the workspace's .gitignore in a hidden folder and in folders named with pattern characters", async () => {
    const root = await workspace({
      ".gitignore": "*.log\n",
      ".config/sub/a.txt": "needle",
      ".config/sub/b.log": "needle",
      "Reports {2026}/in.txt": "needle",
      "Reports 2026/out.txt": "needle",
      "x[1]/in.txt": "needle",
      "x1/out.txt": "needle",
    });

    expect(
      where(await search(root, { query: "needle", path: ".config/sub" })),
    ).toEqual([".config/sub/a.txt:1"]);
    expect(
      where(await search(root, { query: "needle", path: "Reports {2026}" })),
    ).toEqual(["Reports {2026}/in.txt:1"]);
    expect(
      where(await search(root, { query: "needle", path: "x[1]" })),
    ).toEqual(["x[1]/in.txt:1"]);
  });

  it("leaves nothing behind in the temporary folder after a search of a folder", async () => {
    const root = await workspace({ "src/a.txt": "needle" });
    const temporary = await folders.make("zhiyin-temp-");
    const saved = { TEMP: process.env["TEMP"], TMP: process.env["TMP"] };
    process.env["TEMP"] = temporary;
    process.env["TMP"] = temporary;
    try {
      expect(
        where(await search(root, { query: "needle", path: "src" })),
      ).toEqual(["src/a.txt:1"]);
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }

    expect(await readdir(temporary)).toEqual([]);
  });

  it("leaves a folder of build output out, whatever its letter case, unless asked or named", async () => {
    const root = await workspace({
      "out/report.txt": "needle",
      "Build/plan.txt": "needle",
      "notes.txt": "needle",
    });

    const found = await search(root, { query: "needle" });
    expect(where(found)).toEqual(["notes.txt:1"]);
    expect((found as { notSearched?: string[] }).notSearched).toEqual(
      expect.arrayContaining(["out", "build"]),
    );
    expect(
      where(await search(root, { query: "needle", includeIgnored: true })),
    ).toEqual(["Build/plan.txt:1", "notes.txt:1", "out/report.txt:1"]);
    expect(where(await search(root, { query: "needle", path: "out" }))).toEqual(
      ["out/report.txt:1"],
    );
  });

  it("shows a matching line that is not UTF-8 as read_file shows it", async () => {
    const root = await workspace({});
    // "Facture café : 12 €" in Windows-1252: é is 0xE9 and € is 0x80.
    await writeFile(
      join(root, "facture.txt"),
      Buffer.concat([
        Buffer.from("Facture caf", "latin1"),
        Buffer.from([0xe9]),
        Buffer.from(" : 12 ", "latin1"),
        Buffer.from([0x80]),
        Buffer.from("\r\nsecond line\r\n", "latin1"),
      ]),
    );
    const tools = new WorkspaceTools(root);
    const read = await tools.execute("read_file", { path: "facture.txt" });
    if (!read.ok) throw new Error(read.reason);
    const [, shown] =
      /(?:^|\n)1→([^\n]*)/.exec((read.value as { text: string }).text) ?? [];

    const found = await search(root, { query: "Facture" });

    expect(shown).toMatch(/^Facture caf.+ : 12 .$/);
    expect(found.matches).toEqual([
      { path: "facture.txt", line: 1, text: shown },
    ]);
  });

  it("searches only the files whose names match, when given a file pattern", async () => {
    const root = await workspace({
      "a.md": "invoice",
      "b.txt": "invoice",
      "docs/c.md": "invoice",
    });

    expect(
      where(await search(root, { query: "invoice", files: "*.md" })),
    ).toEqual(["a.md:1", "docs/c.md:1"]);
  });

  it("leaves out files .gitignore lists though their names match the pattern, unless ignored files are asked for", async () => {
    const root = await workspace({
      ".gitignore": "*.log\n",
      "a.log": "invoice",
      "src/b.log": "invoice",
      "a.txt": "invoice",
    });

    expect(
      where(await search(root, { query: "invoice", files: "*.log" })),
    ).toEqual([]);
    expect(
      where(
        await search(root, {
          query: "invoice",
          files: "*.log",
          includeIgnored: true,
        }),
      ),
    ).toEqual(["a.log:1", "src/b.log:1"]);
  });

  it("matches a file pattern in either letter case, as Windows names do", async () => {
    const root = await workspace({
      "a.txt": "invoice",
      "B.TXT": "invoice",
      "c.md": "invoice",
      "docs/D.Md": "invoice",
    });

    expect(
      where(await search(root, { query: "invoice", files: "*.TXT" })),
    ).toEqual(["a.txt:1", "B.TXT:1"]);
    expect(
      where(await search(root, { query: "invoice", files: "**/*.[m]d" })),
    ).toEqual(["c.md:1", "docs/D.Md:1"]);
  });

  it("asks for a folder as the path, not inside the file pattern", async () => {
    const root = await workspace({ "docs/a.md": "invoice" });

    for (const files of ["docs/*.md", "docs\\*.md"]) {
      const result = await new WorkspaceTools(root).execute("search_files", {
        query: "invoice",
        files,
      });

      expect(result).toMatchObject({
        ok: false,
        correctable: true,
        reason:
          "files matches file names only, such as '*.md'. To search one folder, give it as path.",
      });
    }
  });

  it("says how many lines matched in all when it shows only the first of them", async () => {
    const root = await workspace({
      "log.txt": Array.from({ length: 150 }, (_, i) => `error ${i}`).join("\n"),
    });

    const found = await search(root, { query: "error" });

    expect(found.matches).toHaveLength(100);
    expect(found.truncated).toBe(true);
    expect(found.total).toBe(150);
    expect(found.atLeast).toBeUndefined();
  });

  it("shows the first matches by folder and line, however many files matched", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 300; index += 1)
      files[`notes/${String(index).padStart(3, "0")}.txt`] = "budget\nbudget";
    const root = await workspace(files);

    const found = await search(root, { query: "budget" });

    expect(found.total).toBe(600);
    expect(where(found).slice(0, 4)).toEqual([
      "notes/000.txt:1",
      "notes/000.txt:2",
      "notes/001.txt:1",
      "notes/001.txt:2",
    ]);
    expect(where(found).at(-1)).toBe("notes/049.txt:2");
  });

  it("does not follow a link out of the workspace", async () => {
    const outside = await workspace({ "secret.md": "invoice" });
    const root = await workspace({ "inside.md": "invoice" });
    try {
      await symlink(outside, join(root, "elsewhere"), "junction");
    } catch {
      return; // This machine does not allow creating links.
    }

    expect(where(await search(root, { query: "invoice" }))).toEqual([
      "inside.md:1",
    ]);
    expect(
      where(await search(root, { query: "invoice", includeIgnored: true })),
    ).toEqual(["inside.md:1"]);
  });

  it("reports a lower bound, never a total, when the search is cut short", async () => {
    const root = await workspace({
      "log.txt": Array.from({ length: 2_000 }, (_, i) => `error ${i}`).join(
        "\n",
      ),
    });

    const result = await runSearchFiles(root, { query: "error" }, undefined, {
      rg: bundledRipgrep()!,
      maximumOutputBytes: 16_000,
    });
    if (!result.ok) throw new Error(result.reason);
    const found = result.value as Found;

    expect(found.total).toBeUndefined();
    expect(found.atLeast).toBeGreaterThan(0);
    expect(found.atLeast).toBeLessThan(2_000);
    expect(found.truncated).toBe(true);
  });

  it("names a pattern it cannot read", async () => {
    const root = await workspace({ "a.md": "text" });

    const result = await new WorkspaceTools(root).execute("search_files", {
      query: "budget(",
      regex: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "“budget(” is not a valid pattern.",
    });
  });
});
