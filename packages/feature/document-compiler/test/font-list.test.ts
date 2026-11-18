/**
 * Which fonts a document can name. Typst sets a document in the fonts
 * installed on the computer and its own, and only it can say which those are,
 * so the model asks it rather than the command line.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CompilerPrograms, type RunProgram } from "../src/index.js";
import { documentCompiler } from "./reading-here.js";

/** As `typst fonts` prints them: one family a line. */
const families = [
  "Arial",
  "Brush Script MT",
  "Century Schoolbook",
  "DejaVu Sans Mono",
  "Libertinus Serif",
  "Microsoft YaHei",
  "New Computer Modern",
  "Noto Serif SC",
  "SimSun",
].join("\n");

function compilerWith(
  programs: CompilerPrograms,
  printed: { exitCode: number | null; stdout?: string; stderr?: string } = {
    exitCode: 0,
    stdout: `${families}\n`,
  },
) {
  const runs: { executable: string; arguments: readonly string[] }[] = [];
  const run: RunProgram = async ({ executable, arguments: args }) => {
    runs.push({ executable, arguments: args });
    return { stdout: "", stderr: "", ...printed };
  };
  return {
    runs,
    compiler: documentCompiler({
      workspaceRoot: () => undefined,
      programs: async () => programs,
      tectonicCache: join(tmpdir(), "zhiyin-compiler-test-tectonic"),
      run,
      confine: async () => undefined,
    }),
  };
}

const text = (result: unknown) =>
  (result as { content: { text: string }[] }).content
    .map((part) => part.text)
    .join("\n");

describe("listing the fonts a document can use", () => {
  it("is offered beside compiling while Typst is installed, and not without it", async () => {
    const names = async (programs: CompilerPrograms) =>
      (await compilerWith(programs).compiler.listTools()).map(
        (tool) => tool.name,
      );

    expect(await names({ typst: "C:/typst.exe" })).toEqual([
      "compile_document",
      "list_fonts",
    ]);
    expect(await names({ tectonic: "C:/tectonic.exe" })).toEqual([
      "compile_document",
    ]);
  });

  it("reads nothing of the person's, changes nothing and sends nothing, with no folder chosen", async () => {
    const { compiler } = compilerWith({ typst: "C:/typst.exe" });

    expect(await compiler.inspect("list_fonts", {})).toMatchObject({
      ok: true,
      effects: {
        reads: "none",
        changes: "none",
        sends: "none",
        actsAsPerson: "none",
        runs: "none",
        lasting: false,
        brings: "none",
      },
    });
  });

  it("names every family Typst can use, from Typst itself", async () => {
    const { compiler, runs } = compilerWith({ typst: "C:/typst.exe" });

    const answer = text(await compiler.callTool("list_fonts", {}));

    expect(runs).toEqual([
      { executable: "C:/typst.exe", arguments: ["fonts"] },
    ]);
    for (const family of families.split("\n")) expect(answer).toContain(family);
  });

  it("keeps only the families that have any of the words given among the words of their name, whatever their case", async () => {
    const { compiler } = compilerWith({ typst: "C:/typst.exe" });

    const answer = text(
      await compiler.callTool("list_fonts", {
        matching: ["yahei", "SC", "simsun", "serif sc"],
      }),
    );

    expect(answer).toContain("Microsoft YaHei");
    expect(answer).toContain("Noto Serif SC");
    expect(answer).toContain("SimSun");
    // "SC" is a word of Noto Serif SC's name, and only part of a word here.
    expect(answer).not.toContain("Brush Script MT");
    expect(answer).not.toContain("Century Schoolbook");
    expect(answer).not.toContain("Arial");
    expect(answer).not.toContain("Libertinus Serif");
  });

  it("says when no family holds the words given, and how many there are", async () => {
    const { compiler } = compilerWith({ typst: "C:/typst.exe" });

    const result = await compiler.callTool("list_fonts", {
      matching: ["Garamond"],
    });

    expect(result).not.toHaveProperty("isError", true);
    expect(text(result)).toMatch(/none of the 9 .*Garamond/i);
  });

  it("says Typst is not installed, and that Typst could not list them, as errors", async () => {
    expect(
      await compilerWith({ tectonic: "C:/tectonic.exe" }).compiler.callTool(
        "list_fonts",
        {},
      ),
    ).toMatchObject({ isError: true });
    const failing = compilerWith(
      { typst: "C:/typst.exe" },
      { exitCode: 1, stderr: "error: something broke" },
    );
    const result = await failing.compiler.callTool("list_fonts", {});
    expect(result).toMatchObject({ isError: true });
    expect(text(result)).toContain("something broke");
  });
});
