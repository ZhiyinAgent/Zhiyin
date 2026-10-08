/**
 * Finding files by name: "every PDF under Invoices", "the file called
 * budget-something". The answer says how many matched, and when it could not
 * look everywhere it says how far it got instead of implying it did.
 */

import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";
import { runFindFiles } from "../src/find-files.js";
import { bundledRipgrep } from "../src/ripgrep.js";

async function workspace(files: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-find-"));
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

  it("says how many matched in all when it shows only the first of them", async () => {
    const root = await workspace(
      Array.from({ length: 230 }, (_, index) => `scans/page-${index}.png`),
    );

    const found = await find(root, { pattern: "*.png" });

    expect(found.matches).toHaveLength(200);
    expect(found.total).toBe(230);
    expect(found.atLeast).toBeUndefined();
  });

  it("reports a lower bound, and no half-printed name, when the listing is cut short", async () => {
    // Writing 2,000 files takes seconds under a loaded suite.
    const root = await workspace(
      Array.from({ length: 2_000 }, (_, index) => `scans/page-${index}.png`),
    );

    const result = await runFindFiles(root, { pattern: "*" }, undefined, {
      rg: bundledRipgrep()!,
      maximumOutputBytes: 16_000,
    });
    if (!result.ok) throw new Error(result.reason);
    const found = result.value as Found;

    expect(found.total).toBeUndefined();
    expect(found.atLeast).toBeGreaterThan(0);
    expect(found.atLeast).toBeLessThan(2_001);
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
    ).toMatchObject({ ok: true, access: "read", scope: "workspace" });
  });

  it("is offered only with a workspace", () => {
    expect(new WorkspaceTools().list().map((tool) => tool.name)).not.toContain(
      "find_files",
    );
  });
});
