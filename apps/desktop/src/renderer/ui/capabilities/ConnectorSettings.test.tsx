import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  McpServerState,
  McpSignInOutcome,
  PluginComponentState,
} from "@zhiyin/contract";
import { ConnectorSettings } from "./ConnectorSettings.js";

const github: PluginComponentState = {
  id: "engineering/github",
  kind: "connection",
  name: "GitHub",
  description: "Works with repositories.",
  enabled: true,
  status: "setup-required",
  editing: "none",
  access: "Acts with what the token allows.",
  setup: {
    url: "https://github.com/settings/personal-access-tokens/new",
    keyName: "personal access token",
    advice: "Choose only the repositories Zhiyin should work with.",
  },
};

const server = (overrides: Partial<McpServerState> = {}): McpServerState => ({
  id: "engineering/github",
  name: "GitHub",
  url: "https://api.githubcopilot.com/mcp/",
  enabled: true,
  status: "unauthorized",
  toolCount: 0,
  tools: [],
  credential: { status: "none" },
  ...overrides,
});

function open(
  state: McpServerState | undefined,
  component: PluginComponentState = github,
  onOpenExternalUrl = vi.fn(async () => undefined),
  signIn: {
    readonly onSignIn?: () => Promise<McpSignInOutcome>;
    readonly onCancelSignIn?: () => Promise<void>;
    readonly onClearToken?: () => Promise<void>;
  } = {},
) {
  render(
    <ConnectorSettings
      component={component}
      server={state}
      onTest={async () => ({ ok: true, tools: [] })}
      onCheck={async () => state!}
      onSaveToken={async () => undefined}
      onClearToken={signIn.onClearToken ?? (async () => undefined)}
      onSignIn={signIn.onSignIn ?? (async () => ({ status: "signed-in" }))}
      onCancelSignIn={signIn.onCancelSignIn ?? (async () => undefined)}
      onSetToolEnabled={async () => undefined}
      onOpenExternalUrl={onOpenExternalUrl}
      onClose={() => undefined}
    />,
  );
  return { dialog: screen.getByRole("dialog"), onOpenExternalUrl };
}

describe("setting up a connector", () => {
  it("walks through making a key in three steps, on the service's own page, and says it can be skipped", async () => {
    const { dialog, onOpenExternalUrl } = open(server());

    const steps = within(
      within(dialog).getByRole("region", { name: "How to set up" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Create a personal access token on GitHub's site. Choose only the repositories Zhiyin should work with.Open GitHub",
      "Paste it below and save it.",
      "Test the connection.",
    ]);
    expect(
      within(dialog).getByText(
        "GitHub acts with whatever the personal access token allows. You can skip this connector: Zhiyin works without it.",
      ),
    ).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Open GitHub" }),
    );

    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(
      within(dialog).getByLabelText("Personal access token"),
    ).toBeVisible();
    await within(dialog).findByText(/needs a personal access token/);
  });

  it("with no key, says which key it needs before it can be used", async () => {
    const { dialog } = open(server());

    expect(
      await within(dialog).findByText(
        "This connector needs a personal access token before it can be used.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("Not saved")).toBeVisible();
  });

  it("names an API key with the article it takes", async () => {
    const { dialog } = open(server({ id: "research/tavily", name: "Tavily" }), {
      ...github,
      id: "research/tavily",
      name: "Tavily",
      setup: { url: "https://app.tavily.com/home", keyName: "API key" },
    });

    expect(
      await within(dialog).findByText(
        "This connector needs an API key before it can be used.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/^Create an API key on Tavily's site\./),
    ).toBeVisible();
  });

  it("with a refused key, says to check its permissions or expiry, and shows again how to make one", async () => {
    const { dialog } = open(server({ credential: { status: "saved" } }));

    expect(
      await within(dialog).findByText(
        "GitHub refused the saved personal access token. It may have expired, been deleted, or lack a permission; make a new one and paste it below.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("Saved")).toBeVisible();
    expect(
      within(dialog).getByRole("region", { name: "How to set up" }),
    ).toBeVisible();
  });

  it("when the service does not answer, says to try later without asking for the key again", async () => {
    const { dialog } = open(
      server({
        status: "failed",
        reason: "The server could not be reached.",
        credential: { status: "saved" },
      }),
    );

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(
      "The server could not be reached. Try again later. Your saved personal access token is kept.",
    );
    expect(alert).not.toHaveTextContent(/paste/i);
    expect(
      within(dialog).queryByRole("region", { name: "How to set up" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("when switched off, says how to switch it on, and that this allows nothing by itself", () => {
    const { dialog } = open(server({ enabled: false }), {
      ...github,
      enabled: false,
      status: "off",
    });

    expect(
      within(dialog).getByText(
        "This connector is off. Turn it on in the plugin's list to use it. Turning it on allows nothing by itself: Zhiyin still asks before each action it takes, unless you allow that action for the conversation.",
      ),
    ).toBeVisible();
  });

  it("calls a connection that answered connected, not ready", async () => {
    const { dialog } = open(
      server({
        status: "connected",
        checkedAt: Date.now(),
        credential: { status: "saved" },
      }),
    );

    expect(
      await within(dialog).findByText("Connected · checked just now"),
    ).toBeVisible();
    expect(within(dialog).getByText("Saved")).toBeVisible();
  });

  it("tells how to take a saved key back, beyond removing it here", () => {
    const { dialog } = open(
      server({ status: "connected", credential: { status: "saved" } }),
    );

    fireEvent.click(within(dialog).getByText("Taking the key back"));

    expect(
      within(dialog).getByText(
        "Remove saved token only makes Zhiyin forget it. To stop it working anywhere, delete it on GitHub's site.",
      ),
    ).toBeVisible();
  });
});

/** A connector a person added, whose service has the standard sign-in. */
const tracker: PluginComponentState = {
  id: "work/tracker",
  kind: "connection",
  name: "Tracker",
  description: "Reads and files issues.",
  enabled: true,
  status: "setup-required",
  editing: "none",
};

const trackerServer = (
  overrides: Partial<McpServerState> = {},
): McpServerState =>
  server({
    id: "work/tracker",
    name: "Tracker",
    url: "https://mcp.tracker.example/mcp",
    signIn: true,
    ...overrides,
  });

describe("signing in to a connector", () => {
  it("offers to sign in, instead of asking for a key, when the service has its own sign-in", async () => {
    const { dialog } = open(trackerServer(), tracker);

    expect(await within(dialog).findByText("Sign in to Tracker")).toBeVisible();
    expect(
      within(dialog).getByText(
        "Opens its sign-in page in your browser. There is nothing to copy.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(within(dialog).queryByLabelText("Access token")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("lets the person choose a key instead, and only then asks for it", async () => {
    const { dialog } = open(server({ signIn: true }));

    await within(dialog).findByText("Sign in to GitHub");
    expect(
      within(dialog).getByRole("radio", { name: /Sign in with an account/ }),
    ).toBeChecked();
    expect(within(dialog).queryByLabelText("Personal access token")).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("radio", { name: /Paste an access token/ }),
    );

    expect(
      within(dialog).getByLabelText("Personal access token"),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("region", { name: "How to set up" }),
    ).toBeVisible();
    expect(within(dialog).queryByText("Sign in to GitHub")).toBeNull();
  });

  it("while the browser is open, says to finish there and lets the person cancel", async () => {
    let finish!: (outcome: McpSignInOutcome) => void;
    const onCancelSignIn = vi.fn(async () => {
      finish({ status: "cancelled" });
    });
    const { dialog } = open(trackerServer(), tracker, undefined, {
      onSignIn: () => new Promise((resolve) => (finish = resolve)),
      onCancelSignIn,
    });

    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Sign in" }),
    );

    expect(
      await within(dialog).findByText("Waiting for your browser"),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "Finish signing in to Tracker there, then come back here.",
      ),
    ).toBeVisible();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    expect(onCancelSignIn).toHaveBeenCalledOnce();
    expect(
      await within(dialog).findByRole("button", { name: "Sign in" }),
    ).toBeVisible();
    expect(within(dialog).queryByText("Waiting for your browser")).toBeNull();
  });

  it("says why a sign-in failed, and offers to try again", async () => {
    const { dialog } = open(trackerServer(), tracker, undefined, {
      onSignIn: async () => ({
        status: "failed",
        reason: "The sign-in was declined at mcp.tracker.example.",
      }),
    });

    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Sign in" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The sign-in was declined at mcp.tracker.example.",
    );
    expect(
      within(dialog).getByText("The sign-in did not finish"),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("shows a signed-in connector as signed in, with a way to sign out", async () => {
    const onClearToken = vi.fn(async () => undefined);
    const { dialog } = open(
      trackerServer({
        status: "connected",
        checkedAt: Date.now(),
        credential: { status: "signed-in" },
      }),
      tracker,
      undefined,
      { onClearToken },
    );

    expect(
      await within(dialog).findByText("Connected · checked just now"),
    ).toBeVisible();
    expect(within(dialog).getByText("Signed in to Tracker")).toBeVisible();
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).queryByLabelText("Access token")).toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    });

    expect(onClearToken).toHaveBeenCalledOnce();
  });
});
