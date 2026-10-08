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

  it("saves a new connector without testing or connecting it first", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
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
        onClose={onClose}
        onSave={onSave}
        onTest={async () => ({ ok: true, tools: [] })}
      />,
    );
    fireEvent.click(
      screen.getByRole("radio", { name: /Paste an access token/ }),
    );

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
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a failed test's reason, and still lets the connector be saved", async () => {
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
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
    fireEvent.click(within(tools).getByLabelText(/Search/));

    await waitFor(() =>
      expect(onSetToolEnabled).toHaveBeenCalledWith("search", false),
    );
  });

  it("asks how Zhiyin gets access, and asks for a token only when the person chooses one", () => {
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onTest={async () => ({ ok: true, tools: [] })}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /Sign in with an account/ }),
    ).toBeChecked();
    expect(screen.queryByLabelText("Access token")).toBeNull();

    fireEvent.click(
      screen.getByRole("radio", { name: /Paste an access token/ }),
    );

    expect(screen.getByLabelText("Access token")).toBeVisible();
  });

  it("offers to sign in once a new connector is saved, and leaves it for later on Done", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSignIn = vi.fn();
    const onClose = vi.fn();
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={onClose}
        onSave={onSave}
        onSignIn={onSignIn}
        onCancelSignIn={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Tracker is saved. You can sign in now or later.",
      ),
    ).toBeVisible();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tracker", name: "Tracker" }),
    );
    expect(onSignIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("signs in right after saving when the person asks, and closes once signed in", async () => {
    const onSignIn = vi.fn().mockResolvedValue({ status: "signed-in" });
    const onClose = vi.fn();
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={onClose}
        onSave={async () => undefined}
        onSignIn={onSignIn}
        onCancelSignIn={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith("tracker"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps a new connector that was saved when its sign-in is cancelled, and offers to sign in again", async () => {
    let finish!: (outcome: { status: "cancelled" }) => void;
    const onSignIn = vi.fn(
      () =>
        new Promise<{ status: "cancelled" }>((resolve) => (finish = resolve)),
    );
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onSignIn={onSignIn}
        onCancelSignIn={async () => finish({ status: "cancelled" })}
        onSignOut={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("says when the service has no sign-in Zhiyin can use", async () => {
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
        onTest={async () => ({
          ok: false,
          reason: "This service needs an access token.",
          needs: "token",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText(
        "This service has no sign-in Zhiyin can use. Choose Paste an access token.",
      ),
    ).toBeVisible();
  });

  it("signs in to a saved connector whose service has its own sign-in", async () => {
    const onSignIn = vi.fn().mockResolvedValue({ status: "signed-in" });
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "tracker",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        connectionState={{
          status: "unauthorized",
          tokenSaved: false,
          tools: [],
          account: "signed-out",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onSignIn={onSignIn}
        onCancelSignIn={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );

    expect(screen.getByText("Sign in to Tracker")).toBeVisible();
    expect(screen.queryByLabelText("Access token")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onSignIn).toHaveBeenCalledWith("tracker"));
  });

  it("forgets what it knew about the old address once the address changes", () => {
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "tracker",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        connectionState={{
          status: "connected",
          tokenSaved: false,
          tools: [],
          account: "signed-in",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onTest={async () => ({ ok: true, tools: [] })}
        onSignIn={async () => ({ status: "signed-in" })}
        onCancelSignIn={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("MCP endpoint"), {
      target: { value: "https://other.example/mcp" },
    });

    expect(screen.queryByText("Signed in to Tracker")).toBeNull();
    expect(
      screen.getByRole("radio", { name: /Sign in with an account/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("signs out of a signed-in connector from its form", async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    render(
      <ComponentEditor
        draft={{
          kind: "connection",
          id: "tracker",
          name: "Tracker",
          url: "https://mcp.tracker.example/mcp",
          access: "",
          dataDestination: "",
        }}
        connectionState={{
          status: "connected",
          tokenSaved: false,
          tools: [],
          account: "signed-in",
        }}
        onClose={() => undefined}
        onSave={async () => undefined}
        onSignIn={async () => ({ status: "signed-in" })}
        onCancelSignIn={async () => undefined}
        onSignOut={onSignOut}
      />,
    );

    expect(screen.getByText("Signed in to Tracker")).toBeVisible();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("Access token")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledWith("tracker"));
  });
});
