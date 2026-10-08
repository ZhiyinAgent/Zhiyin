import { describe, expect, it } from "vitest";
import {
  describeInvocation,
  readableToolName,
} from "../src/tools/invocation.js";

describe("describing a tool call", () => {
  it("lays out each argument separately instead of one encoded string", () => {
    expect(
      describeInvocation(
        "tavily_search",
        '{"max_results":8,"query":"ZEvent 2026","search_depth":"advanced"}',
      ),
    ).toEqual({
      name: "tavily_search",
      arguments: [
        { name: "max_results", value: "8" },
        { name: "query", value: "ZEvent 2026" },
        { name: "search_depth", value: "advanced" },
      ],
    });
  });

  it("shows a remote tool under its own name, not its routing prefix", () => {
    expect(readableToolName("mcp__tavily__tavily_search")).toBe(
      "tavily_search",
    );
    expect(readableToolName("bash")).toBe("bash");
    // A tool that merely looks routed keeps whatever name it has.
    expect(readableToolName("mcp__only_one_part")).toBe("mcp__only_one_part");
  });

  it("says where a call is going when it leaves this machine", () => {
    expect(
      describeInvocation(
        "mcp__tavily__tavily_search",
        '{"query":"x"}',
        "https://mcp.tavily.com/mcp/",
      ),
    ).toMatchObject({
      name: "tavily_search",
      via: "https://mcp.tavily.com/mcp/",
    });
  });

  it("keeps both ends of a long value and says how much went missing", () => {
    const long = `START${"x".repeat(5000)}END`;
    const [argument] = describeInvocation(
      "write_file",
      JSON.stringify({ text: long }),
    ).arguments;

    expect(argument?.name).toBe("text");
    expect(argument?.value.startsWith("START")).toBe(true);
    expect(argument?.value.endsWith("END")).toBe(true);
    expect(argument?.omitted).toBe(long.length - 2000);
    expect(argument?.value).toHaveLength(2000);
  });

  it("leaves a short value whole, with nothing said about truncation", () => {
    const [argument] = describeInvocation(
      "read_file",
      '{"path":"notes.md"}',
    ).arguments;

    expect(argument).toEqual({ name: "path", value: "notes.md" });
  });

  it("renders a structured argument as readable JSON rather than one line", () => {
    const [argument] = describeInvocation(
      "render_bar_chart",
      JSON.stringify({ series: [{ label: "a", value: 1 }] }),
    ).arguments;

    expect(argument?.value).toBe(
      '[\n  {\n    "label": "a",\n    "value": 1\n  }\n]',
    );
  });

  it("shows what was actually sent when the input will not parse", () => {
    const invocation = describeInvocation("bash", '{"command": "echo');

    expect(invocation.arguments).toEqual([
      { name: "Unreadable input", value: '{"command": "echo' },
    ]);
  });

  it("has nothing to lay out for a call that takes no arguments", () => {
    expect(describeInvocation("browser_snapshot", "{}").arguments).toEqual([]);
    expect(describeInvocation("browser_snapshot", "").arguments).toEqual([]);
  });
});
