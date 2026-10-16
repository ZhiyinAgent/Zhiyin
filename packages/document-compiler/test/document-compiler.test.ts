import {
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  documentCompiler,
  type CompilerPrograms,
  type RunProgram,
} from "../src/index.js";

async function workspace(): Promise<string> {
  return realpath(await folders.make("zhiyin-compiler-"));
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** What a compiler writes, nine bytes of it. */
const pdf = "%PDF-1.7\n";

const installed: CompilerPrograms = {
  typst: "C:/programs/typst.exe",
  tectonic: "C:/programs/tectonic.exe",
};

type Call = { executable: string; arguments: readonly string[]; cwd: string };

/**
 * Where a compiler writes its PDF: Typst at its last argument, Tectonic in
 * its output folder, named after the source.
 */
function pdfNamedBy(args: readonly string[]): string {
  const outdir = args.indexOf("--outdir");
  if (outdir < 0) return args.at(-1)!;
  const source = basename(args.at(-1)!);
  return join(
    args[outdir + 1]!,
    `${source.slice(0, source.lastIndexOf("."))}.pdf`,
  );
}

function compilerWriting(
  root: string,
  options: {
    readonly programs?: CompilerPrograms;
    readonly result?: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
      ending?: "timeout" | "stopped" | "outputLimit";
    };
    /**
     * The PDF the run writes where its command says, the way a compiler
     * does: these bytes when it succeeds, and also when it fails partway
     * with `writesOnFailure`.
     */
    readonly writes?: string;
    readonly writesOnFailure?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const run: RunProgram = async ({ executable, arguments: args, cwd }) => {
    calls.push({ executable, arguments: args, cwd });
    const result = options.result ?? { exitCode: 0 };
    if (
      options.writes !== undefined &&
      (result.exitCode === 0 || options.writesOnFailure)
    )
      await writeFile(pdfNamedBy(args), options.writes, "utf8");
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.ending ? { ending: result.ending } : {}),
    };
  };
  return {
    calls,
    compiler: documentCompiler({
      workspaceRoot: () => root,
      programs: async () => options.programs ?? installed,
      run,
    }),
  };
}

describe("compiling a document", () => {
  it("compiles Typst inside the workspace and reports the file it wrote", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const { compiler, calls } = compilerWriting(root, { writes: pdf });

    const result = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(calls).toEqual([
      {
        executable: "C:/programs/typst.exe",
        arguments: [
          "compile",
          "--root",
          root,
          join(root, "paper.typ"),
          expect.any(String),
        ],
        cwd: root,
      },
    ]);
    // Written beside it under the same name, and moved over it once whole.
    const into = calls[0]!.arguments.at(-1)!;
    expect(basename(into)).toBe("paper.pdf");
    expect(dirname(dirname(into))).toBe(root);
    expect(await readFile(join(root, "paper.pdf"), "utf8")).toBe(pdf);
    expect(await readdir(root)).toEqual(["paper.pdf", "paper.typ"]);
    expect(result).toMatchObject({
      content: [
        { type: "text", text: expect.stringContaining("Wrote paper.pdf") },
      ],
    });
    expect(result).not.toHaveProperty("isError");
  });

  it("runs LaTeX untrusted, so a document cannot run programs of its own", async () => {
    const root = await workspace();
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(
      join(root, "paper.tex"),
      "\\documentclass{article}",
      "utf8",
    );
    const { compiler, calls } = compilerWriting(root, {
      writes: pdf,
    });

    await compiler.callTool("compile_document", {
      path: "paper.tex",
      output: "out/paper.pdf",
    });

    expect(calls[0]?.executable).toBe("C:/programs/tectonic.exe");
    expect(calls[0]?.arguments).toContain("--untrusted");
    expect(await readFile(join(root, "out", "paper.pdf"), "utf8")).toBe(pdf);
    expect(await readdir(join(root, "out"))).toEqual(["paper.pdf"]);
  });

  it("keeps the PDF from before as it was when a compilation fails partway", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    await writeFile(join(root, "paper.pdf"), "%PDF-1.7 earlier\n", "utf8");
    const { compiler } = compilerWriting(root, {
      writes: "%PDF-1.7 half",
      writesOnFailure: true,
      result: { exitCode: 1, stderr: "error: unknown variable" },
    });

    const failed = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(failed).toMatchObject({ isError: true });
    expect(await readFile(join(root, "paper.pdf"), "utf8")).toBe(
      "%PDF-1.7 earlier\n",
    );
    expect(await readdir(root)).toEqual(["paper.pdf", "paper.typ"]);
  });

  it("says so when the PDF in the workspace cannot be replaced, and leaves nothing beside it", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    // Nothing can be moved over it, as over a PDF another program holds.
    await mkdir(join(root, "paper.pdf"));
    await writeFile(join(root, "paper.pdf", "inside.txt"), "kept\n", "utf8");
    const { compiler } = compilerWriting(root, { writes: pdf });

    const result = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "could not be replaced. Another program, such as a PDF viewer, may have it open",
          ),
        },
      ],
    });
    expect(await readdir(root)).toEqual(["paper.pdf", "paper.typ"]);
  });

  it("clears what a compilation that never finished left beside the PDF, an hour on", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const left = join(root, ".zhiyin-compiling-old");
    const recent = join(root, ".zhiyin-compiling-recent");
    await mkdir(left);
    await mkdir(recent);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(left, twoHoursAgo, twoHoursAgo);
    const { compiler } = compilerWriting(root, { writes: pdf });

    await compiler.callTool("compile_document", { path: "paper.typ" });

    // One a compilation still running may be using is left alone.
    expect(await readdir(root)).toEqual([
      ".zhiyin-compiling-recent",
      "paper.pdf",
      "paper.typ",
    ]);
  });

  it("reports the compiler's own errors rather than a bare exit code", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "#nope()\n", "utf8");
    const { compiler } = compilerWriting(root, {
      result: {
        exitCode: 1,
        stderr:
          "error: unknown variable: nope\n  ┌─ paper.typ:1:1\nsome trace\nwarning: ignored something",
      },
    });

    const result = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(result).toMatchObject({ isError: true });
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain("error: unknown variable: nope");
    expect(text).toContain("warning: ignored something");
    expect(text).not.toContain("some trace");
  });

  it("says where each error is: the file, line and column, and the line itself", async () => {
    const root = await workspace();
    await writeFile(join(root, "guide.typ"), "Rooms from *US$78*\n", "utf8");
    // Typst's own layout: the location and the source follow the error line.
    const { compiler } = compilerWriting(root, {
      result: {
        exitCode: 1,
        stderr: [
          "error: unclosed delimiter",
          `  ┌─ \\\\?\\${join(root, "guide.typ")}:1:15`,
          "  │",
          "1 │ Rooms from *US$78*",
          "  │               ^",
          "  │",
          "  = hint: a dollar sign starts an equation",
          "",
        ].join("\n"),
      },
    });

    const result = await compiler.callTool("compile_document", {
      path: "guide.typ",
    });

    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain("error: unclosed delimiter");
    expect(text).toContain("guide.typ:1:15");
    expect(text).toContain("1 │ Rooms from *US$78*");
    expect(text).toContain("= hint: a dollar sign starts an equation");
    // The folder's full path says nothing the model can use.
    expect(text).not.toContain(root);
  });

  it("says so when the compiler claims success but wrote nothing", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const { compiler } = compilerWriting(root);

    expect(
      await compiler.callTool("compile_document", { path: "paper.typ" }),
    ).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("wrote no paper.pdf") }],
    });
  });

  it("does not take a PDF left from before for one it wrote", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    await writeFile(join(root, "paper.pdf"), "%PDF-1.7\n", "utf8");
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(join(root, "paper.pdf"), hourAgo, hourAgo);
    const { compiler } = compilerWriting(root);

    expect(
      await compiler.callTool("compile_document", { path: "paper.typ" }),
    ).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("wrote no paper.pdf") }],
    });
  });

  it.each([
    [
      "timeout",
      "took longer than 3 minutes, the most one compilation may take",
    ],
    ["stopped", "was stopped before it finished"],
    ["outputLimit", "printed more than Zhiyin keeps"],
  ] as const)(
    "says why a compilation that ended early ended (%s)",
    async (ending, said) => {
      const root = await workspace();
      await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
      const { compiler } = compilerWriting(root, {
        result: { exitCode: null, ending },
      });

      expect(
        await compiler.callTool("compile_document", { path: "paper.typ" }),
      ).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining(said) }],
      });
    },
  );

  it("declares the PDF it wrote as produced: created the first time, updated after", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const { compiler } = compilerWriting(root, { writes: pdf });

    const first = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });
    const second = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(
      compiler.produced("compile_document", { path: "paper.typ" }, first),
    ).toEqual([{ path: "paper.pdf", change: "created", bytes: 9 }]);
    expect(
      compiler.produced("compile_document", { path: "paper.typ" }, second),
    ).toEqual([{ path: "paper.pdf", change: "updated", bytes: 9 }]);
  });

  it("declares nothing produced when the compile failed", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const { compiler } = compilerWriting(root, {
      result: { exitCode: 1, stderr: "error: unknown variable" },
    });

    const failed = await compiler.callTool("compile_document", {
      path: "paper.typ",
    });

    expect(
      compiler.produced("compile_document", { path: "paper.typ" }, failed),
    ).toEqual([]);
  });

  it("refuses a document or an output outside the workspace folder", async () => {
    const root = await workspace();
    const { compiler, calls } = compilerWriting(root);

    for (const args of [
      { path: "../secrets.typ" },
      { path: "paper.typ", output: "../elsewhere.pdf" },
      { path: "C:/Windows/System32/config.typ" },
    ])
      expect(await compiler.callTool("compile_document", args)).toMatchObject({
        isError: true,
        content: [
          { text: "Documents are compiled inside the workspace folder." },
        ],
      });
    expect(calls).toEqual([]);
  });

  it("refuses a document or an output that a link inside the folder leads out of it", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(join(outside, "paper.typ"), "= Title\n", "utf8");
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    await symlink(outside, join(root, "linked"), "junction");
    const { compiler, calls } = compilerWriting(root);

    for (const args of [
      { path: "linked/paper.typ" },
      { path: "paper.typ", output: "linked/paper.pdf" },
    ]) {
      expect(await compiler.inspect("compile_document", args)).toEqual({
        ok: false,
        reason: "Documents are compiled inside the workspace folder.",
      });
      expect(await compiler.callTool("compile_document", args)).toMatchObject({
        isError: true,
        content: [
          { text: "Documents are compiled inside the workspace folder." },
        ],
      });
    }
    expect(calls).toEqual([]);
  });

  it("refuses a file neither engine compiles, and an output that is not a PDF", async () => {
    const root = await workspace();
    const { compiler } = compilerWriting(root);

    expect(
      await compiler.callTool("compile_document", { path: "notes.md" }),
    ).toMatchObject({
      content: [
        {
          text: "Only Typst (.typ) and LaTeX (.tex) documents can be compiled.",
        },
      ],
    });
    expect(
      await compiler.callTool("compile_document", {
        path: "paper.typ",
        output: "paper.docx",
      }),
    ).toMatchObject({ content: [{ text: "The compiled document is a PDF." }] });
  });

  /**
   * Tectonic is given a folder and names the PDF after the source, so another
   * name would leave the approved file unwritten and overwrite one nobody
   * approved.
   */
  it("refuses a LaTeX output named differently from its source, before anything runs", async () => {
    const root = await workspace();
    const { compiler, calls } = compilerWriting(root);
    const reason =
      "LaTeX writes the PDF under its source's name: give the output as paper.pdf, in any folder of the workspace.";

    expect(
      await compiler.inspect("compile_document", {
        path: "paper.tex",
        output: "out/summary.pdf",
      }),
    ).toMatchObject({ ok: false, reason });
    expect(
      await compiler.callTool("compile_document", {
        path: "paper.tex",
        output: "out/summary.pdf",
      }),
    ).toMatchObject({ isError: true, content: [{ text: reason }] });
    expect(calls).toEqual([]);
    // Its own name, in another folder, is what Tectonic can write.
    expect(
      await compiler.inspect("compile_document", {
        path: "paper.tex",
        output: "out/Paper.pdf",
      }),
    ).toMatchObject({ ok: true });
  });

  it("offers no tool at all until an engine is installed", async () => {
    const root = await workspace();
    const { compiler } = compilerWriting(root, { programs: {} });

    await expect(compiler.listTools()).rejects.toThrow(
      /No document compiler is installed/,
    );
    expect(
      await compiler.callTool("compile_document", { path: "paper.typ" }),
    ).toMatchObject({ isError: true });
  });

  it("offers its tool again as soon as an engine is installed", async () => {
    const root = await workspace();
    let programs: CompilerPrograms = {};
    const compiler = documentCompiler({
      workspaceRoot: () => root,
      programs: async () => programs,
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });

    await expect(compiler.listTools()).rejects.toThrow();
    programs = { typst: "C:/programs/typst.exe" };

    expect((await compiler.listTools()).map((tool) => tool.name)).toEqual([
      "compile_document",
    ]);
  });

  it("refuses to compile with no folder chosen", async () => {
    const compiler = documentCompiler({
      workspaceRoot: () => undefined,
      programs: async () => installed,
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });

    expect(
      await compiler.inspect("compile_document", { path: "a.typ" }),
    ).toEqual({ ok: false, reason: "Choose a folder before compiling." });
    expect(
      await compiler.callTool("compile_document", { path: "a.typ" }),
    ).toMatchObject({ isError: true });
  });
});

describe("what a person is asked to approve", () => {
  it("names the document, the file it writes, and where each engine fetches packages", async () => {
    const root = await workspace();
    const { compiler } = compilerWriting(root);

    expect(
      await compiler.inspect("compile_document", { path: "paper.tex" }),
    ).toMatchObject({
      ok: true,
      action: "Compile a LaTeX document",
      target: "paper.tex",
      command: expect.stringContaining("→ paper.pdf"),
      destination: expect.stringContaining("TeX packages"),
    });
    expect(
      await compiler.inspect("compile_document", { path: "paper.typ" }),
    ).toMatchObject({
      ok: true,
      action: "Compile a Typst document",
      command: expect.stringContaining("→ paper.pdf"),
      destination: expect.stringContaining("packages this document imports"),
    });
  });

  it("declares the PDF it will write as a change inside the workspace, so the earlier one can be kept", async () => {
    const root = await workspace();
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(join(root, "out", "old.pdf"), "%PDF-1.7\n", "utf8");
    const { compiler } = compilerWriting(root);

    expect(
      await compiler.inspect("compile_document", { path: "paper.typ" }),
    ).toMatchObject({
      ok: true,
      access: "change",
      scope: "workspace",
      changes: [{ path: "paper.pdf", change: "created" }],
    });
    expect(
      await compiler.inspect("compile_document", {
        path: "paper.typ",
        output: "out/old.pdf",
      }),
    ).toMatchObject({
      changes: [{ path: "out/old.pdf", change: "updated" }],
    });
  });

  it("refuses an engine that is not installed before anything runs", async () => {
    const root = await workspace();
    const { compiler } = compilerWriting(root, {
      programs: { typst: "C:/programs/typst.exe" },
    });

    expect(
      await compiler.inspect("compile_document", { path: "paper.tex" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("Tectonic") });
  });
});
