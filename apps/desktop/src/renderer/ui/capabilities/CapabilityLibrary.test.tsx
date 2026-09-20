import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AuthoredPluginContents,
  McpServerState,
  PluginComponentState,
  PluginState,
} from "@zhiyin/contract";
import { CapabilityLibrary } from "./CapabilityLibrary.js";

const handlers = {
  onClose: () => undefined,
  onTogglePlugin: async () => undefined,
  onInstallPlugin: async () => ({ status: "cancelled" as const }),
  onUpdatePlugin: async () => ({ status: "cancelled" as const }),
  onRollbackPlugin: async () => undefined,
  onRemovePlugin: async () => undefined,
  onCreatePlugin: async () => undefined,
  onLoadEditableContents: async () => undefined,
  onSavePluginContents: async () => undefined,
  onToggleComponent: async () => undefined,
  onLoadComponentContent: async () => undefined,
  onOverrideComponent: async () => undefined,
  onResetComponent: async () => undefined,
  onInstallToolchain: async () => undefined,
  onTestConnection: async () => ({ ok: false as const, reason: "" }),
  onSetConnectionToolEnabled: async () => undefined,
  onSaveConnectionToken: async () => undefined,
  onClearConnectionToken: async () => undefined,
  onRefreshConnections: async () => undefined,
  onCheckShell: async () => ({ available: true as const }),
  onRecheckShell: async () => ({ available: true as const }),
  onOpenExternalUrl: async () => undefined,
};

const skill = (
  id: string,
  overrides: Partial<PluginComponentState> = {},
): PluginComponentState => ({
  id,
  kind: "skill",
  name: id.slice(id.indexOf("/") + 1),
  description: `Use ${id}.`,
  enabled: true,
  status: "ready",
  editing: "override",
  ...overrides,
});

const engineering: PluginState = {
  id: "engineering",
  name: "Full-Stack Software Engineering",
  version: "1.0.0",
  description: "Design, build, test, and review software.",
  category: "Development",
  publisher: "Zhiyin",
  source: "built-in",
  editing: "override",
  rollbackAvailable: false,
  enabled: true,
  status: "partial",
  defaultPrompts: ["Review this project and propose the next change."],
  accessSummary: "Works in the project folder you chose.",
  dataDestination: "Nothing leaves this computer.",
  components: [
    skill("engineering/test-driven-development"),
    skill("engineering/system-architecture", { enabled: false, status: "off" }),
    {
      id: "engineering/code-reviewer",
      kind: "specialist",
      name: "Code reviewer",
      description: "Reviews a change.",
      enabled: true,
      status: "ready",
      editing: "override",
    },
    {
      id: "engineering/github",
      kind: "connection",
      name: "GitHub",
      description: "Works with repositories.",
      enabled: true,
      status: "setup-required",
      editing: "none",
      access: "Needs a GitHub token.",
      dataDestination: "api.githubcopilot.com",
    },
    {
      id: "engineering/browser",
      kind: "connection",
      name: "Browser",
      description: "Tests pages in an app-owned window.",
      enabled: true,
      status: "ready",
      editing: "none",
      appConnector: true,
    },
  ],
};

const publishing: PluginState = {
  ...engineering,
  id: "publishing",
  name: "Technical & Academic Publishing",
  category: "Writing",
  description: "Write and typeset technical documents.",
  defaultPrompts: [],
  components: [
    {
      id: "publishing/compiler",
      kind: "connection",
      name: "Document compiler",
      description: "Compiles Typst and LaTeX.",
      enabled: true,
      status: "setup-required",
      editing: "none",
      appConnector: true,
      toolchain: {
        status: "missing",
        downloads: [
          {
            name: "Typst",
            version: "0.15.1",
            bytes: 22_463_684,
            source: "github.com/typst/typst",
          },
        ],
      },
      dataDestination: "Installing downloads Typst from GitHub.",
    },
  ],
};

const authored: PluginState = {
  ...engineering,
  id: "notes",
  name: "Notes",
  category: "Other",
  source: "personal",
  editing: "authored",
  publisher: "You",
  rollbackAvailable: true,
  status: "ready",
  defaultPrompts: [],
  components: [
    skill("notes/summarize", {
      name: "summarize",
      description: "Summarizes a note.",
      editing: "authored",
    }),
  ],
};

const imported: PluginState = {
  ...authored,
  id: "imported",
  name: "Imported Tools",
  editing: "override",
  components: [skill("imported/cleanup")],
};

const githubConnection: McpServerState = {
  id: "engineering/github",
  name: "GitHub",
  url: "https://api.githubcopilot.com/mcp/",
  enabled: true,
  status: "unauthorized",
  toolCount: 1,
  tools: [{ name: "search_code", description: "Search code.", enabled: true }],
  credential: { status: "saved" },
};

const rowOf = (text: string) => screen.getByText(text).closest("li")!;

describe("CapabilityLibrary", () => {
  it("shows that the directory is still loading instead of an empty install", () => {
    render(<CapabilityLibrary plugins={[]} loading {...handlers} />);

    expect(screen.getByText("Loading installed plugins…")).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Find plugins" }),
    ).toBeDisabled();
  });

  it("groups a plugin's components and shows each component's switch exactly once", () => {
    render(
      <CapabilityLibrary plugins={[engineering, publishing]} {...handlers} />,
    );

    const details = screen.getByRole("region", {
      name: "Full-Stack Software Engineering details",
    });
    for (const title of ["Skills", "Specialists", "Connectors"])
      expect(within(details).getByText(title)).toBeVisible();
    expect(
      within(rowOf("test-driven-development")).getByRole("switch"),
    ).toHaveAttribute("aria-checked", "true");
    const off = rowOf("system-architecture");
    expect(within(off).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(off.className).toMatch(/disabled/);
    // A skill has no readiness beyond its switch, so no status text repeats it.
    expect(within(off).queryByText(/Off|Disabled/)).not.toBeInTheDocument();
  });

  it("sends a component switch to the core by the component's full id", async () => {
    const onToggleComponent = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        onToggleComponent={onToggleComponent}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Turn off Code reviewer" }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Turn on system-architecture" }),
    );

    await waitFor(() =>
      expect(onToggleComponent.mock.calls).toEqual([
        ["engineering/code-reviewer", false],
        ["engineering/system-architecture", true],
      ]),
    );
  });

  it("shows what a plugin is for, who publishes it, and what it can reach", () => {
    render(<CapabilityLibrary plugins={[engineering]} {...handlers} />);

    const details = screen.getByRole("region", {
      name: "Full-Stack Software Engineering details",
    });
    expect(
      within(details).getByText("Built-in · Zhiyin · Version 1.0.0"),
    ).toBeVisible();
    expect(
      within(details).getByText("Works in the project folder you chose."),
    ).toBeVisible();
    expect(
      within(details).getByText("Nothing leaves this computer."),
    ).toBeVisible();
    expect(within(details).getByText("Try asking")).toBeVisible();
    expect(
      within(details).getByText(
        "Review this project and propose the next change.",
      ),
    ).toBeVisible();
  });

  it("offers no way to update or remove a built-in plugin", () => {
    render(<CapabilityLibrary plugins={[engineering]} {...handlers} />);

    expect(
      screen.queryByRole("group", {
        name: "Manage Full-Stack Software Engineering",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("updates, rolls back, and removes an imported plugin", async () => {
    const onUpdatePlugin = vi.fn(async () => ({ status: "applied" as const }));
    const onRollbackPlugin = vi.fn(async () => undefined);
    const onRemovePlugin = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[imported]}
        {...handlers}
        onUpdatePlugin={onUpdatePlugin}
        onRollbackPlugin={onRollbackPlugin}
        onRemovePlugin={onRemovePlugin}
      />,
    );
    const manage = screen.getByRole("group", { name: "Manage Imported Tools" });

    fireEvent.click(
      within(manage).getByRole("button", { name: "Update from a folder…" }),
    );
    await waitFor(() =>
      expect(onUpdatePlugin).toHaveBeenCalledWith("imported"),
    );
    fireEvent.click(within(manage).getByRole("button", { name: "Roll back" }));
    await waitFor(() =>
      expect(onRollbackPlugin).toHaveBeenCalledWith("imported"),
    );
    fireEvent.click(within(manage).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove Imported Tools?")).toBeVisible();
    expect(
      screen.getByText(/any access tokens its connectors use/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove permanently" }));
    await waitFor(() =>
      expect(onRemovePlugin).toHaveBeenCalledWith("imported"),
    );
  });

  it("removes a plugin made in the app, but never updates it from a folder", () => {
    render(<CapabilityLibrary plugins={[authored]} {...handlers} />);

    const manage = screen.getByRole("group", { name: "Manage Notes" });
    expect(
      within(manage).getByRole("button", { name: "Remove" }),
    ).toBeVisible();
    expect(
      within(manage).queryByRole("button", { name: "Update from a folder…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Made in Zhiyin · You · Version 1.0.0"),
    ).toBeVisible();
  });

  it("shows a failed update's reason on the page", async () => {
    render(
      <CapabilityLibrary
        plugins={[imported]}
        {...handlers}
        onUpdatePlugin={async () => ({
          status: "failed" as const,
          reason: "An update must have a newer version.",
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Update from a folder…" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An update must have a newer version.",
    );
  });

  it("opens a shipped skill for editing, and saves the edit as an edit of that component", async () => {
    const onLoadComponentContent = vi.fn(async (id: string) => ({
      id,
      kind: "skill" as const,
      name: "test-driven-development",
      description: "Use when changing behavior.",
      instructions: "Write the failing test first.",
      editing: "override" as const,
    }));
    const onOverrideComponent = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        onLoadComponentContent={onLoadComponentContent}
        onOverrideComponent={onOverrideComponent}
      />,
    );

    fireEvent.click(
      within(rowOf("test-driven-development")).getByRole("button", {
        name: "Edit test-driven-development",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit skill" });
    fireEvent.change(within(dialog).getByLabelText("Instructions"), {
      target: { value: "Write the failing test, then the smallest change." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onOverrideComponent).toHaveBeenCalledWith(
        "engineering/test-driven-development",
        {
          description: "Use when changing behavior.",
          instructions: "Write the failing test, then the smallest change.",
        },
      ),
    );
    expect(onLoadComponentContent).toHaveBeenCalledWith(
      "engineering/test-driven-development",
    );
  });

  it("marks an edited component, and says when the plugin ships a different version since", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            components: [
              skill("engineering/test-driven-development", {
                overridden: true,
              }),
              skill("engineering/system-architecture", {
                overridden: true,
                shippedChanged: true,
              }),
            ],
          },
        ]}
        {...handlers}
      />,
    );

    expect(
      within(rowOf("test-driven-development")).getByText("Your edit"),
    ).toBeVisible();
    expect(
      within(rowOf("system-architecture")).getByText(
        "Your edit · the plugin now ships a different version",
      ),
    ).toBeVisible();
  });

  it("edits a component of an app-made plugin as the plugin's whole updated content", async () => {
    const contents: AuthoredPluginContents = {
      displayName: "Notes",
      description: authored.description,
      skills: [
        {
          id: "summarize",
          description: "Summarizes a note.",
          instructions: "Keep it to three sentences.",
        },
      ],
      specialists: [],
      mcpServers: [],
    };
    const onSavePluginContents = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[authored]}
        {...handlers}
        onLoadEditableContents={async () => contents}
        onSavePluginContents={onSavePluginContents}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit summarize" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit skill" });
    fireEvent.change(
      within(dialog).getByLabelText("When should Zhiyin use it?"),
      { target: { value: "Summarize any note the person is looking at." } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSavePluginContents).toHaveBeenCalledWith("notes", {
        ...contents,
        skills: [
          {
            id: "summarize",
            description: "Summarize any note the person is looking at.",
            instructions: "Keep it to three sentences.",
          },
        ],
      }),
    );
  });

  it("saves a new connector's token under the connector's full id", async () => {
    const contents: AuthoredPluginContents = {
      displayName: "Notes",
      description: authored.description,
      skills: [],
      specialists: [],
      mcpServers: [],
    };
    const onSavePluginContents = vi.fn(async () => undefined);
    const onSaveConnectionToken = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[authored]}
        {...handlers}
        onLoadEditableContents={async () => contents}
        onSavePluginContents={onSavePluginContents}
        onSaveConnectionToken={onSaveConnectionToken}
        onTestConnection={async () => ({ ok: true as const, tools: [] })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New connector" }));
    const dialog = await screen.findByRole("dialog", { name: "New connector" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Weather API" },
    });
    fireEvent.change(within(dialog).getByLabelText("MCP endpoint"), {
      target: { value: "https://weather.example/mcp" },
    });
    fireEvent.change(within(dialog).getByLabelText("Access token"), {
      target: { value: "secret" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Test connection" }),
    );
    await within(dialog).findByText(/Connected/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSaveConnectionToken).toHaveBeenCalledWith(
        "notes/weather-api",
        "secret",
      ),
    );
    expect(onSavePluginContents).toHaveBeenCalledWith(
      "notes",
      expect.objectContaining({
        mcpServers: [
          expect.objectContaining({
            id: "weather-api",
            url: "https://weather.example/mcp",
          }),
        ],
      }),
    );
  });

  it("sets up a shipped connector's token without offering to change its address", async () => {
    const onSaveConnectionToken = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[githubConnection]}
        {...handlers}
        onSaveConnectionToken={onSaveConnectionToken}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    expect(
      within(dialog).queryByLabelText("MCP endpoint"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("https://api.githubcopilot.com/mcp/"),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText("Access token"), {
      target: { value: "ghp_new" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save token" }));

    await waitFor(() =>
      expect(onSaveConnectionToken).toHaveBeenCalledWith(
        "engineering/github",
        "ghp_new",
      ),
    );
  });

  it("lets a person remove a saved token and switch a connector's tools", async () => {
    const onClearConnectionToken = vi.fn(async () => undefined);
    const onSetConnectionToolEnabled = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[githubConnection]}
        {...handlers}
        onClearConnectionToken={onClearConnectionToken}
        onSetConnectionToolEnabled={onSetConnectionToolEnabled}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /search_code/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove saved token" }),
    );

    await waitFor(() =>
      expect(onClearConnectionToken).toHaveBeenCalledWith("engineering/github"),
    );
    expect(onSetConnectionToolEnabled).toHaveBeenCalledWith(
      "engineering/github",
      "search_code",
      false,
    );
  });

  it("states what installing a connector's program downloads before doing it", async () => {
    const onInstallToolchain = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[publishing]}
        {...handlers}
        onInstallToolchain={onInstallToolchain}
      />,
    );

    const row = rowOf("Document compiler");
    expect(within(row).getByRole("switch")).toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Set up Document compiler",
    });
    expect(within(dialog).getByText("Typst 0.15.1")).toBeVisible();
    expect(within(dialog).getByText("github.com/typst/typst")).toBeVisible();
    expect(within(dialog).getAllByText("22 MB")).toHaveLength(2);
    expect(
      within(dialog).getByText(/checked against its published fingerprint/),
    ).toBeVisible();
    expect(onInstallToolchain).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(onInstallToolchain).toHaveBeenCalledWith("publishing/compiler"),
    );
  });

  it("shows an installation in progress and a failed one's reason", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...publishing,
            components: [
              {
                ...publishing.components[0]!,
                toolchain: { status: "installing" },
              },
              {
                ...publishing.components[0]!,
                id: "publishing/other",
                name: "Other compiler",
                status: "failed",
                toolchain: {
                  status: "failed",
                  reason: "The download did not match its fingerprint.",
                },
                detail: "The download did not match its fingerprint.",
              },
            ],
          },
        ]}
        {...handlers}
      />,
    );

    const installing = rowOf("Document compiler");
    expect(
      within(installing).getByRole("button", { name: "Installing…" }),
    ).toBeDisabled();
    const failed = rowOf("Other compiler");
    expect(within(failed).getByText("Setup failed")).toBeVisible();
    expect(
      within(failed).getByText("The download did not match its fingerprint."),
    ).toBeVisible();
    expect(
      within(failed).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("offers to check again on an application connector whose prerequisite is missing", async () => {
    const onRefreshConnections = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            components: [
              {
                ...engineering.components[4]!,
                status: "setup-required",
                detail: "git.exe was not found.",
              },
            ],
          },
        ]}
        {...handlers}
        onRefreshConnections={onRefreshConnections}
      />,
    );

    const row = rowOf("Browser");
    expect(within(row).getByText("git.exe was not found.")).toBeVisible();
    fireEvent.click(within(row).getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(onRefreshConnections).toHaveBeenCalled());
  });

  it("names why a connector is not working instead of calling it off", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            status: "failed",
            components: [
              engineering.components[3]!,
              {
                ...engineering.components[3]!,
                id: "engineering/other",
                name: "Other service",
                status: "failed",
              },
            ],
          },
        ]}
        {...handlers}
      />,
    );

    const github = rowOf("GitHub");
    expect(within(github).queryByText("Off")).not.toBeInTheDocument();
    expect(within(github).getByRole("switch")).toBeDisabled();
    expect(
      within(github).getByRole("button", { name: /Set up GitHub/ }),
    ).toBeVisible();
    expect(
      within(rowOf("Other service")).getByText("Couldn't connect"),
    ).toBeVisible();
  });

  it("keeps an unavailable connector visible with its reason, but offers no switch", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            components: [
              {
                ...engineering.components[4]!,
                status: "unavailable",
                detail: "This connector is not available in this build.",
              },
            ],
          },
        ]}
        {...handlers}
      />,
    );

    const row = rowOf("Browser");
    expect(within(row).getByText("Unavailable")).toBeVisible();
    expect(
      within(row).getByText("This connector is not available in this build."),
    ).toBeVisible();
    expect(within(row).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("flags a partly ready plugin with a warning icon, and marks a fully ready one with no badge", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            components: [
              ...engineering.components,
              {
                ...engineering.components[4]!,
                id: "engineering/later",
                name: "Later",
                status: "unavailable",
              },
            ],
          },
          authored,
        ]}
        {...handlers}
      />,
    );

    const partial = screen.getByRole("button", {
      name: /Full-Stack Software Engineering/,
    });
    expect(
      within(partial).getByRole("img", { name: "Needs setup" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("button", { name: /Notes/ })).queryByRole("img"),
    ).not.toBeInTheDocument();
  });

  it("explains that a plugin that is off keeps its choices but is not used", async () => {
    const onTogglePlugin = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[{ ...engineering, enabled: false, status: "off" }]}
        {...handlers}
        onTogglePlugin={onTogglePlugin}
      />,
    );

    expect(
      screen.getByText(
        "This plugin is off. Zhiyin keeps your choices below but uses none of them until you turn it on.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Turn on Full-Stack Software Engineering plugin",
      }),
    );
    await waitFor(() =>
      expect(onTogglePlugin).toHaveBeenCalledWith("engineering", true),
    );
  });

  it("creates a new plugin from a name and description", async () => {
    const onCreatePlugin = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        onCreatePlugin={onCreatePlugin}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));
    const dialog = await screen.findByRole("dialog", { name: "New plugin" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Weather Pro" },
    });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Weather tools." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create plugin" }),
    );

    await waitFor(() =>
      expect(onCreatePlugin).toHaveBeenCalledWith(
        "Weather Pro",
        "Weather tools.",
      ),
    );
  });

  it("tells the author of an empty section how to fill it, and offers no new components in other plugins", () => {
    render(
      <CapabilityLibrary plugins={[authored, engineering]} {...handlers} />,
    );

    expect(screen.getByText("No specialists yet.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "New specialist" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Full-Stack Software Engineering/ }),
    );
    expect(
      screen.queryByRole("button", { name: "New skill" }),
    ).not.toBeInTheDocument();
  });

  it("filters the directory by name, description, and category", () => {
    render(
      <CapabilityLibrary plugins={[engineering, publishing]} {...handlers} />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Find plugins" }), {
      target: { value: "writing" },
    });

    expect(
      screen.queryByRole("button", { name: /Full-Stack Software Engineering/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Technical & Academic Publishing/ }),
    ).toBeVisible();
  });

  it("shows why the shell tool is unavailable, with an install link and a recheck action", async () => {
    const onOpenExternalUrl = vi.fn(async () => undefined);
    const onRecheckShell = vi.fn(async () => ({ available: true as const }));
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        onCheckShell={async () => ({
          available: false,
          reason: "No shell was found.",
          installUrl: "https://git-scm.com/download/win",
        })}
        onRecheckShell={onRecheckShell}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );

    await screen.findByText(/No shell was found\./);
    fireEvent.click(
      screen.getByRole("button", { name: "Get Git for Windows" }),
    );
    await waitFor(() =>
      expect(onOpenExternalUrl).toHaveBeenCalledWith(
        "https://git-scm.com/download/win",
      ),
    );
    const notice = screen.getByText(/No shell was found\./).closest("div")!;
    fireEvent.click(
      within(notice).getByRole("button", { name: "Check again" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(/No shell was found\./),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows no shell notice once the shell is available", () => {
    render(<CapabilityLibrary plugins={[engineering]} {...handlers} />);

    expect(
      screen.queryByText(/Shell commands are unavailable/),
    ).not.toBeInTheDocument();
  });
});
