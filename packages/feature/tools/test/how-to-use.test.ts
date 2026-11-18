/**
 * How to use a tool is said in the tool's own description, which reaches the
 * model only with the tool, rather than in the prompt every request carries.
 */

import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

const tools = new WorkspaceTools(process.cwd(), { shell: "bash" });

const described = (name: string) =>
  tools.list().find((tool) => tool.name === name)?.description ?? "";

describe("what each tool's description says of using it", () => {
  it("has the searches point to each other and away from a shell's own search", () => {
    for (const name of ["search_files", "find_files"])
      expect(described(name)).toContain(
        "Prefer these two to grep, find, dir or findstr in a shell: they need no approval and their answers are bounded.",
      );
    expect(described("search_files")).toContain(
      "To find files by name or type, use find_files.",
    );
    expect(described("find_files")).toContain(
      "To find text inside files, use search_files.",
    );
  });

  it("has read_file read a file once it is located", () => {
    expect(described("read_file")).toMatch(
      /^Read one text file, once you have located the one you need\./,
    );
  });

  it("has bash say it is Git Bash on Windows, and that an exit code proves no effect", () => {
    expect(described("bash")).toContain(
      "This computer runs Windows, and the shell is Git Bash: do not assume Linux utilities are installed. A command's exit code does not prove it had the intended effect: check the effect itself, such as that a service stopped, and do not hide a failure behind a fallback that always succeeds.",
    );
  });

  it("has read_document say what the space beside the conversation shows and how to cite a page", () => {
    expect(described("read_document")).toContain(
      "The space beside the conversation shows one thing at a time: the browser or a document. A document you write is shown there too. When you cite a page of a workspace document, write the citation as a Markdown link to the document's workspace path ending in #page=N, like [page 24](reports/q3.pdf#page=24), or to a picture's path with no page, and write a space in the path as %20; the person opens it beside the conversation by clicking it.",
    );
  });

  it.each([
    "render_diagram",
    "render_bar_chart",
    "render_line_chart",
    "render_scatter_plot",
    "render_histogram",
    "render_box_plot",
  ])(
    "has %s say what it draws is in the conversation, never inside a file",
    (name) => {
      expect(described(name)).toContain(
        "What it draws is shown in the conversation and is not embedded in any other file: never write a heading or a sentence in a file that refers to it as though it were inside that file.",
      );
    },
  );

  it("has each chart, and no diagram, say a chart asked for is drawn with its render tool", () => {
    const sentence =
      "When a person asks for a chart, use the render tool of its kind.";
    for (const name of [
      "render_bar_chart",
      "render_line_chart",
      "render_scatter_plot",
      "render_histogram",
      "render_box_plot",
    ])
      expect(described(name)).toContain(sentence);
    expect(described("render_diagram")).not.toContain(sentence);
  });

  it("has render_quiz say it is for a quiz asked for, shown in the conversation and in no file", () => {
    expect(described("render_quiz")).toContain(
      "use it when a person asks for a quiz. It is shown in the conversation and is not embedded in any file",
    );
  });

  it("has read_file alone declare the part of reading text, and write_file alone that of writing a file, for the agent loop to find them by", () => {
    const playing = (role: string) =>
      tools
        .list()
        .filter((tool) => tool.role === role)
        .map((tool) => tool.name);
    expect(playing("reads-text")).toEqual(["read_file"]);
    expect(playing("writes-file")).toEqual(["write_file"]);
  });

  it("has ask_user say when to ask before broad research or a document", () => {
    expect(described("ask_user")).toContain(
      "For broad research or document requests, ask before substantial work when the intended audience, scope, source preference, or deliverable format could materially change the result. Ask only about details that are not already clear from the conversation.",
    );
  });
});
