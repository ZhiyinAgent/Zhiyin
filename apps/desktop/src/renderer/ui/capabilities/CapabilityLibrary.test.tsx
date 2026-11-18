import {
  act,
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
  ToolchainState,
} from "@zhiyin/contract";
import { CapabilityLibrary } from "./CapabilityLibrary.js";
import type {
  ComponentActions,
  ConnectionActions,
  PluginActions,
  ShellChecks,
} from "./libraryActions.js";

const pluginActions: PluginActions = {
  toggle: async () => undefined,
  install: async () => ({ status: "cancelled" as const }),
  update: async () => ({ status: "cancelled" as const }),
  rollback: async () => undefined,
  remove: async () => undefined,
  create: async () => undefined,
  editableContents: async () => undefined,
  saveContents: async () => undefined,
};

const componentActions: ComponentActions = {
  toggle: async () => undefined,
  content: async () => undefined,
  override: async () => undefined,
  reset: async () => undefined,
  installToolchain: async () => undefined,
  cancelToolchainInstall: async () => undefined,
};

const connectionActions: ConnectionActions = {
  test: async () => ({ ok: false as const, reason: "" }),
  setToolEnabled: async () => undefined,
  saveToken: async () => undefined,
  clearToken: async () => undefined,
  signIn: async () => ({ status: "cancelled" as const }),
  cancelSignIn: async () => undefined,
  refresh: async () => undefined,
  // A check answers with the connector's state as the connection feature has it.
  check: async (id: string): Promise<McpServerState> => ({
    ...githubConnection,
    id,
  }),
};

const shellChecks: ShellChecks = {
  check: async () => ({ available: true as const }),
  recheck: async () => ({ available: true as const }),
};

const handlers = {
  onClose: () => undefined,
  pluginActions,
  componentActions,
  connectionActions,
  shellChecks,
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
            sources: [
              "github.com/typst/typst",
              "release-assets.githubusercontent.com",
              "media.zhiyinagent.app",
            ],
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
      within(rowOf("Test driven development")).getByRole("switch"),
    ).toHaveAttribute("aria-checked", "true");
    const off = rowOf("System architecture");
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
        componentActions={{ ...componentActions, toggle: onToggleComponent }}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Code reviewer: on" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "System architecture: off" }),
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
      within(details).getByText("Comes with Zhiyin · Zhiyin · Version 1.0.0"),
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
        pluginActions={{
          ...pluginActions,
          update: onUpdatePlugin,
          rollback: onRollbackPlugin,
          remove: onRemovePlugin,
        }}
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
      screen.getByText(
        "Removing it deletes its 1 skill. This cannot be undone.",
      ),
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
        pluginActions={{
          ...pluginActions,
          update: async () => ({
            status: "failed" as const,
            reason: "An update must have a newer version.",
          }),
        }}
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
        componentActions={{
          ...componentActions,
          content: onLoadComponentContent,
          override: onOverrideComponent,
        }}
      />,
    );

    fireEvent.click(
      within(rowOf("Test driven development")).getByRole("button", {
        name: "Edit Test driven development",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit skill" });
    // The skill's own name, which is how files and instructions refer to it.
    expect(within(dialog).getByText("test-driven-development")).toBeVisible();
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
      within(rowOf("Test driven development")).getByText("Your edit"),
    ).toBeVisible();
    expect(
      within(rowOf("System architecture")).getByText(
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
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
          saveContents: onSavePluginContents,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Summarize" }));
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

  it("reaches an app-made connector when its form opens, and then offers its sign-in", async () => {
    const tracker = {
      id: "notes/tracker",
      kind: "connection" as const,
      name: "Tracker",
      description: "Files issues.",
      enabled: true,
      status: "unchecked" as const,
      editing: "authored" as const,
    };
    const withTracker = { ...authored, components: [tracker] };
    const contents: AuthoredPluginContents = {
      displayName: "Notes",
      description: authored.description,
      skills: [],
      specialists: [],
      mcpServers: [
        {
          id: "tracker",
          name: "Tracker",
          description: "Files issues.",
          url: "https://mcp.tracker.example/mcp",
        },
      ],
    };
    const unchecked: McpServerState = {
      id: "notes/tracker",
      name: "Tracker",
      url: "https://mcp.tracker.example/mcp",
      enabled: true,
      status: "unchecked",
      toolCount: 0,
      tools: [],
      credential: { status: "none" },
    };
    const onCheckConnection = vi.fn(async () => unchecked);
    const { rerender } = render(
      <CapabilityLibrary
        plugins={[withTracker]}
        mcpServers={[unchecked]}
        {...handlers}
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
        }}
        connectionActions={{ ...connectionActions, check: onCheckConnection }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Tracker" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit connector",
    });
    expect(onCheckConnection).toHaveBeenCalledWith("notes/tracker");

    rerender(
      <CapabilityLibrary
        plugins={[withTracker]}
        mcpServers={[{ ...unchecked, status: "unauthorized", signIn: true }]}
        {...handlers}
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
        }}
        connectionActions={{ ...connectionActions, check: onCheckConnection }}
      />,
    );

    expect(
      within(dialog).getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });

  it("reaches a connector once it is saved, so the list says how it answered", async () => {
    const contents: AuthoredPluginContents = {
      displayName: "Notes",
      description: authored.description,
      skills: [],
      specialists: [],
      mcpServers: [],
    };
    const onCheckConnection = vi.fn(async () => {
      throw new Error("not reached in this test");
    });
    render(
      <CapabilityLibrary
        plugins={[authored]}
        {...handlers}
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
          saveContents: async () => undefined,
        }}
        connectionActions={{ ...connectionActions, check: onCheckConnection }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New connector" }));
    const dialog = await screen.findByRole("dialog", { name: "New connector" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Weather API" },
    });
    fireEvent.change(within(dialog).getByLabelText("Address"), {
      target: { value: "https://weather.example/mcp" },
    });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /Paste an access token/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onCheckConnection).toHaveBeenCalledWith("notes/weather-api"),
    );
  });

  it("refuses a new skill or connector named like a component the plugin has, saving nothing", async () => {
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
      mcpServers: [
        {
          id: "tracker",
          name: "Tracker",
          description: "Files issues.",
          url: "https://tracker.example/mcp",
        },
      ],
    };
    const onSavePluginContents = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[authored]}
        {...handlers}
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
          saveContents: onSavePluginContents,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    let dialog = await screen.findByRole("dialog", { name: "New skill" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Summarize" },
    });
    fireEvent.change(
      within(dialog).getByLabelText("When should Zhiyin use it?"),
      { target: { value: "Summarizes anything." } },
    );
    fireEvent.change(within(dialog).getByLabelText("Instructions"), {
      target: { value: "New text." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This plugin already has a skill named summarize. Choose another name.",
    );
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "New connector" }));
    dialog = await screen.findByRole("dialog", { name: "New connector" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Tracker" },
    });
    fireEvent.change(within(dialog).getByLabelText("Address"), {
      target: { value: "https://other.example/mcp" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This plugin already has a connector named tracker. Choose another name.",
    );
    expect(onSavePluginContents).not.toHaveBeenCalled();
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
        pluginActions={{
          ...pluginActions,
          editableContents: async () => contents,
          saveContents: onSavePluginContents,
        }}
        connectionActions={{
          ...connectionActions,
          saveToken: onSaveConnectionToken,
          test: async () => ({ ok: true as const, tools: [] }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New connector" }));
    const dialog = await screen.findByRole("dialog", { name: "New connector" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Weather API" },
    });
    fireEvent.change(within(dialog).getByLabelText("Address"), {
      target: { value: "https://weather.example/mcp" },
    });
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /Paste an access token/ }),
    );
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
        connectionActions={{
          ...connectionActions,
          saveToken: onSaveConnectionToken,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    expect(within(dialog).queryByLabelText("Address")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("https://api.githubcopilot.com/mcp/"),
    ).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText("Access token"), {
      target: { value: "ghp_new" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save access token" }),
    );

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
        connectionActions={{
          ...connectionActions,
          clearToken: onClearConnectionToken,
          setToolEnabled: onSetConnectionToolEnabled,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    // A tool is named in words; its own name is kept for hover.
    expect(
      within(dialog).getByText("Search code", { selector: "strong" }),
    ).toHaveAttribute("data-tip", "search_code");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Search code/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove saved access token" }),
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

  it("lets a person say how each tool of a connection they added is treated, beside its switch", async () => {
    const onSetConnectionToolTreatment = vi.fn(async () => undefined);
    const added: McpServerState = {
      ...githubConnection,
      tools: [
        {
          name: "search_code",
          description: "Search code.",
          enabled: true,
          treatment: "ask-once",
          version: "search-code-as-shown",
        },
        {
          name: "list_issues",
          description: "List issues.",
          enabled: true,
          treatment: "only-reads",
        },
      ],
    };
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[added]}
        {...handlers}
        connectionActions={{
          ...connectionActions,
          check: async () => added,
          setToolTreatment: onSetConnectionToolTreatment,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    const searching = within(dialog).getByRole("combobox", {
      name: "When Zhiyin uses Search code",
    });
    expect(searching).toHaveValue("ask-once");
    expect(
      within(searching)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Ask once per conversation",
      "Ask every time",
      "Only reads — don't ask",
    ]);
    const listing = within(dialog).getByRole("combobox", {
      name: "When Zhiyin uses List issues",
    });
    expect(listing).toHaveValue("only-reads");
    expect(listing).toHaveAccessibleDescription(
      "Zhiyin cannot check that it only reads: your word is what counts.",
    );
    expect(searching).not.toHaveAccessibleDescription();

    fireEvent.change(searching, { target: { value: "ask-each-time" } });

    // Said of the version of the tool the person was shown.
    expect(onSetConnectionToolTreatment).toHaveBeenCalledWith(
      "engineering/github",
      "search_code",
      "ask-each-time",
      "search-code-as-shown",
    );
  });

  it("offers no such choice for a connection Zhiyin ships", async () => {
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[githubConnection]}
        {...handlers}
        connectionActions={{
          ...connectionActions,
          setToolTreatment: async () => undefined,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });

    expect(
      within(dialog).getByRole("checkbox", { name: /Search code/ }),
    ).toBeVisible();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });

  it("states what installing a connector's program downloads before doing it", async () => {
    const onInstallToolchain = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[publishing]}
        {...handlers}
        componentActions={{
          ...componentActions,
          installToolchain: onInstallToolchain,
        }}
      />,
    );

    const row = rowOf("Document compiler");
    expect(within(row).getByRole("switch")).toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Set up Document compiler",
    });
    expect(within(dialog).getByText("Typst 0.15.1")).toBeVisible();
    expect(
      within(dialog).getByText(
        "github.com/typst/typst, release-assets.githubusercontent.com, media.zhiyinagent.app",
      ),
    ).toBeVisible();
    expect(within(dialog).getAllByText("21.4 MB")).toHaveLength(2);
    expect(
      within(dialog).getByText(/checked against its published fingerprint/),
    ).toBeVisible();
    expect(onInstallToolchain).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(onInstallToolchain).toHaveBeenCalledWith("publishing/compiler"),
    );
  });

  /** A connector that makes an environment with its program, as the CAD studio does. */
  const withEnvironment = (toolchain: ToolchainState) => ({
    ...publishing,
    components: [
      {
        ...publishing.components[0]!,
        id: "publishing/cad",
        name: "CAD studio",
        status: "setup-required" as const,
        toolchain,
      },
    ],
  });
  const environment = {
    name: "build123d",
    version: "0.13.0",
    bytes: 226_829_779,
    estimated: true as const,
    detail: "With bd_warehouse 0.4.0 and the 56 packages they need.",
    sources: ["pypi.org", "files.pythonhosted.org"],
  };

  it("says a download whose size is reckoned is about that large, and what comes with it", async () => {
    render(
      <CapabilityLibrary
        plugins={[
          withEnvironment({
            status: "missing",
            downloads: [
              {
                name: "uv",
                version: "0.12.15",
                bytes: 17_578_593,
                sources: ["github.com/astral-sh/uv"],
              },
              environment,
            ],
          }),
        ]}
        {...handlers}
      />,
    );

    fireEvent.click(
      within(rowOf("CAD studio")).getByRole("button", { name: "Set up" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Set up CAD studio",
    });

    expect(within(dialog).getByText("build123d 0.13.0")).toBeVisible();
    expect(
      within(dialog).getByText(
        "With bd_warehouse 0.4.0 and the 56 packages they need.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("about 216.3 MB")).toBeVisible();
    expect(within(dialog).getByText("16.8 MB")).toBeVisible();
    // The whole is an estimate when any part of it is.
    expect(within(dialog).getByText("about 233.1 MB")).toBeVisible();
  });

  it("asks to update a connector whose environment is from an earlier release", async () => {
    const onInstallToolchain = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[
          withEnvironment({
            status: "missing",
            downloads: [{ ...environment, update: true }],
          }),
        ]}
        {...handlers}
        componentActions={{
          ...componentActions,
          installToolchain: onInstallToolchain,
        }}
      />,
    );

    fireEvent.click(
      within(rowOf("CAD studio")).getByRole("button", { name: "Update" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Update CAD studio",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(onInstallToolchain).toHaveBeenCalledWith("publishing/cad"),
    );
  });

  it("shows which step an installation that cannot count its bytes is on, with a way to stop it", () => {
    render(
      <CapabilityLibrary
        plugins={[
          withEnvironment({
            status: "installing",
            stage: { name: "Installing the packages", step: 2, steps: 3 },
          }),
        ]}
        {...handlers}
      />,
    );

    const row = rowOf("CAD studio");
    expect(within(row).getByText("Installing… 2 of 3")).toBeVisible();
    expect(within(row).getByText("Installing the packages")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("shows how far an installation has come, and a failed one's reason", () => {
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...publishing,
            components: [
              {
                ...publishing.components[0]!,
                toolchain: {
                  status: "installing",
                  received: 30_000_000,
                  bytes: 120_000_000,
                },
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
    expect(within(installing).getByText("Installing… 25%")).toBeVisible();
    expect(
      within(installing).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
    const failed = rowOf("Other compiler");
    expect(within(failed).getByText("Setup failed")).toBeVisible();
    expect(
      within(failed).getByText("The download did not match its fingerprint."),
    ).toBeVisible();
    expect(
      within(failed).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("stops an installation when the person cancels it", async () => {
    const onCancelToolchainInstall = vi.fn(async () => undefined);
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
            ],
          },
        ]}
        {...handlers}
        componentActions={{
          ...componentActions,
          cancelToolchainInstall: onCancelToolchainInstall,
        }}
      />,
    );

    fireEvent.click(
      within(rowOf("Document compiler")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() =>
      expect(onCancelToolchainInstall).toHaveBeenCalledWith(
        "publishing/compiler",
      ),
    );
  });

  it("keeps focus in the row as an installation starts and ends", () => {
    const shown = (toolchain: ToolchainState) => (
      <CapabilityLibrary
        plugins={[
          {
            ...publishing,
            components: [
              {
                ...publishing.components[0]!,
                ...(toolchain.status === "ready"
                  ? { status: "ready" as const }
                  : { status: "setup-required" as const }),
                toolchain,
              },
            ],
          },
        ]}
        {...handlers}
      />
    );
    const { rerender } = render(shown({ status: "missing", downloads: [] }));
    within(rowOf("Document compiler"))
      .getByRole("button", { name: "Set up" })
      .focus();

    rerender(shown({ status: "installing" }));
    expect(
      within(rowOf("Document compiler")).getByRole("button", {
        name: "Cancel",
      }),
    ).toHaveFocus();

    rerender(shown({ status: "ready" }));
    expect(rowOf("Document compiler")).toContainElement(
      document.activeElement as HTMLElement,
    );
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
        connectionActions={{
          ...connectionActions,
          refresh: onRefreshConnections,
        }}
      />,
    );

    const row = rowOf("Browser");
    expect(within(row).getByText("git.exe was not found.")).toBeVisible();
    fireEvent.click(within(row).getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(onRefreshConnections).toHaveBeenCalled());
  });

  it("says a connector nobody has used is not checked yet, and checks only that one when asked", async () => {
    const onCheckConnection = vi.fn(connectionActions.check);
    const onRefreshConnections = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[
          {
            ...engineering,
            components: [
              { ...engineering.components[3]!, status: "unchecked" },
            ],
          },
        ]}
        {...handlers}
        connectionActions={{
          ...connectionActions,
          check: onCheckConnection,
          refresh: onRefreshConnections,
        }}
      />,
    );

    const row = rowOf("GitHub");
    expect(within(row).getByText("Not checked yet")).toBeVisible();
    expect(within(row).getByRole("switch")).toBeEnabled();
    fireEvent.click(within(row).getByRole("button", { name: "Check" }));

    await waitFor(() =>
      expect(onCheckConnection).toHaveBeenCalledWith("engineering/github"),
    );
    expect(onRefreshConnections).not.toHaveBeenCalled();
  });

  it("checks a connector when its settings open, and says when it answered", async () => {
    let answer: (state: McpServerState) => void = () => undefined;
    const onCheckConnection = vi.fn(
      () =>
        new Promise<McpServerState>((resolve) => {
          answer = resolve;
        }),
    );
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[{ ...githubConnection, status: "unchecked", tools: [] }]}
        {...handlers}
        connectionActions={{ ...connectionActions, check: onCheckConnection }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    expect(within(dialog).getByText("Checking connection…")).toBeVisible();
    expect(within(dialog).queryByText(/^Connected/)).not.toBeInTheDocument();
    expect(onCheckConnection).toHaveBeenCalledWith("engineering/github");

    answer({ ...githubConnection, status: "connected", checkedAt: Date.now() });

    expect(
      await within(dialog).findByText("Connected · checked just now"),
    ).toBeVisible();
    // The tools come from the same answer as the status, not an older look.
    expect(
      within(dialog).getByRole("checkbox", { name: /Search code/ }),
    ).toBeVisible();
  });

  it("shows why a check failed and lets a person try again", async () => {
    const onCheckConnection = vi.fn(async () => ({
      ...githubConnection,
      status: "failed" as const,
      reason:
        "Could not connect to this MCP server. The server did not answer in time.",
      checkedAt: Date.now(),
    }));
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        mcpServers={[githubConnection]}
        {...handlers}
        connectionActions={{ ...connectionActions, check: onCheckConnection }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up GitHub" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up GitHub" });
    expect(
      await within(dialog).findByText(
        "Could not connect to this MCP server. The server did not answer in time.",
      ),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(onCheckConnection).toHaveBeenCalledTimes(2));
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

  it("flags a partly ready plugin with an icon that says so on hover, and marks a fully ready one with no badge", () => {
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
    ).toHaveAttribute("data-tip", "Needs setup");
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
        pluginActions={{ ...pluginActions, toggle: onTogglePlugin }}
      />,
    );

    expect(
      screen.getByText(
        "This plugin is off. Zhiyin keeps your choices below but uses none of them until you turn it on.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Full-Stack Software Engineering plugin: off",
      }),
    );
    await waitFor(() =>
      expect(onTogglePlugin).toHaveBeenCalledWith("engineering", true),
    );
  });

  /** A switch shows its state by colour alone; its name says it in words. */
  it("says on each switch whether it is on, and that a part of an off plugin is not in use", () => {
    const { rerender } = render(
      <CapabilityLibrary plugins={[engineering]} {...handlers} />,
    );
    expect(
      screen.getByRole("switch", { name: "Test driven development: on" }),
    ).toHaveAttribute("aria-checked", "true");

    rerender(
      <CapabilityLibrary
        plugins={[{ ...engineering, enabled: false, status: "off" }]}
        {...handlers}
      />,
    );
    expect(
      screen.getByRole("switch", {
        name: "Test driven development: on, but its plugin is off",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "System architecture: off" }),
    ).toBeVisible();
  });

  it("names everything a removal deletes before it removes a plugin", () => {
    render(
      <CapabilityLibrary
        plugins={[{ ...engineering, id: "copy", source: "personal" }]}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(
      screen.getByText(
        "Removing it deletes its 2 skills, 1 specialist and 2 connectors, and the access tokens its connectors use. This cannot be undone.",
      ),
    ).toBeVisible();
  });

  it("creates a new plugin from a name and description", async () => {
    const onCreatePlugin = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        pluginActions={{ ...pluginActions, create: onCreatePlugin }}
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

  it("asks for a plugin's name without emoji before creating it", async () => {
    const onCreatePlugin = vi.fn(async () => undefined);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        pluginActions={{ ...pluginActions, create: onCreatePlugin }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));
    const dialog = await screen.findByRole("dialog", { name: "New plugin" });
    const name = within(dialog).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Weather ☀️" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "Weather tools." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create plugin" }),
    );

    expect(
      await within(dialog).findByText("A name can't contain emoji."),
    ).toBeVisible();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(onCreatePlugin).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Weather" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create plugin" }),
    );
    await waitFor(() =>
      expect(onCreatePlugin).toHaveBeenCalledWith("Weather", "Weather tools."),
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
        shellChecks={{
          check: async () => ({
            available: false,
            reason: "No shell was found.",
            installUrl: "https://git-scm.com/download/win",
          }),
          recheck: onRecheckShell,
        }}
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

  it("says why commands cannot run where no install would help, offering nothing to do", async () => {
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        shellChecks={{
          ...shellChecks,
          check: async () => ({
            available: false,
            reason:
              "Zhiyin cannot contain what a command starts on this computer, so it runs none. Access is denied.",
          }),
        }}
      />,
    );

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(
      "Shell commands are unavailable. Zhiyin cannot contain what a command starts on this computer, so it runs none. Access is denied.",
    );
    expect(within(notice).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows no shell notice once the shell is available", async () => {
    const onCheckShell = vi.fn(shellChecks.check);
    render(
      <CapabilityLibrary
        plugins={[engineering]}
        {...handlers}
        shellChecks={{ ...shellChecks, check: onCheckShell }}
      />,
    );
    // The reading has answered before its absence is checked.
    await waitFor(() => expect(onCheckShell).toHaveBeenCalled());
    await act(async () => {});

    expect(
      screen.queryByText(/Shell commands are unavailable/),
    ).not.toBeInTheDocument();
  });
});
