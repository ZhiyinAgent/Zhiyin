import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DemoApp } from "./DemoApp.js";
import { demoScenarioFromSearch } from "./fixtures.js";

describe("DemoApp", () => {
  it("does not invent a work trace while the model is only responding", () => {
    render(<DemoApp initialScenario="working" />);

    expect(screen.queryByRole("region", { name: "Work trace" })).toBeNull();
    expect(screen.queryByText(/live/i)).toBeNull();
  });

  it("selects only a known visual scenario from the preview URL", () => {
    expect(demoScenarioFromSearch("?scenario=done")).toBe("done");
    expect(demoScenarioFromSearch("?scenario=thinking")).toBe("thinking");
    expect(demoScenarioFromSearch("?scenario=quiz")).toBe("quiz");
    expect(demoScenarioFromSearch("?scenario=document")).toBe("document");
    expect(demoScenarioFromSearch("?scenario=plugins")).toBe("plugins");
    expect(demoScenarioFromSearch("?scenario=required-reasoning")).toBe(
      "required-reasoning",
    );
    expect(demoScenarioFromSearch("?scenario=unknown")).toBe("working");
  });

  it("keeps the initial working state available for visual review", () => {
    render(<DemoApp initialScenario="thinking" />);

    expect(screen.getByText("Working")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^plan \d+\/\d+/i }),
    ).toBeNull();
  });

  it("switches to a compact approval state while keeping steering available", () => {
    render(<DemoApp initialScenario="approval" />);

    expect(
      screen.getByRole("region", { name: "Permission request" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
  });

  it("asks about a tool of a connection the person added, saying why", () => {
    render(<DemoApp initialScenario="connected-tool" />);

    const request = screen.getByRole("region", { name: "Permission request" });
    expect(request).toHaveTextContent("First use");
    fireEvent.click(within(request).getByRole("button", { name: "More" }));
    expect(request).toHaveTextContent(
      "Zhiyin can't check what a tool from a connector you added does",
    );
    expect(
      screen.getByRole("button", {
        name: "Allow for this conversation: Team wiki · Update page",
      }),
    ).toBeVisible();
  });

  it("offers the browser beside the conversation in the browser demo", () => {
    render(<DemoApp initialScenario="browser" />);

    fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
    expect(screen.getByRole("tabpanel", { name: "Browser" })).toBeVisible();
    expect(screen.getByText("Documentation preview")).toBeVisible();
  });

  it("shows the report the conversation made beside it, beside a browser it can switch to", async () => {
    render(<DemoApp initialScenario="document" />);

    expect(
      screen.getByRole("heading", { name: "q3-report.pdf" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("img", { name: "Page 1 of q3-report.pdf" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Browser" }));
    expect(screen.getByText("Pricing — Example")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    // The browser stays until the document's page is drawn.
    fireEvent.click(
      await screen.findByRole("button", { name: "Close document" }),
    );

    // Closing the document falls back to the browser still open, as the core
    // does.
    expect(
      await screen.findByRole("img", { name: /Pricing — Example — the page/ }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Document" })).toBeNull();
  });

  it("opens usage, then the plugin directory, from the sidebar", () => {
    render(<DemoApp initialScenario="working" />);

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(
      screen.getByRole("region", { name: "Usage overview" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByRole("region", { name: "Plugins" })).toBeVisible();
  });

  it("shows an update ready, which waits while a conversation works", async () => {
    render(<DemoApp initialScenario="update" />);

    expect(screen.getByText("Zhiyin 0.1.0-alpha.3 is ready")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Version 0.1.0-alpha.2")).toBeVisible();
    expect(
      screen.getByText(
        "Version 0.1.0-alpha.3 is ready. It installs when Zhiyin restarts.",
      ),
    ).toBeVisible();
  });
});
