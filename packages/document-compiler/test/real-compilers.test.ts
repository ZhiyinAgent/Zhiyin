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

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { documentCompiler } from "../src/index.js";

const typst = process.env["ZHIYIN_TYPST"];
const tectonic = process.env["ZHIYIN_TECTONIC"];
async function workspace(): Promise<string> {
  return folders.make("zhiyin-compiler-live-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

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
    expect(failed.content[0]?.text).toContain("broken.typ:1:1");
    expect(failed.content[0]?.text).not.toContain(root);
  }, 300_000);

  it("reads nothing from outside the workspace, however the document names it", async () => {
    const parent = await workspace();
    const root = join(parent, "work");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(parent, "secret.txt"), "the secret outside");
    const absolute = join(parent, "secret.txt").replaceAll("\\", "/");
    const compiler = compilerIn(root);

    for (const named of ["../../secret.txt", absolute]) {
      await writeFile(join(root, "docs", "leak.typ"), `#read("${named}")\n`);
      const result = (await compiler.callTool("compile_document", {
        path: "docs/leak.typ",
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError, named).toBe(true);
      expect(JSON.stringify(result)).not.toContain("the secret outside");
      expect(await readdir(join(root, "docs"))).toEqual(["leak.typ"]);
    }
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

  it("runs no program a document asks to run", async () => {
    const root = await workspace();
    const marker = join(dirname(root), `${randomUUID()}.txt`);
    // Tectonic splits the command at spaces and honours no quotes, so the
    // program is written without a space inside its argument.
    const program = `node -e require('fs').writeFileSync('${marker.replaceAll("\\", "/")}','ran')`;
    await writeFile(
      join(root, "escape.tex"),
      [
        "\\documentclass{article}",
        `\\immediate\\write18{${program}}`,
        "\\begin{document}",
        "Hello.",
        "\\end{document}",
        "",
      ].join("\n"),
    );

    await compilerIn(root).callTool("compile_document", {
      path: "escape.tex",
    });

    expect(existsSync(marker)).toBe(false);
  }, 600_000);
});
