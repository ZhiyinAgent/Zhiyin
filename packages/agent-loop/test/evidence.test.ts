import { describe, expect, it } from "vitest";
import { evidenceText } from "../src/evidence.js";

describe("execution evidence", () => {
  it("excludes credential fields and bearer values while preserving ordinary evidence", () => {
    const result = evidenceText({
      answer: "42",
      nested: { apiKey: "secret-value" },
      text: "Bearer actual-token",
    });
    expect(result).toContain("42");
    expect(result).not.toContain("secret-value");
    expect(result).not.toContain("actual-token");
  });

  it("redacts a credential buried inside an encoded payload", () => {
    // The payload arrives as a string of JSON. Decoding it before redacting is
    // what lets the key inside it be found at all.
    const result = evidenceText({
      content: [{ type: "text", text: JSON.stringify({ apiKey: "sk-live" }) }],
    });

    expect(result).not.toContain("sk-live");
    expect(result).toContain("[credential omitted]");
  });

  it("lays the record out, so a long answer is still readable", () => {
    const result = evidenceText({ ok: true, value: { count: 2 } });

    expect(result).toBe(
      '{\n  "ok": true,\n  "value": {\n    "count": 2\n  }\n}',
    );
  });

  it("decodes a payload that arrived as a string of JSON in a field", () => {
    const result = evidenceText({
      content: [{ type: "text", text: JSON.stringify({ query: "odyssey" }) }],
    });

    expect(result).toContain('"query": "odyssey"');
    expect(result).not.toContain('\\"query\\"');
  });

  it("bounds retained evidence and says when detail is omitted", () => {
    const result = evidenceText("x".repeat(40_000));

    expect(result.length).toBeLessThanOrEqual(24_000);
    expect(result).toContain("evidence shortened");
  });

  it("shortens an answer that is already laid out, keeping both ends legible", () => {
    const many = Array.from({ length: 4000 }, (_, index) => ({
      title: `Result ${index}`,
    }));

    const result = evidenceText({ results: many });

    expect(result).toContain("evidence shortened");
    // Cut from an indented document, so both halves still read as one.
    expect(result.startsWith('{\n  "results": [\n')).toBe(true);
    expect(result).toContain('"title": "Result 0"');
    expect(result.trimEnd().endsWith("}")).toBe(true);
  });

  it("leaves text that was never a structure alone", () => {
    expect(evidenceText("Command exited with code 1")).toBe(
      "Command exited with code 1",
    );
  });
});
