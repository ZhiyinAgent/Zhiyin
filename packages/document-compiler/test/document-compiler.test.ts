import {
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
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

/** Where Tectonic keeps its packages in these tests; it is never filled. */
const tectonicCache = join(tmpdir(), "zhiyin-compiler-test-tectonic");

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
    /** Each compiler lists the files it read, whether it succeeds or fails. */
    readonly listsReads?: boolean;
    /** Files the document reads besides itself, as the compiler names them. */
    readonly reads?: readonly string[];
    /** Written where Tectonic's list goes instead, as a document can. */
    readonly listed?: () => string;
    /** What the run was asked to run at and with, besides its command. */
    readonly asked?: (run: Parameters<RunProgram>[0]) => void;
  } = {},
) {
  const calls: Call[] = [];
  const run: RunProgram = async (given) => {
    const { executable, arguments: args, cwd } = given;
    calls.push({ executable, arguments: args, cwd });
    // As Tectonic fetches one package into the cache it is given, and builds
    // its format from a document Zhiyin wrote.
    const cache = given.environment?.["TECTONIC_CACHE_DIR"];
    if (cache && args[0] === "-X") {
      await mkdir(join(cache, "bundles", "data", "bundle"), {
        recursive: true,
      });
      await writeFile(
        join(cache, "bundles", "data", "bundle", args.at(-1)!),
        `fetched ${args.at(-1)!}`,
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (cache && basename(args.at(-1)!) === "format.tex") {
      await mkdir(join(cache, "formats"), { recursive: true });
      await writeFile(join(cache, "formats", "latex.fmt"), "format");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    options.asked?.(given);
    const result = options.result ?? { exitCode: 0 };
    // As Tectonic lists them: a make rule for the PDF, one file a line.
    const rules = args.indexOf("--makefile-rules");
    if (rules >= 0 && options.listsReads !== false)
      await writeFile(
        args[rules + 1]!,
        options.listed?.() ??
          `${[`${pdfNamedBy(args)} : ${args.at(-1)!}`, ...(options.reads ?? [])].join(" \\\n  ")}\n`,
        "utf8",
      );
    const list = args.indexOf("--deps");
    if (list >= 0 && options.listsReads !== false)
      await writeFile(
        args[list + 1]!,
        JSON.stringify({
          inputs: [...(options.reads ?? []), args.at(-2)!].map(
            (path) => `\\\\?\\${path}`,
          ),
          outputs: null,
        }),
        "utf8",
      );
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
    /** The fake compiler itself, for a test that wraps it. */
    run,
    compiler: documentCompiler({
      workspaceRoot: () => root,
      programs: async () => options.programs ?? installed,
      tectonicCache,
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
          "--deps",
          expect.any(String),
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

  it("runs LaTeX at low integrity, with its packages and temporary files in a folder of its own", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    const asked: Parameters<RunProgram>[0][] = [];
    const { compiler } = compilerWriting(root, {
      writes: pdf,
      asked: (run) => asked.push(run),
    });

    await compiler.callTool("compile_document", { path: "paper.tex" });

    const own = dirname(asked[0]!.environment!["TEMP"]!);
    expect(asked[0]?.integrity).toBe("low");
    expect(dirname(own)).toBe(join(tectonicCache, "runs"));
    expect(asked[0]?.environment?.["TECTONIC_CACHE_DIR"]).toBe(
      join(own, "cache"),
    );
    expect(existsSync(own)).toBe(false);
  });

  it("keeps in the shared package cache only what Zhiyin fetched itself, never what a compile wrote", async () => {
    const root = await workspace();
    const cache = await folders.make("zhiyin-latex-cache-");
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    const run = compilerWriting(root, {
      writes: pdf,
    });
    // A compile that fetched a package, and planted another beside it.
    const compiler = documentCompiler({
      workspaceRoot: () => root,
      programs: async () => installed,
      tectonicCache: cache,
      run: async (given) => {
        const own = given.environment?.["TECTONIC_CACHE_DIR"];
        if (own && given.integrity === "low") {
          const kept = join(own, "bundles", "data", "bundle");
          await mkdir(kept, { recursive: true });
          await writeFile(join(kept, "xcolor.sty"), "planted");
          await writeFile(join(kept, "--version"), "planted");
        }
        return run.run(given);
      },
    });

    await compiler.callTool("compile_document", { path: "paper.tex" });

    const shared = join(cache, "packages", "bundles", "data", "bundle");
    expect(await readdir(shared)).toEqual(["xcolor.sty"]);
    expect(await readFile(join(shared, "xcolor.sty"), "utf8")).toBe(
      "fetched xcolor.sty",
    );
    expect(await readdir(join(cache, "packages", "formats"))).toEqual([
      "latex.fmt",
    ]);
  });

  it("gives each LaTeX compile the packages kept before it", async () => {
    const root = await workspace();
    const cache = await folders.make("zhiyin-latex-cache-");
    const shared = join(cache, "packages", "bundles", "data", "bundle");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "article.cls"), "kept");
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    let seen: string | undefined;
    const run = compilerWriting(root, { writes: pdf });
    const compiler = documentCompiler({
      workspaceRoot: () => root,
      programs: async () => installed,
      tectonicCache: cache,
      run: async (given) => {
        const own = given.environment?.["TECTONIC_CACHE_DIR"];
        if (own && given.integrity === "low")
          seen = await readFile(
            join(own, "bundles", "data", "bundle", "article.cls"),
            "utf8",
          );
        return run.run(given);
      },
    });

    await compiler.callTool("compile_document", { path: "paper.tex" });

    expect(seen).toBe("kept");
  });

  it("does not run LaTeX without containment, where it cannot be lowered", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    // The real run path, with a program that would answer if it ran.
    const compiler = documentCompiler({
      workspaceRoot: () => root,
      programs: async () => ({ tectonic: process.execPath }),
      tectonicCache,
    });

    const result = await compiler.callTool("compile_document", {
      path: "paper.tex",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: "Zhiyin could not start the compiler inside the limits it runs within, so it did not run.",
        },
      ],
    });
    expect(await readdir(root)).toEqual(["paper.tex"]);
  });

  it("reports the errors LaTeX went on past, and keeps no PDF", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    const { compiler } = compilerWriting(root, {
      writes: pdf,
      result: {
        exitCode: 0,
        stderr:
          "error: paper.tex:3: Undefined control sequence\nwarning: errors were issued by the TeX engine, but were ignored",
      },
    });

    const result = await compiler.callTool("compile_document", {
      path: "paper.tex",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringContaining(
            "error: paper.tex:3: Undefined control sequence",
          ),
        },
      ],
    });
    expect(await readdir(root)).toEqual(["paper.tex"]);
  });

  it.each([
    ["by a whole path", (secret: string) => secret.replaceAll("\\", "/")],
    // Tectonic lists a relative name behind the folder it writes in.
    [
      "by a relative path",
      (_secret: string, outdir: string) => `${outdir}\\../secret.tex`,
    ],
    // Windows opens a name without its trailing dots and spaces.
    [
      "by a relative path ending in a dot",
      (_secret: string, outdir: string) => `${outdir}\\../secret.tex.`,
    ],
    [
      "by a relative path ending in a space",
      (_secret: string, outdir: string) => `${outdir}\\../secret.tex `,
    ],
    [
      "by a whole path ending in a dot",
      (secret: string) => `${secret.replaceAll("\\", "/")}.`,
    ],
  ])(
    "keeps and shows nothing from LaTeX that read a file outside the workspace %s",
    async (_how, named) => {
      const parent = await workspace();
      const root = join(parent, "work");
      await mkdir(root);
      await writeFile(join(parent, "secret.tex"), "the secret\n");
      await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
      const reads: string[] = [];
      const { compiler } = compilerWriting(root, {
        writes: pdf,
        result: { exitCode: 0, stdout: "the secret" },
        asked: ({ arguments: args }) =>
          reads.push(
            named(
              join(parent, "secret.tex"),
              args[args.indexOf("--outdir") + 1]!,
            ),
          ),
        reads,
      });

      const result = await compiler.callTool("compile_document", {
        path: "paper.tex",
      });

      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("outside the workspace folder");
      expect(JSON.stringify(result)).not.toContain("the secret");
      expect(await readdir(root)).toEqual(["paper.tex"]);
    },
  );

  it.each([
    [
      "by a relative path",
      (_root: string, outdir: string) => `${outdir}\\linked/secret.tex`,
    ],
    [
      "by a whole path",
      (root: string) =>
        join(root, "linked", "secret.tex").replaceAll("\\", "/"),
    ],
    [
      "by a relative path whose link ends in a dot",
      (_root: string, outdir: string) => `${outdir}\\linked./secret.tex`,
    ],
    [
      "by a whole path whose link ends in a dot",
      (root: string) =>
        join(root, "linked.", "secret.tex").replaceAll("\\", "/"),
    ],
  ])(
    "keeps and shows nothing from LaTeX that read a file a link carries outside, named %s",
    async (_how, named) => {
      const parent = await workspace();
      const root = join(parent, "work");
      await mkdir(join(parent, "outside"), { recursive: true });
      await mkdir(root);
      await writeFile(join(parent, "outside", "secret.tex"), "the secret\n");
      await symlink(join(parent, "outside"), join(root, "linked"), "junction");
      await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
      const reads: string[] = [];
      const { compiler } = compilerWriting(root, {
        writes: pdf,
        result: { exitCode: 0, stdout: "the secret" },
        asked: ({ arguments: args }) =>
          reads.push(named(root, args[args.indexOf("--outdir") + 1]!)),
        reads,
      });

      const result = await compiler.callTool("compile_document", {
        path: "paper.tex",
      });

      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            text: `The document reads ${join("linked", "secret.tex")}, which a link carries outside the workspace folder, so nothing the compiler made or said is kept or shown.`,
          },
        ],
      });
      expect(await readdir(root)).toEqual(["linked", "paper.tex"]);
    },
  );

  it.each([
    // Beside the source, in a folder of the workspace, it climbs out.
    ["beside the source", "../../secret.tex"],
    // From the workspace, where Tectonic also looks, it climbs out.
    ["in the workspace", "../secret.tex"],
  ])(
    "names the file outside the workspace a LaTeX document read by a relative name, looked for %s",
    async (_where, written) => {
      const parent = await workspace();
      const root = join(parent, "work");
      await mkdir(join(root, "chapters"), { recursive: true });
      await writeFile(join(parent, "secret.tex"), "the secret\n");
      await writeFile(
        join(root, "chapters", "paper.tex"),
        "\\documentclass{article}",
      );
      const reads: string[] = [];
      const { compiler } = compilerWriting(root, {
        writes: pdf,
        result: { exitCode: 0, stdout: "the secret" },
        asked: ({ arguments: args }) =>
          reads.push(`${args[args.indexOf("--outdir") + 1]!}\\${written}`),
        reads,
      });

      const result = await compiler.callTool("compile_document", {
        path: "chapters/paper.tex",
      });

      expect(JSON.stringify(result)).toContain(
        `reads ${join(parent, "secret.tex").replaceAll("\\", "\\\\")}, outside the workspace folder`,
      );
    },
  );

  it("keeps a LaTeX PDF whose reads all stay in the workspace", async () => {
    const root = await workspace();
    await mkdir(join(root, "chapters"));
    await writeFile(join(root, "chapters", "one.tex"), "One.\n");
    await writeFile(join(root, "chapters", "two.tex"), "Two.\n");
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    const reads = [join(root, "chapters", "one.tex").replaceAll("\\", "/")];
    const { compiler } = compilerWriting(root, {
      writes: pdf,
      asked: ({ arguments: args }) =>
        reads.push(`${args[args.indexOf("--outdir") + 1]!}\\chapters/two.tex`),
      reads,
    });

    const result = await compiler.callTool("compile_document", {
      path: "paper.tex",
    });

    expect(result).not.toHaveProperty("isError");
    expect(await readFile(join(root, "paper.pdf"), "utf8")).toBe(pdf);
    expect(await readdir(root)).toEqual(["chapters", "paper.pdf", "paper.tex"]);
  });

  /** Where a LaTeX run writes, as its command names it. */
  type LatexRun = {
    readonly root: string;
    readonly outdir: string;
    readonly pdf: string;
    readonly source: string;
  };
  it.each([
    [
      "names by its whole path a file in the workspace that cannot be found",
      (run: LatexRun) =>
        `${run.pdf} : ${run.source} \\\n  ${join(run.root, "gone.tex")}\n`,
    ],
    [
      "names relatively a file that cannot be found",
      (run: LatexRun) =>
        `${run.pdf} : ${run.source} \\\n  ${run.outdir}\\gone.tex\n`,
    ],
    [
      "names a folder by dots and spaces alone",
      (run: LatexRun) =>
        `${run.pdf} : ${run.source} \\\n  ${run.outdir}\\notes/.. ./secret.tex\n`,
    ],
    // A document can write where the list goes, but cannot know its head.
    [
      "starts as the list of another compilation",
      (run: LatexRun) =>
        `${run.pdf.replace(/compile-[^\\]+/, (folder) => "x".repeat(folder.length))} : ${run.source}\n`,
    ],
  ])(
    "keeps and shows nothing from LaTeX whose list of reads %s",
    async (_how, listed) => {
      const root = await workspace();
      await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
      await mkdir(join(root, "notes"));
      await writeFile(join(root, "notes", "secret.tex"), "notes\n");
      let run: LatexRun | undefined;
      const { compiler } = compilerWriting(root, {
        writes: pdf,
        result: { exitCode: 0, stdout: "quoting the secret" },
        listed: () => listed(run!),
        asked: ({ arguments: args }) => {
          const outdir = args[args.indexOf("--outdir") + 1]!;
          run = {
            root,
            outdir,
            pdf: join(outdir, "paper.pdf"),
            source: args.at(-1)!,
          };
        },
      });

      const result = await compiler.callTool("compile_document", {
        path: "paper.tex",
      });

      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).not.toContain("the secret");
      expect(await readdir(root)).toEqual(["notes", "paper.tex"]);
    },
  );

  it("keeps and shows nothing from LaTeX that did not list what it read", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.tex"), "\\documentclass{article}");
    const { compiler } = compilerWriting(root, {
      writes: pdf,
      writesOnFailure: true,
      listsReads: false,
      result: {
        exitCode: 1,
        stderr: "error: something bad happened, quoting the secret",
      },
    });

    const result = await compiler.callTool("compile_document", {
      path: "paper.tex",
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain("the secret");
    expect(JSON.stringify(result)).toContain("names a file that is not there");
    expect(await readdir(root)).toEqual(["paper.tex"]);
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
    await writeFile(join(outside, "paper.tex"), "\\documentclass{article}");
    await symlink(outside, join(root, "linked"), "junction");
    const { compiler, calls } = compilerWriting(root);

    for (const args of [
      { path: "linked/paper.typ" },
      // The output alone is inside: the source is what the link carries out.
      { path: "linked/paper.typ", output: "paper.pdf" },
      { path: "linked/paper.tex", output: "paper.pdf" },
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

  it("keeps and shows nothing from a Typst document that read through a link leading out of the folder", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    await symlink(outside, join(root, "linked"), "junction");
    const said = "error: panicked with: secret";
    const refused =
      "The document reads linked\\secret.txt, which a link carries outside the workspace folder, so nothing the compiler made or said is kept or shown.";

    for (const result of [{ exitCode: 0 }, { exitCode: 1, stderr: said }]) {
      const { compiler } = compilerWriting(root, {
        result,
        writes: pdf,
        reads: [join(root, "linked", "secret.txt")],
      });
      expect(
        await compiler.callTool("compile_document", { path: "paper.typ" }),
      ).toEqual({ isError: true, content: [{ type: "text", text: refused }] });
      expect(await readdir(root)).toEqual(["linked", "paper.typ"]);
    }

    // Typst's own packages, outside the folder by name, are read as before.
    const { compiler } = compilerWriting(root, {
      writes: pdf,
      reads: [join(outside, "secret.txt")],
    });
    expect(
      await compiler.callTool("compile_document", { path: "paper.typ" }),
    ).not.toHaveProperty("isError");
  });

  it("keeps and shows nothing from a Typst compilation that did not list what it read", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");

    const succeeded = compilerWriting(root, { writes: pdf, listsReads: false });
    expect(
      await succeeded.compiler.callTool("compile_document", {
        path: "paper.typ",
      }),
    ).toMatchObject({
      isError: true,
      content: [
        {
          text: "The compiler did not say which files it read, so paper.pdf is not kept.",
        },
      ],
    });
    expect(await readdir(root)).toEqual(["paper.typ"]);

    const failed = compilerWriting(root, {
      result: { exitCode: 1, stderr: "error: panicked with: secret" },
      listsReads: false,
    });
    const text = JSON.stringify(
      await failed.compiler.callTool("compile_document", { path: "paper.typ" }),
    );
    expect(text).toContain("could not tell which files it read");
    expect(text).not.toContain("secret");
  });

  it("writes a LaTeX document reached through a link to the output it was asked for", async () => {
    const root = await workspace();
    await writeFile(join(root, "notes.tex"), "\\documentclass{article}\n");
    await symlink(join(root, "notes.tex"), join(root, "paper.tex"), "file");
    const { compiler } = compilerWriting(root, { writes: pdf });

    const result = await compiler.callTool("compile_document", {
      path: "paper.tex",
    });

    expect(result).toMatchObject({
      content: [{ text: expect.stringContaining("Wrote paper.pdf") }],
    });
    expect(await readFile(join(root, "paper.pdf"), "utf8")).toBe(pdf);
  });

  it("refuses an output that a link leads to a file that is not a PDF", async () => {
    const root = await workspace();
    await writeFile(join(root, "paper.typ"), "= Title\n", "utf8");
    await writeFile(join(root, "letter.docx"), "Dear", "utf8");
    await symlink(join(root, "letter.docx"), join(root, "out.pdf"), "file");
    const { compiler, calls } = compilerWriting(root, { writes: pdf });

    const result = await compiler.callTool("compile_document", {
      path: "paper.typ",
      output: "out.pdf",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "The compiled document is a PDF." }],
    });
    expect(calls).toEqual([]);
    expect(await readFile(join(root, "letter.docx"), "utf8")).toBe("Dear");
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
      tectonicCache,
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
      tectonicCache,
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
