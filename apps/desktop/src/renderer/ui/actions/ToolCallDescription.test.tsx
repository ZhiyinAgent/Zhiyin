/**
 * A tool's schema says what its inputs are for, and whoever runs the tool wrote
 * those words. Showing them helps; showing them as though this app had checked
 * them does not, because a server is free to describe anything as anything.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolInvocation } from "@zhiyin/contract";
import { ToolCallView } from "./ToolCallView.js";

const call: ToolInvocation = {
  name: "create_issue",
  via: "https://tracker.example.test/mcp",
  arguments: [
    {
      name: "project_id",
      value: "a9f",
      described: "Which project the issue is filed against.",
    },
    {
      name: "body",
      value: "Steps to reproduce.",
      described: "The issue description.",
    },
  ],
};

describe("ToolCallView with described inputs", () => {
  it("shows what the input is for beside its value", () => {
    render(<ToolCallView invocation={call} />);

    expect(
      screen.getByText("Which project the issue is filed against."),
    ).toBeTruthy();
    expect(screen.getByText("a9f")).toBeTruthy();
  });

  it("attributes the description to the connection rather than to Zhiyin", () => {
    render(<ToolCallView invocation={call} />);

    expect(
      screen.getByText("Input descriptions come from the connected tool."),
    ).toBeVisible();
    expect(screen.queryByText("What the tool says this is")).toBeNull();
    const description = screen.getByText(
      "Which project the issue is filed against.",
    );
    expect(description.closest("[data-claim]")).not.toBeNull();
  });

  it("leaves an undescribed input alone rather than filling the gap", () => {
    render(<ToolCallView invocation={call} />);

    expect(screen.getByText("Steps to reproduce.")).toBeTruthy();
    expect(screen.getAllByText(/filed against/)).toHaveLength(1);
  });
});
