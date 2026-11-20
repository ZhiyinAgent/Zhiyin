/** A connector to set up, asked for in the conversation and opened in Plugins. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";
import {
  emptyConversationLists,
  type CoreApi,
  type PluginState,
  type SetupSuggestion,
} from "@zhiyin/contract";
import { WindowShell } from "./WindowShell.js";
import {
  createWindowState,
  windowReducer,
  type TaskAction,
  type WindowState,
} from "./windowState.js";
import { stubCommands } from "../../stubCommands.js";

function plugin(id: string, name: string, enabled: boolean): PluginState {
  return {
    id,
    name,
    version: "1.0.0",
    description: `The ${name} plugin.`,
    category: "Research",
    publisher: "Zhiyin",
    source: "built-in",
    enabled,
    editing: "override",
    status: enabled ? "partial" : "off",
    rollbackAvailable: false,
    defaultPrompts: [],
    components: [
      {
        id: `${id}/sources`,
        kind: "skill",
        name: "sources",
        description: "Find sources.",
        enabled: true,
        status: "ready",
        editing: "override",
      },
      {
        id: `${id}/tavily`,
        kind: "connection",
        name: "Tavily",
        description: "Searches the web.",
        enabled: true,
        status: "setup-required",
        editing: "none",
        setup: { url: "https://app.tavily.com/home", keyName: "API key" },
      },
    ],
  };
}

const tavily: SetupSuggestion = {
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
};

/** A finished turn that showed this card, and Plugins as the core listed them. */
function conversation(setup: SetupSuggestion): WindowState {
  return {
    ...createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      selectedTaskId: "task-1",
      tasks: [
        {
          id: "task-1",
          title: "Tide times",
          updatedLabel: "Now",
          updatedAt: "2026-11-20T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [
            { id: "m1", role: "user", text: "Search the web.", sequence: 0 },
            {
              id: "m2",
              role: "assistant",
              text: "Switch on Research and add a Tavily key.",
              sequence: 2,
            },
          ],
          actions: [
            {
              id: "action-1",
              action: "Suggest setting up Tavily",
              target: "Tavily",
              toolName: "suggest_setup",
              readOnly: true,
              setup,
              status: "completed",
              sequence: 1,
            } as TaskAction,
          ],
          phase: {
            kind: "completed",
            outcome: { title: "Done", summary: "Asked for the key." },
          },
        },
      ],
    }),
    pluginDirectory: "ready",
    plugins: [
      plugin("engineering", "Engineering", true),
      plugin("research", "Research", false),
    ],
  };
}

function Live({ initial }: { initial: WindowState }) {
  const [state, dispatch] = useReducer(windowReducer, initial);
  return (
    <WindowShell
      state={state}
      dispatch={dispatch}
      commands={stubCommands as CoreApi}
    />
  );
}

describe("a connector to set up, in the conversation", () => {
  it("shows a card under the turn naming each step in Zhiyin's words, with one button to the plugin's page", () => {
    render(<Live initial={conversation(tavily)} />);

    const card = screen.getByRole("region", { name: "Set up Tavily" });
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Switch on Research.", "Add Tavily's API key."]);
    expect(card).toHaveTextContent(
      "Sign in, then copy your API key from the dashboard.",
    );
    expect(within(card).getAllByRole("button")).toHaveLength(1);
  });

  it("opens that plugin's page in Plugins with its connectors in focus, from the keyboard", () => {
    render(<Live initial={conversation(tavily)} />);

    const open = screen.getByRole("button", {
      name: "Open Research in Plugins",
    });
    open.focus();
    expect(open).toHaveFocus();
    fireEvent.click(open);

    const page = screen.getByRole("region", { name: "Research details" });
    expect(page).toBeVisible();
    const connectors = within(page).getByRole("region", { name: "Connectors" });
    expect(connectors).toHaveFocus();
    expect(connectors).toHaveTextContent("Tavily");
  });

  it("asks only to switch a connector on when that is all it needs, saying nothing of its key", () => {
    render(
      <Live
        initial={conversation({
          plugin: { id: "research", name: "Research" },
          connector: {
            ...tavily.connector!,
            needs: "switched-off",
          },
        })}
      />,
    );

    const card = screen.getByRole("region", { name: "Switch on Tavily" });
    expect(card).toHaveTextContent("Switch Tavily on.");
    expect(card).not.toHaveTextContent("API key");
  });

  it("asks only to switch on a plugin when that is all that is missing", () => {
    render(
      <Live
        initial={conversation({
          plugin: { id: "research", name: "Research", switchedOff: true },
        })}
      />,
    );

    const card = screen.getByRole("region", { name: "Switch on Research" });
    expect(card).toHaveTextContent("Switch on Research.");
    expect(within(card).queryAllByRole("listitem")).toEqual([]);
  });
});
