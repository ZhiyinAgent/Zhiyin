import {
  CapabilityLibrary,
  ComponentEditor,
} from "../../ui/capabilities/index.js";
import { demoConnections, demoPlugins } from "../fixtures.js";
import { useState } from "react";
import type { ComponentCatalogEntry } from "./entry.js";

function ComponentEditorExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="button" type="button" onClick={() => setOpen(true)}>
        Open plugin component editor
      </button>
      {open && (
        <ComponentEditor
          draft={{
            kind: "skill",
            id: "release-notes",
            description: "Use when a release needs a concise public summary.",
            instructions:
              "Read the changes, group them by outcome, and cite checks.",
          }}
          onSave={async () => undefined}
          onRemove={async () => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export const capabilitiesEntries: ComponentCatalogEntry[] = [
  {
    id: "component-editor",
    title: "Plugin component editor",
    description:
      "The production editor for a reusable plugin component, with populated fields and removal available.",
    render: () => <ComponentEditorExample />,
  },
  {
    id: "library",
    title: "Plugin directory",
    description: "Every skill, specialist, and connector, grouped by plugin.",
    render: () => (
      <CapabilityLibrary
        plugins={demoPlugins}
        mcpServers={demoConnections}
        onClose={() => {}}
        onTogglePlugin={async () => {}}
        onInstallPlugin={async () => ({ status: "cancelled" })}
        onUpdatePlugin={async () => ({ status: "cancelled" })}
        onRollbackPlugin={async () => {}}
        onRemovePlugin={async () => {}}
        onCreatePlugin={async () => {}}
        onLoadEditableContents={async () => undefined}
        onSavePluginContents={async () => {}}
        onToggleComponent={async () => {}}
        onLoadComponentContent={async () => undefined}
        onOverrideComponent={async () => {}}
        onResetComponent={async () => {}}
        onInstallToolchain={async () => {}}
        onTestConnection={async () => ({
          ok: true,
          tools: [{ name: "search", description: "Search.", enabled: true }],
        })}
        onSetConnectionToolEnabled={async () => {}}
        onSaveConnectionToken={async () => {}}
        onClearConnectionToken={async () => {}}
        onRefreshConnections={async () => {}}
        onCheckShell={async () => ({ available: true })}
        onRecheckShell={async () => ({ available: true })}
        onOpenExternalUrl={async () => {}}
      />
    ),
  },
];
