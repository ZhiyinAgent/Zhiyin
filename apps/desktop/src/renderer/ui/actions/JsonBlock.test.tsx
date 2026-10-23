import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonBlock, formatJson } from "./JsonBlock.js";

describe("formatting a tool's answer", () => {
  it("indents a structure that arrived on one line", () => {
    expect(formatJson('{"ok":true,"value":{"count":2}}')).toBe(
      '{\n  "ok": true,\n  "value": {\n    "count": 2\n  }\n}',
    );
  });

  it("decodes a payload that arrived as a string of JSON inside a field", () => {
    // The shape an MCP text result actually has: the answer, escaped, inside
    // a field. Left alone it reads as \"query\":\"…\" and nobody can use it.
    const wrapped = JSON.stringify({
      ok: true,
      value: {
        content: [
          { type: "text", text: JSON.stringify({ query: "box office" }) },
        ],
      },
    });

    const formatted = formatJson(wrapped);

    expect(formatted).toContain('"query": "box office"');
    expect(formatted).not.toContain('\\"query\\"');
  });

  it("leaves a record it cannot parse exactly as it was recorded", () => {
    const shortened =
      '{"ok":true,"value":\n… evidence shortened; read the source for detail …\n"tail"}';

    expect(formatJson(shortened)).toBe(shortened);
  });

  it("leaves text that was never JSON alone", () => {
    expect(formatJson("Command exited with code 1")).toBe(
      "Command exited with code 1",
    );
  });

  it("gives each key its own line, indented by how deep it sits", () => {
    const { container } = render(
      <JsonBlock text='{"ok":true,"value":{"count":2}}' />,
    );
    const lines = [...container.querySelectorAll(".json-line")].map((line) => ({
      text: line.textContent,
      indent: (line as HTMLElement).style.paddingLeft,
    }));

    expect(lines).toEqual([
      { text: "{", indent: "" },
      { text: '"ok": true,', indent: "2ch" },
      { text: '"value": {', indent: "2ch" },
      { text: '"count": 2', indent: "4ch" },
      { text: "}", indent: "2ch" },
      { text: "}", indent: "" },
    ]);
  });

  it("colours what it drew, so the shape is visible", () => {
    const { container } = render(
      <JsonBlock text='{"ok":true,"count":2,"name":"Tavily"}' />,
    );

    expect(container.querySelector(".json-key")?.textContent).toBe('"ok":');
    expect(container.querySelector(".json-literal")?.textContent).toBe("true");
    expect(container.querySelector(".json-number")?.textContent).toBe("2");
    expect(container.querySelector(".json-string")?.textContent).toBe(
      '"Tavily"',
    );
  });

  it("shows an unparseable record without colouring it as a structure", () => {
    const { container } = render(<JsonBlock text="exit code 1" />);

    expect(screen.getByText("exit code 1")).toBeVisible();
    expect(container.querySelector(".json-number")).toBeNull();
  });
});
