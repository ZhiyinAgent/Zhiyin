import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  documentCompiler,
  type CompilerPrograms,
  type RunProgram,
} from "../src/index.js";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-compiler-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const installed: CompilerPrograms = {
  typst: "C:/programs/typst.exe",
  tectonic: "C:/programs/tectonic.exe",
};

type Call = { executable: string; arguments: readonly string[]; cwd: string };

function compilerWriting(
  root: string,
  options: {
    readonly programs?: CompilerPrograms;
    readonly result?: {
      exitCode: number | null;
      stdout?: string;
      stderr?: string;
    };
    /** Written when the run "succeeds", the way a compiler writes its PDF. */
    readonly writes?: string;
  } = {},
) {
  const calls: Call[] = [];
  const run: RunProgram = async ({ executable, arguments: args, cwd }) => {
    calls.push({ executable, arguments: args, cwd });
    const result = options.result ?? { exitCode: 0 };
    if (result.exitCode === 0 && options.writes)
      await writeFile(join(root, options.writes), "%PDF-1.7\n", "utf8");
    return {
      exitCode: result.exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
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
    const { compiler, calls } = compilerWriting(root, { writes: "paper.pdf" });

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
          join(root, "paper.pdf"),
        ],
        cwd: root,
      },
    ]);
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
      writes: join("out", "paper.pdf"),
    });

    await compiler.callTool("compile_document", {
      path: "paper.tex",
      output: "out/paper.pdf",
    });

    expect(calls[0]?.executable).toBe("C:/programs/tectonic.exe");
    expect(calls[0]?.arguments).toContain("--untrusted");
    expect(calls[0]?.arguments).toContain(join(root, "out"));
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

  it("declares the PDF it wrote as produced: created the first time, updated after", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    const { compiler } = compilerWriting(root, { writes: "paper.pdf" });

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
  it("names the document, the file it writes, and where LaTeX fetches packages", async () => {
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
