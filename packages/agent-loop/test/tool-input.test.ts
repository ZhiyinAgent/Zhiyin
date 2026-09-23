import { describe, expect, it } from "vitest";
import { readToolInput } from "../src/tool-input.js";

describe("reading a tool call's input", () => {
  it("reads a well-formed object as it is, with nothing corrected", () => {
    expect(readToolInput('{"path":"notes.md"}')).toEqual({
      ok: true,
      arguments: { path: "notes.md" },
      corrections: [],
    });
  });

  it("reads empty input as no arguments", () => {
    expect(readToolInput("  ")).toMatchObject({
      ok: true,
      arguments: {},
      corrections: ["empty input"],
    });
  });

  it("unwraps an object sent as a JSON string", () => {
    expect(readToolInput(JSON.stringify('{"path":"notes.md"}'))).toMatchObject({
      ok: true,
      arguments: { path: "notes.md" },
      corrections: ["an object sent as a string"],
    });
  });

  it("escapes a raw newline or tab inside a text value, keeping the text", () => {
    expect(readToolInput('{"text":"one\ntwo\tthree"}')).toMatchObject({
      ok: true,
      arguments: { text: "one\ntwo\tthree" },
      corrections: ["unescaped control characters"],
    });
  });

  it("removes a trailing comma, and leaves a comma inside text alone", () => {
    expect(readToolInput('{"text":"a,}","items":[1,2,],}')).toMatchObject({
      ok: true,
      arguments: { text: "a,}", items: [1, 2] },
      corrections: ["a trailing comma"],
    });
  });

  it("removes a code fence around the whole object", () => {
    expect(readToolInput('```json\n{"path":"notes.md"}\n```')).toMatchObject({
      ok: true,
      arguments: { path: "notes.md" },
      corrections: ["a code fence"],
    });
  });

  it("does not guess where an unescaped quote ends its text", () => {
    const read = readToolInput('{"path":"a.md","text":"say "hi" now"}');

    expect(read.ok).toBe(false);
    expect(read).toMatchObject({ cutOff: false });
    expect(!read.ok && read.reason).toMatch(
      /^The input was not valid JSON: .+/,
    );
  });

  it("recognises input that ends before its object closes", () => {
    expect(readToolInput('{"path":"a.md","text":"half a fi')).toMatchObject({
      ok: false,
      cutOff: true,
    });
    expect(readToolInput('{"path":"a.md","items":[1,2')).toMatchObject({
      ok: false,
      cutOff: true,
    });
  });

  it("refuses a value that is not an object", () => {
    expect(readToolInput("[1,2]")).toMatchObject({ ok: false, cutOff: false });
    expect(readToolInput('"just text"')).toMatchObject({
      ok: false,
      cutOff: false,
    });
  });
});
