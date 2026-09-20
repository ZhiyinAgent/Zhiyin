/**
 * The connector against the real engines.
 *
 * Every other test here replaces the invocation, which proves the arguments
 * and the reporting but not that the engines accept them. This runs them. It
 * is skipped unless the binaries are named in the environment, because the
 * gate installs neither:
 *
 *   $env:ZHIYIN_TYPST = "…\typst.exe"; $env:ZHIYIN_TECTONIC = "…\tectonic.exe"
 *   npx vitest run packages/document-compiler
 *
 * Tectonic downloads its TeX bundle on first use, so the first run is slow.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { documentCompiler } from "../src/index.js";

const typst = process.env["ZHIYIN_TYPST"];
const tectonic = process.env["ZHIYIN_TECTONIC"];
const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-compiler-live-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function compilerIn(root: string) {
  return documentCompiler({
    workspaceRoot: () => root,
    programs: async () => ({
      ...(typst ? { typst } : {}),
      ...(tectonic ? { tectonic } : {}),
    }),
    timeoutMs: 300_000,
  });
}

describe.runIf(typst)("the real Typst engine", () => {
  it("writes a readable PDF, and reports a real error without one", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n\nA paragraph.\n");
    const compiler = compilerIn(root);

    const compiled = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(compiled).not.toHaveProperty("isError");
    expect(
      (await readFile(join(root, "paper.pdf"))).subarray(0, 5).toString(),
    ).toBe("%PDF-");

    await writeFile(join(root, "broken.typ"), "#nonexistent()\n");
    const failed = (await compiler.callTool("compile_document", {
      path: "broken.typ",
    })) as { isError?: boolean; content: { text: string }[] };
    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.text).toContain("unknown variable");
  }, 300_000);
});

describe.runIf(tectonic)("the real LaTeX engine", () => {
  it("writes a readable PDF from a LaTeX source", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "paper.tex"),
      "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    );

    const compiled = await compilerIn(root).callTool("compile_document", {
      path: "paper.tex",
    });

    expect(compiled).not.toHaveProperty("isError");
    expect(
      (await readFile(join(root, "paper.pdf"))).subarray(0, 5).toString(),
    ).toBe("%PDF-");
  }, 600_000);
});
