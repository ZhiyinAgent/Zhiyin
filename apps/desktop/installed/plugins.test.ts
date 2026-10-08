/**
 * The shipped plugins, in the real app.
 *
 * Every other test composes the catalog out of parts or reads it straight from
 * the repository. Only the launched app answers whether the packages that ship
 * with it are found where the app looks for them — the kind of thing that goes
 * wrong once, silently, and leaves a person with an empty Plugins page.
 */

import { describe, it, afterEach, expect } from "vitest";
import type { SavedWorkspace } from "@zhiyin/session";
import {
  closeEverything,
  launch,
  plantHistory,
  shows,
  temporaryDataDirectory,
  type Launched,
} from "./launch.js";

afterEach(closeEverything);

const onboarded = JSON.stringify({
  preferences: { onboarded: true, interests: ["engineering"] },
  recentWorkspaces: [],
  selectedTaskId: null,
  tasks: [],
} satisfies SavedWorkspace);

async function openPlugins() {
  const dataDirectory = await temporaryDataDirectory();
  await plantHistory(dataDirectory, onboarded);
  const launched = await launch({ dataDirectory });
  await launched.window
    .getByRole("button", { name: /Plugins/ })
    .first()
    .click();
  await shows(
    launched.window.getByRole("heading", { name: "Plugins" }),
    "the Plugins page",
  );
  return launched;
}

/** Opens the Publishing plugin after its local compiler setup is available. */
async function openPublishing(window: Launched["window"]) {
  await window
    .getByRole("button", { name: /Technical/ })
    .first()
    .click();
  const details = window.getByRole("region", {
    name: "Technical & Academic Publishing details",
  });
  await details
    .getByRole("listitem")
    .filter({ hasText: "Document compiler" })
    .getByRole("button", { name: "Set up" })
    .waitFor({ state: "visible", timeout: 120_000 });
  return details;
}

describe("the plugins the app ships with", () => {
  it("finds its own catalog and shows every vertical with its components", async () => {
    const { window } = await openPlugins();

    for (const name of [
      "Full-Stack Software Engineering",
      "Technical & Academic Publishing",
      "Data Science & Business Intelligence",
      "Deep Research & Synthesis",
    ])
      await shows(window.getByRole("button", { name: new RegExp(name) }), name);

    // The plugin that is open shows its own components, not a promise of them.
    const details = window.getByRole("region", {
      name: "Full-Stack Software Engineering details",
    });
    await shows(
      details.getByText("Test driven development"),
      "a shipped skill",
    );
    await shows(details.getByText("Code reviewer"), "a shipped specialist");
    await shows(details.getByText("GitHub"), "a shipped connector");
  });

  it("keeps connector settings reachable without claiming an unsaved token was refused", async () => {
    const { window } = await openPlugins();

    const details = await openPublishing(window);

    // The remote endpoint may accept an anonymous connection or require a
    // token. Neither state means a token nobody saved was refused.
    const connector = details
      .getByRole("listitem")
      .filter({ hasText: "alphaXiv" });
    await shows(connector.getByRole("switch"), "the connector's switch");
    expect(await connector.textContent()).not.toMatch(/token (was )?refused/i);
    await shows(
      details.getByRole("button", { name: /^(Set up|Settings) alphaXiv$/ }),
      "the connector's settings",
    );
  });

  it("states what installing a connector's programs would download, before installing anything", async () => {
    const { window } = await openPlugins();

    const details = await openPublishing(window);
    await details
      .getByRole("listitem")
      .filter({ hasText: "Document compiler" })
      .getByRole("button", { name: "Set up" })
      .click();

    const dialog = window.getByRole("dialog", {
      name: "Set up Document compiler",
    });
    await shows(
      dialog.getByText("What gets downloaded"),
      "that something would be downloaded",
    );
    await shows(dialog.getByText(/^\d+ MB$/).first(), "the download size");
    await shows(dialog.getByText("Typst 0.15.1"), "which Typst version");
    await shows(
      dialog.getByText("github.com/typst/typst"),
      "where Typst comes from",
    );
    await shows(
      dialog.getByText("github.com/tectonic-typesetting/tectonic"),
      "where Tectonic comes from",
    );
    await shows(
      dialog.getByText(/checked against its published fingerprint/),
      "that a download is verified before it runs",
    );
    await shows(
      dialog.getByRole("button", { name: "Not now" }),
      "the way to decline",
    );
  });
});
