import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DemoApp } from "./DemoApp.js";
import { demoScenarioFromSearch } from "./fixtures.js";

describe("DemoApp", () => {
  it("does not invent a work trace while the model is only responding", () => {
    render(<DemoApp initialScenario="working" />);

    const shelf = screen.getByRole("complementary", {
      name: "Session context",
    });

    expect(screen.queryByRole("region", { name: "Work trace" })).toBeNull();
    expect(within(shelf).queryByText("Reading docs/decisions")).toBeNull();
    expect(screen.queryByText(/live/i)).toBeNull();
  });

  it("selects only a known visual scenario from the preview URL", () => {
    expect(demoScenarioFromSearch("?scenario=done")).toBe("done");
    expect(demoScenarioFromSearch("?scenario=thinking")).toBe("thinking");
    expect(demoScenarioFromSearch("?scenario=quiz")).toBe("quiz");
    expect(demoScenarioFromSearch("?scenario=plugins")).toBe("plugins");
    expect(demoScenarioFromSearch("?scenario=unknown")).toBe("working");
  });

  it("keeps the initial working state available for visual review", () => {
    render(<DemoApp initialScenario="thinking" />);

    expect(screen.getByText("Working")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Task plan" })).toBeNull();
  });

  it("switches to a compact approval state while keeping steering available", () => {
    render(<DemoApp initialScenario="approval" />);

    expect(
      screen.getByRole("region", { name: "Permission request" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
  });

  it("offers the browser workspace in the browser demo", () => {
    render(<DemoApp initialScenario="browser" />);

    fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
    expect(screen.getByRole("tabpanel", { name: "Workspace" })).toBeVisible();
    expect(screen.getByText("Documentation preview")).toBeVisible();
  });

  it("opens usage, then the plugin directory, from the sidebar", () => {
    render(<DemoApp initialScenario="working" />);

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Usage" }));
    expect(
      screen.getByRole("region", { name: "Usage overview" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByRole("region", { name: "Plugins" })).toBeVisible();
  });
});
