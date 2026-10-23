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

import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { homedir, tmpdir } from "node:os";
import { documentCompiler } from "../src/index.js";

const typst = process.env["ZHIYIN_TYPST"];
const tectonic = process.env["ZHIYIN_TECTONIC"];
async function workspace(): Promise<string> {
  return folders.make("zhiyin-compiler-live-");
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** Kept between runs, so its bundle is fetched once. */
const tectonicCache = join(tmpdir(), "zhiyin-latex-packages");

/**
 * A file's or folder's integrity label, as Windows writes it in its security
 * descriptor, or "" for none: `icacls /save` writes the descriptor whatever
 * language Windows speaks.
 */
async function labelOf(path: string): Promise<string> {
  const saved = join(await folders.make("zhiyin-label-"), "saved.txt");
  execFileSync(
    join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "icacls.exe"),
    [path, "/save", saved],
    { stdio: "ignore" },
  );
  const descriptor = (await readFile(saved)).toString("utf16le");
  return /S:(\([^)]*\))+/.exec(descriptor)?.[0] ?? "";
}

/** The app containers Windows keeps for LaTeX compiles, by profile folder. */
async function latexContainers(): Promise<string[]> {
  const packages = join(
    process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
    "Packages",
  );
  return (await readdir(packages)).filter((name) =>
    name.toLowerCase().startsWith("zhiyin.latex."),
  );
}

function compilerIn(root: string) {
  return documentCompiler({
    workspaceRoot: () => root,
    // As the app runs them: contained, Tectonic confined with a package
    // cache of its own.
    containment: { open: openProcessContainer },
    tectonicCache,
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

  it("keeps and shows nothing from a document that reads through a link leading outside", async () => {
    const parent = await workspace();
    const root = join(parent, "work");
    await mkdir(join(parent, "outside"));
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(parent, "outside", "secret.txt"),
      "the secret outside",
    );
    await writeFile(join(root, "kept.txt"), "inside");
    await symlink(join(parent, "outside"), join(root, "linked"), "junction");
    const compiler = compilerIn(root);

    // Read into the PDF, and quoted in the compiler's own error.
    for (const document of [
      `#read("/linked/secret.txt")\n`,
      `#panic(read("../linked/secret.txt"))\n`,
    ]) {
      await writeFile(join(root, "docs", "leak.typ"), document);
      const result = (await compiler.callTool("compile_document", {
        path: "docs/leak.typ",
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError, document).toBe(true);
      expect(result.content[0]?.text).toContain("linked");
      expect(JSON.stringify(result)).not.toContain("the secret outside");
      expect(await readdir(join(root, "docs"))).toEqual(["leak.typ"]);
    }

    // A file the link does not carry out is read as before.
    await writeFile(join(root, "docs", "leak.typ"), `#read("/kept.txt")\n`);
    expect(
      await compiler.callTool("compile_document", { path: "docs/leak.typ" }),
    ).not.toHaveProperty("isError");
  }, 300_000);

  // Typst names what it read on a share in Windows' long form for one,
  // `\\?\UNC\server\share\…`. The machine's own drive is reached as a share
  // where its administrative shares are on.
  it.runIf(existsSync("\\\\localhost\\C$\\"))(
    "keeps nothing from a document on a network share that reads through a link leading outside",
    async () => {
      const parent = await workspace();
      const local = join(parent, "work");
      await mkdir(join(parent, "outside"));
      await mkdir(local);
      await writeFile(
        join(parent, "outside", "secret.txt"),
        "the secret outside",
      );
      await symlink(join(parent, "outside"), join(local, "linked"), "junction");
      const root = `\\\\localhost\\${local[0]}$${local.slice(2)}`;
      await writeFile(join(local, "leak.typ"), `#read("/linked/secret.txt")\n`);

      const result = (await compilerIn(root).callTool("compile_document", {
        path: "leak.typ",
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("linked");
      expect(JSON.stringify(result)).not.toContain("the secret outside");
      expect(await readdir(local)).toEqual(["leak.typ", "linked"]);
    },
    300_000,
  );
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
    // The PDF kept is a copy Zhiyin made, labelled as any file of the
    // person's, not as one a program in a container wrote.
    await writeFile(join(root, "the person's.txt"), "");
    expect(await labelOf(join(root, "paper.pdf"))).toBe(
      await labelOf(join(root, "the person's.txt")),
    );
  }, 600_000);

  it("leaves no app container behind once a compile is done", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "paper.tex"),
      "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    );
    const before = await latexContainers();

    const compiled = await compilerIn(root).callTool("compile_document", {
      path: "paper.tex",
    });

    expect(compiled).not.toHaveProperty("isError");
    expect(await latexContainers()).toEqual(before);
  }, 600_000);

  it("shows where a document names a file that is not there, though LaTeX stopped before listing what it read", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "paper.tex"),
      "\\documentclass{article}\n\\begin{document}\n\\input{missing-chapter}\n\\end{document}\n",
    );

    const result = (await compilerIn(root).callTool("compile_document", {
      path: "paper.tex",
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("paper.tex:3");
    expect(result.content[0]?.text).toContain("missing-chapter");
    expect(await readdir(root)).toEqual(["paper.tex"]);
  }, 600_000);

  it("shows the errors of LaTeX that stopped before listing what it read, but never a file of the person's outside the workspace", async () => {
    const parent = await workspace();
    const root = join(parent, "work");
    await mkdir(root);
    await writeFile(join(parent, "secret.tex"), "thesecretoutside\n");
    const secret = join(parent, "secret.tex").replaceAll("\\", "/");
    // Quoted in an error if it can be read, then a file that is not there,
    // which stops LaTeX before it lists what it read.
    await writeFile(
      join(root, "paper.tex"),
      [
        "\\documentclass{article}",
        "\\begin{document}",
        `\\newread\\in\\openin\\in=${secret}`,
        "\\ifeof\\in\\else\\read\\in to\\got\\errmessage{\\got}\\fi",
        "\\input{missing-chapter}",
        "\\end{document}",
        "",
      ].join("\n"),
    );

    const result = (await compilerIn(root).callTool("compile_document", {
      path: "paper.tex",
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("paper.tex:5");
    expect(result.content[0]?.text).toContain("missing-chapter");
    expect(JSON.stringify(result)).not.toContain("thesecretoutside");
    expect(await readdir(root)).toEqual(["paper.tex"]);
  }, 600_000);

  it("leaves the workspace's integrity label as it was", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "paper.tex"),
      "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    );
    const before = await labelOf(root);

    const compiled = await compilerIn(root).callTool("compile_document", {
      path: "paper.tex",
    });

    expect(compiled).not.toHaveProperty("isError");
    expect(await labelOf(root)).toBe(before);
  }, 600_000);

  it("lets no document change the packages a later document reads", async () => {
    const root = await workspace();
    const compiler = compilerIn(root);
    await writeFile(
      join(root, "first.tex"),
      "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n",
    );
    await compiler.callTool("compile_document", { path: "first.tex" });
    const data = join(tectonicCache, "packages", "bundles", "data");
    const bundle = (await readdir(data, { withFileTypes: true })).find(
      (entry) => entry.isDirectory(),
    )!.name;
    const kept = join(data, bundle, "article.cls");
    const before = await readFile(kept);
    // A package planted before it is fetched, then a kept class written
    // over, in the cache beside the folder Tectonic writes in.
    await writeFile(
      join(root, "plants.tex"),
      [
        "\\documentclass{article}",
        "\\newwrite\\w",
        `\\immediate\\openout\\w=cache/bundles/data/${bundle}/xcolor.sty`,
        "\\immediate\\write\\w{\\string\\ProvidesPackage{xcolor}}",
        "\\immediate\\closeout\\w",
        `\\immediate\\openout\\w=cache/bundles/data/${bundle}/article.cls`,
        "\\immediate\\write\\w{\\string\\errmessage{planted}}",
        "\\immediate\\closeout\\w",
        "\\begin{document}",
        "Hello.",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    await compiler.callTool("compile_document", { path: "plants.tex" });
    await writeFile(
      join(root, "later.tex"),
      "\\documentclass{article}\n\\usepackage{xcolor}\n\\begin{document}\n\\textcolor{red}{Hello.}\n\\end{document}\n",
    );

    const later = await compiler.callTool("compile_document", {
      path: "later.tex",
    });

    expect(later).not.toHaveProperty("isError");
    expect(await readFile(kept)).toEqual(before);
  }, 900_000);

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

  it("writes no file a document asks to write, in the workspace or outside it", async () => {
    const parent = await workspace();
    const root = join(parent, "work");
    await mkdir(root);
    const named = join(parent, `${randomUUID()}.bat`);
    await writeFile(
      join(root, "writes.tex"),
      [
        "\\documentclass{article}",
        "\\newwrite\\far",
        `\\immediate\\openout\\far=${named.replaceAll("\\", "/")}`,
        "\\immediate\\write\\far{echo planted}",
        "\\immediate\\closeout\\far",
        "\\newwrite\\up",
        "\\immediate\\openout\\up=../climbed.txt",
        "\\immediate\\write\\up{climbed}",
        "\\immediate\\closeout\\up",
        "\\newwrite\\here",
        `\\immediate\\openout\\here=${join(root, "planted.tex").replaceAll("\\", "/")}`,
        "\\immediate\\write\\here{planted}",
        "\\immediate\\closeout\\here",
        "\\begin{document}",
        "Hello.",
        "\\end{document}",
        "",
      ].join("\n"),
    );

    await compilerIn(root).callTool("compile_document", { path: "writes.tex" });

    expect(existsSync(named)).toBe(false);
    expect(existsSync(join(parent, "climbed.txt"))).toBe(false);
    expect(await readdir(parent)).toEqual(["work"]);
    expect(await readdir(root)).toEqual(["writes.tex"]);
  }, 600_000);

  it("keeps and shows nothing from a document that reads a file outside the workspace", async () => {
    const parent = await workspace();
    const root = join(parent, "work");
    await mkdir(join(parent, "outside"), { recursive: true });
    await mkdir(root);
    await writeFile(
      join(parent, "outside", "secret.tex"),
      "thesecretoutside\n",
    );
    await symlink(join(parent, "outside"), join(root, "linked"), "junction");
    const absolute = join(parent, "outside", "secret.tex").replaceAll(
      "\\",
      "/",
    );
    const compiler = compilerIn(root);

    // Typeset into the PDF, by a whole path and through a link, and quoted
    // in an error of the document's own.
    for (const body of [
      `\\input{${absolute}}`,
      "\\input{linked/secret.tex}",
      `\\newread\\in\\openin\\in=${absolute}\\read\\in to\\got\\errmessage{\\got}`,
      // Windows opens a name without its trailing dots and spaces.
      "\\newread\\in\\openin\\in=../outside/secret.tex.\\read\\in to\\got\\errmessage{\\got}",
      "\\newread\\in\\openin\\in=linked./secret.tex\\read\\in to\\got\\errmessage{\\got}",
    ]) {
      await writeFile(
        join(root, "reads.tex"),
        `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
      );
      const result = (await compiler.callTool("compile_document", {
        path: "reads.tex",
      })) as { isError?: boolean; content: { text: string }[] };

      expect(result.isError, body).toBe(true);
      expect(JSON.stringify(result), body).not.toContain("thesecretoutside");
      expect(await readdir(root)).toEqual(["linked", "reads.tex"]);
    }
  }, 600_000);

  it("reports a document's own LaTeX error, and keeps no PDF", async () => {
    const root = await workspace();
    await writeFile(
      join(root, "broken.tex"),
      "\\documentclass{article}\n\\begin{document}\nHello \\undefinedthing\n\\end{document}\n",
    );

    const result = (await compilerIn(root).callTool("compile_document", {
      path: "broken.tex",
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("broken.tex:3");
    expect(result.content[0]?.text).toContain("Undefined control sequence");
    expect(await readdir(root)).toEqual(["broken.tex"]);
  }, 600_000);
});
