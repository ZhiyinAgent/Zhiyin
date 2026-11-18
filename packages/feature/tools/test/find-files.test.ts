/**
 * Finding files by name: "every PDF under Invoices", "the file called
 * budget-something". The answer says how many matched, and when it could not
 * look everywhere it says how far it got instead of implying it did.
 */

import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "../src/index.js";
import { runFindFiles } from "../src/files/search/find-files.js";
import { runProcess } from "@zhiyin/sandbox";
import { bundledRipgrep } from "@zhiyin/workspace-listing";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function workspace(files: readonly string[]): Promise<string> {
  const root = await folders.make("zhiyin-find-");
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "x");
  }
  return root;
}

type Found = {
  readonly matches: readonly { readonly path: string }[];
  readonly total?: number;
  readonly atLeast?: number;
  readonly note?: string;
};

async function find(root: string, args: Record<string, unknown>) {
  const result = await new WorkspaceTools(root).execute("find_files", args);
  if (!result.ok) throw new Error(result.reason);
  return result.value as Found;
}

const paths = (found: Found) => found.matches.map((match) => match.path);

describe("find_files", () => {
  it("finds a name at any depth, ignoring letter case, and leaves generated folders out", async () => {
    const root = await workspace([
      "Invoices/2026/march.pdf",
      "report.PDF",
      "notes.md",
      "node_modules/pkg/readme.pdf",
    ]);

    const found = await find(root, { pattern: "*.pdf" });

    expect(paths(found)).toEqual(["Invoices/2026/march.pdf", "report.PDF"]);
    expect(found.total).toBe(2);
  });

  it("matches a pattern with a folder in it against the path, where ** spans any number of folders", async () => {
    const root = await workspace([
      "Invoices/a.pdf",
      "Invoices/2026/march.pdf",
      "Other/b.pdf",
    ]);

    expect(paths(await find(root, { pattern: "Invoices/**/*.pdf" }))).toEqual([
      "Invoices/2026/march.pdf",
      "Invoices/a.pdf",
    ]);
    expect(paths(await find(root, { pattern: "Invoices/*.pdf" }))).toEqual([
      "Invoices/a.pdf",
    ]);
  });

  it("accepts alternatives, single characters, and Windows separators", async () => {
    const root = await workspace([
      "plan.docx",
      "plan.xlsx",
      "plan.pdf",
      "q1.csv",
      "q12.csv",
      "Reports/summary.docx",
    ]);

    expect(paths(await find(root, { pattern: "*.{docx,xlsx}" }))).toEqual([
      "plan.docx",
      "plan.xlsx",
      "Reports/summary.docx",
    ]);
    expect(paths(await find(root, { pattern: "q?.csv" }))).toEqual(["q1.csv"]);
    expect(paths(await find(root, { pattern: "Reports\\*.docx" }))).toEqual([
      "Reports/summary.docx",
    ]);
  });

  it("finds folders too, marked as folders", async () => {
    const root = await workspace(["Invoices/2026/march.pdf"]);

    const found = await find(root, { pattern: "invoices" });

    expect(found.matches).toEqual([{ path: "Invoices", kind: "folder" }]);
  });

  it("searches only inside the folder it is given, and names matches from the workspace root", async () => {
    const root = await workspace(["Invoices/a.pdf", "Other/b.pdf"]);

    expect(
      paths(await find(root, { pattern: "*.pdf", path: "Invoices" })),
    ).toEqual(["Invoices/a.pdf"]);
  });

  it.each(["src/", "./src", "src\\", "src/./", "Other/../src"])(
    "names the same files however the folder is written: %s",
    async (path) => {
      const root = await workspace([
        "src/a.txt",
        "src/lib/b.txt",
        "Other/c.txt",
      ]);

      const found = await find(root, { pattern: "*.txt", path });
      expect(paths(found)).toEqual(["src/a.txt", "src/lib/b.txt"]);
      expect(found.matches.every((match) => "size" in match)).toBe(true);
      expect(paths(await find(root, { pattern: "lib/*.txt", path }))).toEqual([
        "src/lib/b.txt",
      ]);
    },
  );

  it("says how many matched in all when it shows only the first of them", async () => {
    const root = await workspace(
      Array.from({ length: 230 }, (_, index) => `scans/page-${index}.png`),
    );

    const found = await find(root, { pattern: "*.png" });

    expect(found.matches).toHaveLength(200);
    expect(found.total).toBe(230);
    expect(found.atLeast).toBeUndefined();
    expect(found.note).toBe(
      "Showing the first 200 of 230 matches. Narrow the pattern, or search a folder inside this one, to see the rest.",
    );
  });

  it("adds no note when it shows every match", async () => {
    const root = await workspace(["a.png", "b.png"]);

    expect((await find(root, { pattern: "*.png" })).note).toBeUndefined();
  });

  it("says in its description and schema how many matches it shows and how long a pattern may be", async () => {
    const spec = new WorkspaceTools(await workspace([]))
      .list()
      .find((tool) => tool.name === "find_files");

    expect(spec?.description).toContain(
      "At most 200 matches are shown, and the answer says how many matched in all.",
    );
    expect(spec?.inputSchema).toMatchObject({
      properties: { pattern: { maxLength: 400 } },
    });
  });

  it("refuses a pattern over 400 characters by naming the limit and what to do instead", async () => {
    const root = await workspace([]);

    expect(
      await new WorkspaceTools(root).inspect("find_files", {
        pattern: "a".repeat(401),
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "The pattern is 401 characters; it can be at most 400. Use a shorter pattern, such as part of the name with '*' around it.",
    });
  });

  it("reports a lower bound, and no half-printed name, when the listing is cut short", async () => {
    // Writing 2,000 files takes seconds under a loaded suite.
    const root = await workspace(
      Array.from({ length: 2_000 }, (_, index) => `scans/page-${index}.png`),
    );

    const result = await runFindFiles(root, { pattern: "*" }, undefined, {
      rg: bundledRipgrep()!,
      run: runProcess,
      maximumOutputBytes: 16_000,
    });
    if (!result.ok) throw new Error(result.reason);
    const found = result.value as Found;

    expect(found.total).toBeUndefined();
    expect(found.atLeast).toBeGreaterThan(0);
    expect(found.atLeast).toBeLessThan(2_001);
    expect(found.note).toMatch(
      /^The search was cut short, so only \d+ of at least \d+ matches are shown\. Narrow the pattern, or search a folder inside this one\.$/,
    );
    for (const path of paths(found))
      expect(path).toMatch(/^scans(\/page-\d+\.png)?$/);
  }, 30_000);

  it("leaves out what .gitignore lists and hidden files, unless asked to include them", async () => {
    const root = await workspace([
      ".gitignore",
      "draft.pdf",
      "exports/old.pdf",
      ".cache/thumb.pdf",
    ]);
    await writeFile(join(root, ".gitignore"), "exports/\n");

    expect(paths(await find(root, { pattern: "*.pdf" }))).toEqual([
      "draft.pdf",
    ]);
    expect(
      paths(await find(root, { pattern: "*.pdf", includeIgnored: true })),
    ).toEqual([".cache/thumb.pdf", "draft.pdf", "exports/old.pdf"]);
  });

  it("follows the workspace's .gitignore in a folder below it", async () => {
    const root = await workspace([
      "src/a.txt",
      "src/gen/b.txt",
      "src/c.log",
      "src/lib/d.txt",
      "other.txt",
    ]);
    await writeFile(join(root, ".gitignore"), "src/gen/\n*.log\n");

    expect(paths(await find(root, { pattern: "*.txt", path: "src" }))).toEqual([
      "src/a.txt",
      "src/lib/d.txt",
    ]);
    expect(
      paths(
        await find(root, { pattern: "*", path: "src", includeIgnored: true }),
      ),
    ).toEqual(
      expect.arrayContaining(["src/c.log", "src/gen/b.txt", "src/gen"]),
    );
  });

  it("leaves a folder of build output out, whatever its letter case, unless asked or named", async () => {
    const root = await workspace([
      "Invoices/out/march.pdf",
      "Build/plan.pdf",
      "dist/map.pdf",
      "notes.pdf",
      ".git/info.pdf",
    ]);

    expect(paths(await find(root, { pattern: "*.pdf" }))).toEqual([
      "notes.pdf",
    ]);
    expect(
      paths(await find(root, { pattern: "*.pdf", includeIgnored: true })),
    ).toEqual([
      "Build/plan.pdf",
      "dist/map.pdf",
      "Invoices/out/march.pdf",
      "notes.pdf",
    ]);
    expect(
      paths(await find(root, { pattern: "*.pdf", path: "Invoices/out" })),
    ).toEqual(["Invoices/out/march.pdf"]);
  });

  it("answers a pattern of many wildcards at once, however long the names", async () => {
    const name = `${"a".repeat(120)}.txt`;
    const root = await workspace([name, "Notes/#1.md"]);

    const started = performance.now();
    const none = await find(root, { pattern: `${"*?".repeat(20)}#` });
    const some = await find(root, { pattern: `${"*?".repeat(20)}*` });
    const elapsed = performance.now() - started;

    expect(paths(none)).toEqual([]);
    expect(paths(some)).toEqual([name]);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("ignores letter case one character at a time, as Windows names do", async () => {
    const root = await workspace(["İ.txt", "ΟΔΟΣ.txt", "Straße.md"]);

    expect(paths(await find(root, { pattern: "?.txt" }))).toEqual(["İ.txt"]);
    expect(paths(await find(root, { pattern: "οδος.txt" }))).toEqual([
      "ΟΔΟΣ.txt",
    ]);
    expect(paths(await find(root, { pattern: "STRAßE.md" }))).toEqual([
      "Straße.md",
    ]);
  });

  it("keeps a find in a hidden folder to what the workspace's .gitignore lets through", async () => {
    const root = await workspace([".github/workflows/x.yml", ".github/y.log"]);
    await writeFile(join(root, ".gitignore"), "*.log\n");

    expect(
      paths(await find(root, { pattern: "*.*", path: ".github" })),
    ).toEqual([".github/workflows/x.yml"]);
  });

  it("matches braces, '?', '*' and '**' as the description says", async () => {
    const root = await workspace([
      "Invoices/2026/march.pdf",
      "Invoices/april.PDF",
      "Invoices/2026/q1/notes.docx",
      "budget-v2.xlsx",
      "budget.xlsx",
      "Archive/budget-old.xlsx",
    ]);

    expect(paths(await find(root, { pattern: "Invoices/**/*.pdf" }))).toEqual([
      "Invoices/2026/march.pdf",
      "Invoices/april.PDF",
    ]);
    expect(paths(await find(root, { pattern: "Invoices/*.pdf" }))).toEqual([
      "Invoices/april.PDF",
    ]);
    expect(
      paths(await find(root, { pattern: "Invoices/2026?march.pdf" })),
    ).toEqual([]);
    expect(paths(await find(root, { pattern: "**/q?/*.{docx,xlsx}" }))).toEqual(
      ["Invoices/2026/q1/notes.docx"],
    );
    expect(
      paths(await find(root, { pattern: "budget-*.{xlsx,docx}" })),
    ).toEqual(["Archive/budget-old.xlsx", "budget-v2.xlsx"]);
    expect(paths(await find(root, { pattern: "Invoices/**pdf" }))).toEqual([
      "Invoices/2026/march.pdf",
      "Invoices/april.PDF",
    ]);
  });

  it("matches one character of a set in brackets, as search_files does for names", async () => {
    const root = await workspace([
      "report1.txt",
      "report2.TXT",
      "reportA.txt",
      "report[x].txt",
      "Reports/b.md",
    ]);

    expect(paths(await find(root, { pattern: "report[0-9].txt" }))).toEqual([
      "report1.txt",
      "report2.TXT",
    ]);
    expect(paths(await find(root, { pattern: "report[!0-9].txt" }))).toEqual([
      "reportA.txt",
    ]);
    expect(paths(await find(root, { pattern: "report[a].txt" }))).toEqual([
      "reportA.txt",
    ]);
    // A bracket nothing closes is itself.
    expect(paths(await find(root, { pattern: "report[x" }))).toEqual([]);
    expect(paths(await find(root, { pattern: "report[x*" }))).toEqual([
      "report[x].txt",
    ]);
    // A set never matches a folder's slash.
    expect(paths(await find(root, { pattern: "Reports[/]b.md" }))).toEqual([]);
  });

  it("does not follow a link out of the workspace", async () => {
    const outside = await workspace(["secret.pdf"]);
    const root = await workspace(["inside.pdf"]);
    try {
      await symlink(outside, join(root, "elsewhere"), "junction");
    } catch {
      return; // This machine does not allow creating links.
    }

    expect(paths(await find(root, { pattern: "*.pdf" }))).toEqual([
      "inside.pdf",
    ]);
  });

  it("asks the model for the folder to search when it is given a file, before anyone is asked", async () => {
    const root = await workspace(["Invoices/a.pdf"]);
    const tools = new WorkspaceTools(root);
    const call = { pattern: "*.pdf", path: "Invoices/a.pdf" };
    const refused = {
      ok: false,
      correctable: true,
      reason:
        "Invoices/a.pdf is a file, not a folder. Search the folder it is in.",
    };

    expect(await tools.inspect("find_files", call)).toEqual(refused);
    expect(await tools.execute("find_files", call)).toEqual(refused);
  });

  it("asks for a usable pattern and keeps the search inside the workspace", async () => {
    const root = await workspace([]);
    const tools = new WorkspaceTools(root);

    expect(await tools.inspect("find_files", { pattern: "" })).toMatchObject({
      ok: false,
      correctable: true,
    });
    expect(
      await tools.inspect("find_files", { pattern: "../*.pdf" }),
    ).toMatchObject({ ok: false, correctable: true });
    expect(
      await tools.inspect("find_files", { pattern: "*.pdf", path: ".." }),
    ).toEqual({
      ok: false,
      reason: "The search must stay inside the current workspace.",
    });
    expect(
      await tools.inspect("find_files", { pattern: "*.pdf" }),
    ).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ reads: "workspace", changes: "none" }),
    });
  });

  it("is offered only with a workspace", () => {
    expect(new WorkspaceTools().list().map((tool) => tool.name)).not.toContain(
      "find_files",
    );
  });
});
