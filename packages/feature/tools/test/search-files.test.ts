/**
 * Searching file contents with the bundled ripgrep: literal text by default, a
 * pattern when asked for one, ignore files honoured, and a count that is
 * either exact or says it is a lower bound.
 */

import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "../src/index.js";
import { runSearchFiles } from "../src/files/search/search-files.js";
import { runProcess } from "@zhiyin/sandbox";
import { bundledRipgrep } from "@zhiyin/workspace-listing";

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
  readonly files: readonly {
    readonly path: string;
    readonly matching: number;
    readonly lines: readonly {
      readonly line: number;
      readonly text: string;
      readonly context?: true;
    }[];
  }[];
  readonly total?: number;
  readonly atLeast?: number;
  readonly truncated: boolean;
  readonly note?: string;
  readonly notSearched?: string[];
};

async function search(root: string, args: Record<string, unknown>) {
  const result = await new WorkspaceTools(root).execute("search_files", args);
  if (!result.ok) throw new Error(result.reason);
  return result.value as Found;
}

/** The matching lines shown, each as path and line, context left out. */
const matches = (found: Found) =>
  found.files.flatMap((file) =>
    file.lines
      .filter((line) => !line.context)
      .map(({ line, text }) => ({ path: file.path, line, text })),
  );
const where = (found: Found) =>
  matches(found).map((match) => `${match.path}:${match.line}`);

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

  it("says binary files are not searched, in a folder and when one is the path", async () => {
    const root = await workspace({
      "data/b.dat": "abc needle\0def\nneedle two\n",
      "data/notes.txt": "no match here",
    });

    const inFolder = await search(root, { query: "needle", path: "data" });
    const named = await new WorkspaceTools(root).execute("search_files", {
      query: "needle",
      path: "data/b.dat",
    });

    expect(inFolder).toMatchObject({ total: 0 });
    expect(inFolder.notSearched).toContain("binary files");
    expect(named).toMatchObject({
      ok: false,
      correctable: true,
      reason: expect.stringContaining("data/b.dat is a binary file"),
    });
  });

  it("searches one file when the path names a file, in every output, whatever the .gitignore lists", async () => {
    const root = await workspace({
      ".gitignore": "*.log\n",
      "src/a.ts": "needle\nneedle\nhay",
      "src/b.ts": "needle",
      "src/run.log": "needle",
    });

    for (const includeIgnored of [false, true]) {
      const lines = await search(root, {
        query: "needle",
        path: "src/a.ts",
        includeIgnored,
      });
      const files = await search(root, {
        query: "needle",
        path: "src/a.ts",
        output: "files",
        includeIgnored,
      });
      const count = await search(root, {
        query: "needle",
        path: "src/a.ts",
        output: "count",
        includeIgnored,
      });

      expect(where(lines)).toEqual(["src/a.ts:1", "src/a.ts:2"]);
      expect(lines).toMatchObject({ total: 2, inFiles: 1, notSearched: [] });
      expect(files).toMatchObject({
        files: [{ path: "src/a.ts", matching: 2 }],
        total: 2,
        inFiles: 1,
      });
      expect(count).toMatchObject({ total: 2, inFiles: 1 });
    }
    expect(
      where(await search(root, { query: "needle", path: "src/run.log" })),
    ).toEqual(["src/run.log:1"]);
  });

  it("asks for a folder, not a file, when a file pattern goes with the path", async () => {
    const root = await workspace({ "src/a.ts": "needle" });
    const tools = new WorkspaceTools(root);
    const args = { query: "needle", path: "src/a.ts", files: "*.md" };
    const reason =
      "src/a.ts is one file, so files has nothing to choose from. Leave files out, or give a folder as path.";

    await expect(tools.inspect("search_files", args)).resolves.toMatchObject({
      ok: false,
      correctable: true,
      reason,
    });
    await expect(tools.execute("search_files", args)).resolves.toMatchObject({
      ok: false,
      reason,
    });
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
    expect(matches(found)).toEqual([
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

    expect(matches(found)).toHaveLength(100);
    expect(found.truncated).toBe(true);
    expect(found.total).toBe(150);
    expect(found.atLeast).toBeUndefined();
    expect(found.note).toBe(
      "Showing the first 100 of 150 matching lines. Narrow the query, the folder or files to see the rest.",
    );
  });

  it("cuts a matching line at 300 characters, and says how to see all of it", async () => {
    const root = await workspace({ "data.csv": `total,${"9".repeat(400)}` });

    const found = await search(root, { query: "total" });

    expect(matches(found)).toEqual([
      { path: "data.csv", line: 1, text: `total,${"9".repeat(294)}…` },
    ]);
    expect(found.note).toBe(
      "Lines longer than 300 characters are cut at 300, marked with …; read_file shows the whole line.",
    );
  });

  it("adds no note when it shows every matching line whole", async () => {
    const root = await workspace({ "notes.md": "invoice" });

    expect((await search(root, { query: "invoice" })).note).toBeUndefined();
  });

  it("says in its description and schema how much it shows and how long a query may be", async () => {
    const spec = new WorkspaceTools(await workspace({}))
      .list()
      .find((tool) => tool.name === "search_files");

    expect(spec?.description).toContain(
      "At most 100 matching lines are shown, each cut to 300 characters, and the answer says how many lines matched in all.",
    );
    expect(spec?.inputSchema).toMatchObject({
      properties: { query: { maxLength: 400 } },
    });
  });

  it("refuses a query over 400 characters by naming the limit and what to do instead", async () => {
    const root = await workspace({});

    expect(
      await new WorkspaceTools(root).inspect("search_files", {
        query: "a".repeat(401),
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "The query is 401 characters; it can be at most 400. Search for a shorter, distinctive part of the text.",
    });
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

  it("groups matching lines by file, each with how many of its lines matched", async () => {
    const root = await workspace({
      "big.log": Array.from({ length: 300 }, (_, i) => `error ${i}`).join("\n"),
      "small.log": "error once",
    });

    const found = await search(root, { query: "error" });

    expect(found.total).toBe(301);
    expect(found).toMatchObject({ inFiles: 2 });
    expect(
      found.files.map(({ path, matching }) => ({ path, matching })),
    ).toEqual([{ path: "big.log", matching: 300 }]);
    expect(found.files[0]?.lines).toHaveLength(100);
    expect(found.note).toBe(
      'Showing the first 100 of 301 matching lines, in 1 of the 2 files that matched. Narrow the query, the folder or files to see the rest, or give output "files" to see every file that matched.',
    );
  });

  it("shows the lines around each match when context is asked for, marked as context", async () => {
    const root = await workspace({
      "notes.md": "one\ntwo\nneedle\nfour\nfive\nsix\nseven\nneedle\nnine",
    });

    const found = await search(root, { query: "needle", context: 1 });

    expect(found.files).toEqual([
      {
        path: "notes.md",
        matching: 2,
        lines: [
          { line: 2, text: "two", context: true },
          { line: 3, text: "needle" },
          { line: 4, text: "four", context: true },
          { line: 7, text: "seven", context: true },
          { line: 8, text: "needle" },
          { line: 9, text: "nine", context: true },
        ],
      },
    ]);
  });

  it("names each file that matched and how many of its lines did, without the lines, when asked for files", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 250; index += 1)
      files[`notes/${String(index).padStart(3, "0")}.txt`] = "budget\nbudget";
    files["notes/other.txt"] = "nothing";
    const root = await workspace(files);

    const found = (await search(root, {
      query: "budget",
      output: "files",
    })) as unknown as {
      files: { path: string; matching: number; lines?: unknown }[];
      total: number;
      inFiles: number;
      note?: string;
    };

    expect(found.total).toBe(500);
    expect(found.inFiles).toBe(250);
    expect(found.files).toHaveLength(200);
    expect(found.files[0]).toEqual({ path: "notes/000.txt", matching: 2 });
    expect(found.note).toBe(
      "Showing the first 200 of the 250 files that matched. Narrow the query, the folder or files to see the rest.",
    );
  });

  it("gives only the counts when asked for a count", async () => {
    const root = await workspace({
      "a.md": "invoice\ninvoice",
      "b.md": "invoice",
      "c.md": "nothing",
    });

    const found = await search(root, { query: "invoice", output: "count" });

    expect(found).toMatchObject({ total: 3, inFiles: 2 });
    expect(found).not.toHaveProperty("files");
  });

  it("refuses context beyond five lines, or with an output that shows no lines", async () => {
    const root = await workspace({ "a.md": "invoice" });
    const tools = new WorkspaceTools(root);

    expect(
      await tools.inspect("search_files", { query: "invoice", context: 6 }),
    ).toMatchObject({ ok: false, correctable: true });
    expect(
      await tools.inspect("search_files", {
        query: "invoice",
        output: "files",
        context: 2,
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        'context shows lines around each match, so it goes with output "lines" only.',
    });
  });

  it("says in its description which outputs it gives and how much context", async () => {
    const spec = new WorkspaceTools(await workspace({}))
      .list()
      .find((tool) => tool.name === "search_files");

    expect(spec?.description).toContain(
      'output "files" names each file that matched, at most 200, with how many of its lines matched; output "count" gives only the totals. context shows up to 5 lines around each match, at most 300 lines in all.',
    );
    expect(spec?.inputSchema).toMatchObject({
      properties: {
        output: { enum: ["lines", "files", "count"] },
        context: { minimum: 0, maximum: 5 },
      },
    });
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
      run: runProcess,
      maximumOutputBytes: 16_000,
    });
    if (!result.ok) throw new Error(result.reason);
    const found = result.value as Found;

    expect(found.total).toBeUndefined();
    expect(found.atLeast).toBeGreaterThan(0);
    expect(found.atLeast).toBeLessThan(2_000);
    expect(found.truncated).toBe(true);
    expect(found.note).toMatch(
      /^The search was cut short, so only \d+ of at least \d+ matching lines are shown\. Narrow the query, the folder or files\.$/,
    );
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
