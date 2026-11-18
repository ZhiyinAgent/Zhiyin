import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  CoreApi,
  PluginState,
  ProviderSettings,
  ProviderSummary,
} from "@zhiyin/contract";
import {
  createWindowState,
  windowReducer,
  type WindowState,
} from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

const pages = {
  keys: "https://openrouter.ai/settings/keys",
  billing: "https://openrouter.ai/settings/credits",
};

/** A model chosen on OpenRouter, with its key saved. */
const ready: ProviderSettings = {
  provider: { id: "openrouter", name: "OpenRouter", upstreams: true, pages },
  model: "anthropic/claude-sonnet-5",
  modelName: "Anthropic: Claude Sonnet 5",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

const openRouter: readonly ProviderSummary[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    upstreams: true,
    accounts: [{ credential: { status: "missing", source: "none" }, pages }],
  },
];

function plugin(name: string, prompts: readonly string[], enabled = true) {
  return {
    id: name.toLowerCase(),
    name,
    version: "1.0.0",
    description: "",
    category: "",
    publisher: "Zhiyin",
    source: "built-in",
    editing: "override",
    rollbackAvailable: false,
    enabled,
    status: enabled ? "ready" : "off",
    defaultPrompts: prompts,
    components: [],
  } satisfies PluginState;
}

function shell(
  initial: Partial<Parameters<typeof createWindowState>[0]>,
  commands: Partial<CoreApi> = {},
) {
  function Live() {
    const [state, dispatch] = useReducer(
      windowReducer,
      createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        ...initial,
      }),
    );
    return (
      <WindowShell
        state={state}
        dispatch={dispatch}
        commands={{ ...stubCommands, ...commands }}
      />
    );
  }
  render(<Live />);
}

describe("a first run", () => {
  it("connects a model as onboarding's second step, with the Model page's commands", async () => {
    const saveProviderApiKey = vi.fn<CoreApi["saveProviderApiKey"]>(
      async () => ({ status: "accepted" }),
    );
    const configureProfile = vi.fn<
      (interests: readonly string[]) => Promise<void>
    >(async () => {});
    // No look is known yet in this window, so the model step is the last.
    shell(
      { preferences: { onboarded: false, interests: [] } },
      {
        configureProfile,
        listProviders: async () => openRouter,
        saveProviderApiKey,
      },
    );

    expect(screen.getByText(/Step 1 of 2/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Connect an AI model" }),
    ).toBeVisible();
    expect(screen.getByText("STEP 2 OF 2")).toBeVisible();
    fireEvent.change(await screen.findByLabelText("Key"), {
      target: { value: "sk-or-v1-first" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(saveProviderApiKey).toHaveBeenCalledWith("sk-or-v1-first", {
        provider: "openrouter",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));
    await waitFor(() => expect(configureProfile).toHaveBeenCalledWith([]));
  });

  it("offers the same three parts on the new-task page while no model can answer", async () => {
    shell({}, { listProviders: async () => openRouter });

    const setup = screen.getByRole("region", { name: "Connect an AI model" });
    expect(
      await within(setup).findByRole("combobox", { name: "Provider" }),
    ).toBeVisible();
    expect(within(setup).getByLabelText("Key")).toBeVisible();
    expect(
      within(setup).getByText(
        "OpenRouter’s models are listed once its key is saved.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Ways to begin" })).toBeNull();
  });
});

describe("the new-task page", () => {
  const withPlugins: Partial<WindowState> = {
    provider: ready,
    plugins: [
      plugin("Engineering", ["Review this project.", "Fix this test."]),
      plugin("Research", ["Research this question."]),
      plugin("Publishing", ["Typeset these notes."], false),
      plugin("Notes", []),
    ],
  };

  it("offers the first way to begin of each plugin that is on, and fills the message with it rather than sending", () => {
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const createTask = vi.fn<CoreApi["createTask"]>(async () => "task-1");
    shell(withPlugins, { sendMessage, createTask });

    const ways = screen.getByRole("list", { name: "Ways to begin" });
    expect(
      within(ways)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "EngineeringReview this project.",
      "ResearchResearch this question.",
    ]);
    fireEvent.click(within(ways).getByRole("button", { name: /Research/ }));

    const field = screen.getByLabelText("Message Zhiyin");
    expect(field).toHaveValue("Research this question.");
    expect(field).toHaveFocus();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("names the model that answers at the foot of the sidebar", () => {
    shell(withPlugins);

    expect(
      within(screen.getByRole("navigation", { name: "Zhiyin" })).getByRole(
        "button",
        { name: "Model: Anthropic: Claude Sonnet 5" },
      ),
    ).toBeVisible();
  });
});

describe("a window that cannot start tasks", () => {
  it("says so in the composer, with the next step the report above offers", () => {
    shell(
      {
        provider: ready,
        runtime: { tasks: "unavailable", capabilities: "available" },
        issues: [{ message: "Zhiyin could not start its task runner." }],
      },
      { frontendReady: async () => {} },
    );

    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(
      screen.getByText(
        "Zhiyin can’t start tasks right now. Use Try again above.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
