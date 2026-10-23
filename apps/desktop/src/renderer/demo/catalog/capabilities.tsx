import {
  CapabilityLibrary,
  ComponentEditor,
} from "../../ui/capabilities/index.js";
import {
  demoCheck,
  demoComponentContent,
  demoConnections,
  demoImportedPlugin,
  demoPlugins,
} from "../fixtures.js";
import { useEffect, useRef, useState } from "react";
import type { McpServerState, McpSignInOutcome } from "@zhiyin/contract";
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
 * finishes after a moment unless cancelled; signing out undoes it.
 */
function SignInConnectorExample() {
  const [open, setOpen] = useState<"new" | "saved">();
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
                    { name: "file_issue", enabled: true },
                    {
                      name: "export_everything",
                      description: "Export every record in the tracker.",
                      enabled: false,
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
}: {
  initialConnections?: McpServerState[];
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
      plugins={plugins}
      mcpServers={connections}
      onClose={() => {}}
      onTogglePlugin={async () => {}}
      onInstallPlugin={async () => {
        setPlugins((current) =>
          current.some((plugin) => plugin.id === demoImportedPlugin.id)
            ? current
            : [...current, demoImportedPlugin],
        );
        return { status: "applied" };
      }}
      onUpdatePlugin={async () => ({ status: "cancelled" })}
      onRollbackPlugin={async () => {}}
      onRemovePlugin={async () => {}}
      onCreatePlugin={async () => {}}
      onLoadEditableContents={async () => undefined}
      onSavePluginContents={async () => {}}
      onToggleComponent={async () => {}}
      onLoadComponentContent={demoComponentContent}
      onOverrideComponent={async () => {}}
      onResetComponent={async () => {}}
      onInstallToolchain={async () => {}}
      onCancelToolchainInstall={async () => {}}
      onTestConnection={async () => ({
        ok: true,
        tools: [{ name: "search", description: "Search.", enabled: true }],
      })}
      onSetConnectionToolEnabled={async () => {}}
      onSaveConnectionToken={async () => {}}
      onClearConnectionToken={async (id) =>
        setConnections((current) =>
          current.map((server) =>
            server.id === id
              ? (demoConnections.find((item) => item.id === id) ?? server)
              : server,
          ),
        )
      }
      onSignInToConnection={() =>
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
        })
      }
      onCancelConnectionSignIn={async () => cancelSignIn.current()}
      onRefreshConnections={async () => {}}
      onCheckConnection={async (id) => {
        const server = latest.current.find((item) => item.id === id);
        return server?.credential.status === "signed-in"
          ? { ...server, checkedAt: Date.now() }
          : demoCheck(id);
      }}
      onCheckShell={async () => ({ available: true })}
      onRecheckShell={async () => ({ available: true })}
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
      "Set up GitHub with no key saved: the steps and the field, no error before anything was tried, and Done waiting for the key.",
    render: () => (
      <LibraryExample
        initialConnections={demoConnections.map((server) =>
          server.id === githubWithoutKey.id ? githubWithoutKey : server,
        )}
      />
    ),
  },
];
