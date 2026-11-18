import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionHeader } from "./SessionHeader.js";

describe("SessionHeader", () => {
  it("keeps transient task controls out of the header", () => {
    render(
      <SessionHeader
        workspace="Zhiyin Desktop"
        title="Prepare v0.1 release notes"
      />,
    );

    expect(screen.getByText("Prepare v0.1 release notes")).toBeInTheDocument();
    expect(screen.queryByText(/live/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Task options" })).toBeNull();
  });
});
