import {
  CapabilityLibrary,
  ComponentEditor,
  SetupCard,
  type ComponentActions,
  type ConnectionActions,
  type PluginActions,
  type ShellChecks,
} from "../../ui/capabilities/index.js";
import {
  demoCheck,
  demoComponentContent,
  demoConnections,
  demoImportedPlugin,
  demoPlugins,
} from "../fixtures.js";
import { useEffect, useRef, useState } from "react";
import type {
  ConnectionToolTreatment,
  McpServerState,
  McpSignInOutcome,
  SetupSuggestion,
  ToolchainState,
} from "@zhiyin/contract";

/** What the setup cards ask, as the capabilities group words them. */
const demoSetupCards: readonly SetupSuggestion[] = [
  {
    plugin: { id: "research", name: "Research", switchedOff: true },
    connector: {
      id: "research/tavily",
      name: "Tavily",
      needs: "key",
      setup: {
        url: "https://app.tavily.com/home",
        keyName: "API key",
        advice: "Sign in, then copy your API key from the dashboard.",
      },
    },
  },
  {
    plugin: { id: "engineering", name: "Full-Stack Software Engineering" },
    connector: {
      id: "engineering/browser",
      name: "Browser",
      needs: "install",
      detail:
        "No supported browser is installed. Tried Microsoft Edge and Google Chrome.",
    },
  },
  {
    plugin: {
      id: "publishing",
      name: "Technical & Academic Publishing",
      switchedOff: true,
    },
  },
];
import {
  demoCadInstalling,
  demoCadNotInstalled,
  demoCadPlugin,
  demoCadUpdate,
} from "../fixtures/capabilities.js";
import type { ComponentCatalogEntry } from "./entry.js";

function ComponentEditorExample() {
  const [open, setOpen] = useState<"saved" | "new">();

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="button"
          type="button"
          onClick={() => setOpen("saved")}
        >
          Open plugin component editor
        </button>
        <button className="button" type="button" onClick={() => setOpen("new")}>
          New skill
        </button>
      </div>
      {open === "new" && (
        <ComponentEditor
          draft={{
            kind: "skill",
            id: "",
            name: "",
            description: "",
            instructions: "",
          }}
          onSave={async () => undefined}
          onClose={() => setOpen(undefined)}
        />
      )}
      {open === "saved" && (
        <ComponentEditor
          draft={{
            kind: "skill",
            id: "release-notes",
            name: "release-notes",
            description: "Use when a release needs a concise public summary.",
            instructions:
              "Read the changes, group them by outcome, and cite checks.",
          }}
          onSave={async () => undefined}
          onRemove={async () => undefined}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

/**
 * A connector made in the app whose service has its own sign-in. Signing in
 * finishes after a moment unless cancelled; signing out undoes it. Once
 * signed in, each tool says how it is treated, which can be changed.
 */
function SignInConnectorExample() {
  const [open, setOpen] = useState<"new" | "saved">();
  const [filing, setFiling] =
    useState<ConnectionToolTreatment>("ask-each-time");
  const [account, setAccount] = useState<"signed-out" | "signed-in">(
    "signed-out",
  );
  const cancel = useRef<() => void>(() => {});

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="button" type="button" onClick={() => setOpen("new")}>
          New connector
        </button>
        <button
          className="button"
          type="button"
          onClick={() => setOpen("saved")}
        >
          A saved connector with its own sign-in
        </button>
      </div>
      {open === "new" && (
        <ComponentEditor
          draft={{
            kind: "connection",
            id: "",
            name: "Tracker",
            url: "https://mcp.tracker.example/mcp",
            access: "",
            dataDestination: "",
          }}
          onSave={async () => undefined}
          onTest={async () => ({
            ok: false,
            reason:
              "This service has its own sign-in. Save the connector, then sign in to it.",
            needs: "sign-in",
          })}
          onSignIn={() =>
            new Promise<McpSignInOutcome>((resolve) => {
              const finished = setTimeout(
                () => resolve({ status: "signed-in" }),
                3_000,
              );
              cancel.current = () => {
                clearTimeout(finished);
                resolve({ status: "cancelled" });
              };
            })
          }
          onCancelSignIn={async () => cancel.current()}
          onSignOut={async () => undefined}
          onClose={() => setOpen(undefined)}
        />
      )}
      {open === "saved" && (
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
            status: account === "signed-in" ? "connected" : "unauthorized",
            tools:
              account === "signed-in"
                ? [
                    { name: "file_issue", enabled: true, treatment: filing },
                    {
                      name: "list_issues",
                      description: "List the open issues.",
                      enabled: true,
                      treatment: "only-reads",
                    },
                    {
                      name: "export_everything",
                      description: "Export every record in the tracker.",
                      enabled: false,
                      treatment: "ask-once",
                      withheld:
                        "Not offered to the model: its input schema is 220 KB, more than the 64 KB a tool may have.",
                    },
                  ]
                : [],
            tokenSaved: false,
            account,
          }}
          onSave={async () => undefined}
          onSetToolEnabled={async () => undefined}
          onSetToolTreatment={async (tool, treatment) => {
            if (tool === "file_issue") setFiling(treatment);
          }}
          onSignIn={() =>
            new Promise<McpSignInOutcome>((resolve) => {
              const finished = setTimeout(() => {
                setAccount("signed-in");
                resolve({ status: "signed-in" });
              }, 3_000);
              cancel.current = () => {
                clearTimeout(finished);
                resolve({ status: "cancelled" });
              };
            })
          }
          onCancelSignIn={async () => cancel.current()}
          onSignOut={async () => setAccount("signed-out")}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

/**
 * The directory, where importing installs a sample plugin in place of a
 * folder, and signing in to the project board finishes after a moment unless
 * it is cancelled.
 */
function LibraryExample({
  initialConnections = demoConnections,
  opening,
}: {
  initialConnections?: McpServerState[];
  /** Opened at this plugin's connectors, as a setup card opens it. */
  opening?: string;
}) {
  const [plugins, setPlugins] = useState(demoPlugins);
  const [connections, setConnections] = useState(initialConnections);
  const latest = useRef(connections);
  useEffect(() => {
    latest.current = connections;
  }, [connections]);
  const cancelSignIn = useRef<() => void>(() => {});
  const signedIn = (server: McpServerState): McpServerState =>
    server.id === "engineering/board"
      ? {
          ...server,
          status: "connected",
          toolCount: 1,
          tools: [{ name: "move_card", enabled: true }],
          credential: { status: "signed-in" },
          checkedAt: Date.now(),
        }
      : server;
  return (
    <CapabilityLibrary
      opening={opening}
      plugins={plugins}
      mcpServers={connections}
      onTryPrompt={() => {}}
      onClose={() => {}}
      pluginActions={{
        ...demoPluginActions,
        install: async () => {
          setPlugins((current) =>
            current.some((plugin) => plugin.id === demoImportedPlugin.id)
              ? current
              : [...current, demoImportedPlugin],
          );
          return { status: "applied" };
        },
      }}
      componentActions={demoComponentActions}
      connectionActions={{
        ...demoConnectionActions,
        test: async () => ({
          ok: true,
          tools: [{ name: "search", description: "Search.", enabled: true }],
        }),
        clearToken: async (id) =>
          setConnections((current) =>
            current.map((server) =>
              server.id === id
                ? (demoConnections.find((item) => item.id === id) ?? server)
                : server,
            ),
          ),
        signIn: () =>
          new Promise<McpSignInOutcome>((resolve) => {
            const finished = setTimeout(() => {
              latest.current = latest.current.map(signedIn);
              setConnections(latest.current);
              resolve({ status: "signed-in" });
            }, 3_000);
            cancelSignIn.current = () => {
              clearTimeout(finished);
              resolve({ status: "cancelled" });
            };
          }),
        cancelSignIn: async () => cancelSignIn.current(),
        check: async (id) => {
          const server = latest.current.find((item) => item.id === id);
          return server?.credential.status === "signed-in"
            ? { ...server, checkedAt: Date.now() }
            : demoCheck(id);
        },
      }}
      shellChecks={demoShellChecks}
      onOpenExternalUrl={async () => {}}
    />
  );
}

/** A plugin page's actions that change nothing, for an example to replace one by one. */
const demoPluginActions: PluginActions = {
  toggle: async () => {},
  install: async () => ({ status: "cancelled" }),
  update: async () => ({ status: "cancelled" }),
  rollback: async () => {},
  remove: async () => {},
  create: async () => {},
  editableContents: async () => undefined,
  saveContents: async () => {},
};

const demoComponentActions: ComponentActions = {
  toggle: async () => {},
  content: demoComponentContent,
  override: async () => {},
  reset: async () => {},
  installToolchain: async () => {},
  cancelToolchainInstall: async () => {},
};

const demoConnectionActions: ConnectionActions = {
  test: async () => ({ ok: true, tools: [] }),
  setToolEnabled: async () => {},
  saveToken: async () => {},
  clearToken: async () => {},
  signIn: async () => ({ status: "cancelled" }),
  cancelSignIn: async () => {},
  refresh: async () => {},
  check: async (id) => demoCheck(id),
};

const demoShellChecks: ShellChecks = {
  check: async () => ({ available: true }),
  recheck: async () => ({ available: true }),
};

/**
 * The CAD studio's installation as a person goes through it: Set up asks
 * with the whole download, Install steps through making the environment, and
 * Cancel stops it, leaving it to set up as before.
 */
function CadInstallExample({ initial }: { initial: ToolchainState }) {
  const [toolchain, setToolchain] = useState(initial);
  const steps = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = () => {
    for (const step of steps.current) clearTimeout(step);
    steps.current = [];
  };
  useEffect(() => stop, []);
  const stage = (step: number): ToolchainState => ({
    status: "installing",
    stage: {
      name: [
        "Setting up Python",
        "Installing the packages",
        "Preparing the packages",
      ][step - 1] as string,
      step,
      steps: 3,
    },
  });
  return (
    <CapabilityLibrary
      plugins={[demoCadPlugin(toolchain)]}
      mcpServers={[]}
      onTryPrompt={() => {}}
      onClose={() => {}}
      pluginActions={demoPluginActions}
      componentActions={{
        ...demoComponentActions,
        installToolchain: async () => {
          stop();
          setToolchain(stage(1));
          steps.current = [
            setTimeout(() => setToolchain(stage(2)), 2_000),
            setTimeout(() => setToolchain(stage(3)), 5_000),
            setTimeout(() => setToolchain({ status: "ready" }), 7_000),
          ];
        },
        cancelToolchainInstall: async () => {
          stop();
          setToolchain(initial);
        },
      }}
      connectionActions={demoConnectionActions}
      shellChecks={demoShellChecks}
      onOpenExternalUrl={async () => {}}
    />
  );
}

/** GitHub as it stands before any key was given to it. */
const githubWithoutKey: McpServerState = {
  id: "engineering/github",
  name: "GitHub",
  url: "https://api.githubcopilot.com/mcp/",
  enabled: true,
  status: "unchecked",
  toolCount: 0,
  tools: [],
  credential: { status: "none" },
};

export const capabilitiesEntries: ComponentCatalogEntry[] = [
  {
    id: "component-editor",
    title: "Plugin component editor",
    description:
      "The production editor for a reusable plugin component, with populated fields and removal available.",
    render: () => <ComponentEditorExample />,
  },
  {
    id: "connector-sign-in",
    title: "Connector with its own sign-in",
    description:
      "An app-made connector whose service has the standard sign-in: not signed in, waiting for the browser (after Sign in), and signed in.",
    render: () => <SignInConnectorExample />,
  },
  {
    id: "library",
    title: "Plugin directory",
    description: "Every skill, specialist, and connector, grouped by plugin.",
    render: () => <LibraryExample />,
  },
  {
    id: "library-no-key",
    title: "Plugin directory, before GitHub is given its key",
    description:
      "Set up GitHub with no key saved: the steps and the field, no error before anything was tried, the key called a personal access token throughout, and Close at the foot.",
    render: () => (
      <LibraryExample
        initialConnections={demoConnections.map((server) =>
          server.id === githubWithoutKey.id ? githubWithoutKey : server,
        )}
      />
    ),
  },
  {
    id: "setup-cards",
    title: "Setup cards in the conversation",
    description:
      "What suggest_setup shows under a turn, every word Zhiyin's: Research switched off with Tavily waiting for its key, both steps on one card; the browser with no Edge or Chrome on this computer; a plugin switched off and nothing else. Each button opens that plugin's page at its connectors.",
    render: () => (
      <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        {demoSetupCards.map((suggestion) => (
          <SetupCard
            key={suggestion.connector?.id ?? suggestion.plugin.id}
            suggestion={suggestion}
            onOpen={() => {}}
          />
        ))}
      </div>
    ),
  },
  {
    id: "library-at-connectors",
    title: "Plugin directory, opened from a setup card",
    description:
      "Full-Stack Software Engineering opened at its connectors, which hold focus, as the card's button opens it.",
    render: () => <LibraryExample opening="engineering" />,
  },
  {
    id: "cad-install",
    title: "CAD studio, set up from nothing",
    description:
      "Set up lists uv, Python and the CAD packages at a reckoned size; Install steps through making the environment (about seven seconds) to ready, and Cancel stops it.",
    render: () => <CadInstallExample initial={demoCadNotInstalled} />,
  },
  {
    id: "cad-installing",
    title: "CAD studio, making its environment",
    description:
      "The step an installation that cannot count its bytes is on, with Cancel.",
    render: () => <CadInstallExample initial={demoCadInstalling} />,
  },
  {
    id: "cad-update",
    title: "CAD studio, after a release changed its packages",
    description:
      "The environment is from an earlier release: the connector asks to be updated.",
    render: () => <CadInstallExample initial={demoCadUpdate} />,
  },
  {
    id: "cad-failed",
    title: "CAD studio, when making its environment failed",
    description: "Why it failed, and Try again.",
    render: () => (
      <CadInstallExample
        initial={{
          status: "failed",
          reason:
            "The packages of the Python environment “cad” could not be installed.\nerror: Failed to fetch: `https://pypi.org/simple/build123d/`",
        }}
      />
    ),
  },
];
