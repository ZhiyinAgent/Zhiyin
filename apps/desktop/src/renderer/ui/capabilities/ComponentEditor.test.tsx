import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComponentEditor } from "./ComponentEditor.js";

describe("ComponentEditor", () => {
  it("validates required fields before saving a skill", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{ kind: "skill", id: "", description: "", instructions: "" }}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Enter a name.")).toBeVisible();
    expect(screen.getByText("Describe when to use it.")).toBeVisible();
    expect(screen.getByText("Add instructions.")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a filled-in skill, slugifying a new name", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{ kind: "skill", id: "", description: "", instructions: "" }}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Fetch Forecast" },
    });
    fireEvent.change(screen.getByLabelText("When should Zhiyin use it?"), {
      target: { value: "Look up a forecast." },
    });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Call the forecast tool." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        kind: "skill",
        id: "fetch-forecast",
        description: "Look up a forecast.",
        instructions: "Call the forecast tool.",
      }),
    );
  });

  it("confirms before removing an existing component", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{
          kind: "skill",
          id: "fetch-forecast",
          description: "d",
          instructions: "i",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove this skill?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
  });

  it("keeps a connector's save disabled until a test connection succeeds", async () => {
    const onTest = vi.fn().mockResolvedValue({
      ok: true,
      tools: [{ name: "search", enabled: true }],
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Weather API",
          url: "https://example.com/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={() => undefined}
        onSave={onSave}
        onTest={onTest}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/Connected · 1 tool found/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        kind: "connection",
        id: "weather-api",
        name: "Weather API",
        url: "https://example.com/mcp",
        access: "",
        dataDestination: "",
      }),
    );
  });

  it("shows a failed test's reason without unlocking save", async () => {
    const onTest = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "Could not connect." });
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Weather API",
          url: "https://example.com/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onTest={onTest}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("Could not connect.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("lets an already-connected existing connector save without a fresh test", () => {
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "weather-api",
          name: "Weather API",
          url: "https://example.com/mcp",
          access: "",
          dataDestination: "",
        }}
        connectionState={{
          status: "connected",
          tokenSaved: false,
          tools: [{ name: "search", description: "Search.", enabled: true }],
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onSetToolEnabled={async () => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("toggles a connector's individual tools", async () => {
    const onSetToolEnabled = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "weather-api",
          name: "Weather API",
          url: "https://example.com/mcp",
          access: "",
          dataDestination: "",
        }}
        connectionState={{
          status: "connected",
          tokenSaved: false,
          tools: [
            { name: "search", description: "Search.", enabled: true },
            { name: "alerts", description: "Alerts.", enabled: false },
          ],
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onSetToolEnabled={onSetToolEnabled}
      />,
    );

    const tools = screen.getByRole("group", { name: "Tools" });
    fireEvent.click(within(tools).getByLabelText(/search/));

    await waitFor(() =>
      expect(onSetToolEnabled).toHaveBeenCalledWith("search", false),
    );
  });
});
