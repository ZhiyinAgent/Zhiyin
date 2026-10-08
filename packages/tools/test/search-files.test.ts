/**
 * Searching file contents with the bundled ripgrep: literal text by default, a
 * pattern when asked for one, ignore files honoured, and a count that is
 * either exact or says it is a lower bound.
 */

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";
import { runSearchFiles } from "../src/search-files.js";
import { bundledRipgrep } from "../src/ripgrep.js";

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-search-"));
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
    ).toEqual([".private/notes.md:1", "notes.md:1", "secret.log:1"]);
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
