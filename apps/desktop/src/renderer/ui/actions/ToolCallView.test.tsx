import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCallView } from "./ToolCallView.js";

describe("ToolCallView", () => {
  it("shows each input separately, so a person can read the one that matters", () => {
    render(
      <ToolCallView
        invocation={{
          name: "tavily_search",
          arguments: [
            { name: "max_results", value: "8" },
            { name: "query", value: "ZEvent 2026 montant récolté" },
            { name: "search_depth", value: "advanced" },
          ],
        }}
      />,
    );

    expect(screen.getByText("tavily_search")).toBeVisible();
    // The query is readable as itself, not buried in an encoded call.
    expect(screen.getByText("query")).toBeVisible();
    expect(screen.getByText("ZEvent 2026 montant récolté")).toBeVisible();
    expect(screen.getByText("max_results")).toBeVisible();
  });

  it("writes out characters that draw nothing or reverse the text, in names, text and structures alike", () => {
    render(
      <ToolCallView
        invocation={{
          name: "send\u200Bmail",
          arguments: [
            { name: "to", value: "ana@example.com\u202E" },
            { name: "options", value: '{"subject":"Q3\\u2067 notes"}' },
          ],
        }}
      />,
    );

    expect(screen.getByText("send[U+200B]mail")).toBeVisible();
    expect(screen.getByText("ana@example.com[U+202E]")).toBeVisible();
    expect(screen.getByText('"Q3[U+2067] notes"')).toBeVisible();
  });

  it("shows every row when several share a name, as the rows the 3D tools name after objects do", () => {
    // React says when rows cannot be told apart: what it then shows is unsupported.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = (...values: string[]) => ({
      name: "blender_add_objects",
      arguments: values.map((value) => ({ name: "Unnamed", value })),
    });
    const { rerender } = render(
      <ToolCallView invocation={rows("a cube", "a sphere", "a cone")} />,
    );
    rerender(<ToolCallView invocation={rows("a torus", "a plane")} />);
    const collisions = errors.mock.calls.filter((call) =>
      String(call[0]).includes("same key"),
    );
    errors.mockRestore();

    expect(collisions).toEqual([]);
    expect(screen.getAllByText("Unnamed")).toHaveLength(2);
    expect(screen.getByText("a torus")).toBeVisible();
    expect(screen.getByText("a plane")).toBeVisible();
    expect(screen.queryByText("a cone")).toBeNull();
  });

  it("names the block it is, so it reads like the rest of the request", () => {
    render(
      <ToolCallView
        invocation={{ name: "Open page", arguments: [] }}
        label="What will run"
        hideName
      />,
    );

    const card = screen.getByRole("region", { name: "What will run" });
    expect(within(card).getByText("What will run")).toBeVisible();
  });

  it("keeps its heading, identity, and inputs inside one card", () => {
    render(
      <ToolCallView
        invocation={{
          name: "tavily_search",
          via: "https://mcp.tavily.com/mcp/",
          arguments: [{ name: "query", value: "commercial aircraft" }],
        }}
        label="What was asked for"
      />,
    );

    const card = screen.getByRole("region", { name: "What was asked for" });
    const heading = within(card).getByRole("group", { name: "Tool" });

    expect(within(heading).getByText("What was asked for")).toBeVisible();
    expect(within(heading).getByText("tavily_search")).toBeVisible();
    expect(
      within(heading).getByText("https://mcp.tavily.com/mcp/"),
    ).toBeVisible();
    expect(within(card).getByText("query")).toBeVisible();
    expect(within(card).getByText("commercial aircraft")).toBeVisible();
  });

  it("says where a call leaves for, when it leaves this machine", () => {
    render(
      <ToolCallView
        invocation={{
          name: "tavily_search",
          via: "https://mcp.tavily.com/mcp/",
          arguments: [{ name: "query", value: "x" }],
        }}
      />,
    );

    expect(screen.getByText("https://mcp.tavily.com/mcp/")).toBeVisible();
  });

  it("says exactly how much of a long value is hidden, and keeps both ends", () => {
    render(
      <ToolCallView
        invocation={{
          name: "write_file",
          arguments: [
            { name: "text", value: "STARTthe endEND", omitted: 12480 },
          ],
        }}
      />,
    );

    expect(screen.getByText(/characters hidden/)).toBeVisible();
    expect(screen.getByText(/characters hidden/).textContent).toContain("480");
    const shown = screen.getByRole("definition").textContent ?? "";
    expect(shown.startsWith("START")).toBe(true);
    expect(shown.endsWith("END")).toBe(true);
  });

  it("colours keys and values so the shape of a structure is visible", () => {
    const { container } = render(
      <ToolCallView
        invocation={{
          name: "render_bar_chart",
          arguments: [
            {
              name: "series",
              value: '[\n  {\n    "label": "a",\n    "value": 1\n  }\n]',
            },
          ],
        }}
      />,
    );

    expect(container.querySelector(".json-key")?.textContent).toBe('"label":');
    expect(container.querySelector(".json-string")?.textContent).toBe('"a"');
    expect(container.querySelector(".json-number")?.textContent).toBe("1");
  });

  it("leaves plain text alone rather than dressing it as JSON", () => {
    const { container } = render(
      <ToolCallView
        invocation={{
          name: "read_file",
          arguments: [{ name: "path", value: "notes/plan.md" }],
        }}
      />,
    );

    expect(screen.getByText("notes/plan.md")).toBeVisible();
    expect(container.querySelector(".json-string")).toBeNull();
  });

  it("says a call has no inputs rather than drawing an empty list", () => {
    render(
      <ToolCallView invocation={{ name: "browser_snapshot", arguments: [] }} />,
    );

    expect(screen.getByText("No inputs.")).toBeVisible();
  });

  it("keeps a very long input folded until it is asked for, then shows it whole", () => {
    const body = `start ${"x".repeat(30_000)} end`;
    render(
      <ToolCallView
        invocation={{
          name: "write_file",
          arguments: [{ name: "content", value: body }],
        }}
      />,
    );

    expect(screen.queryByText(body)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Show all 30.010 characters/ }),
    );
    expect(screen.getByText(body)).toBeVisible();
  });

  it("shows a very long input whole at once where it is being approved", () => {
    const body = `start ${"x".repeat(30_000)} end`;
    render(
      <ToolCallView
        whole
        invocation={{
          name: "write_file",
          arguments: [{ name: "content", value: body }],
        }}
      />,
    );

    expect(screen.getByText(body)).toBeVisible();
  });
});
