/**
 * Updating Zhiyin, as Settings shows it (ADR 0027): the version running,
 * where an update stands in words, the switch that stops Zhiyin looking, and
 * the one button that fits the moment.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "@zhiyin/contract";
import { AppSettings } from "./AppSettings.js";

const looked = "2026-11-07T09:42:00.000Z";

function settings(
  appUpdate: AppUpdateState,
  handlers: {
    onAppUpdateChecks?: (enabled: boolean) => Promise<void>;
    onCheckForAppUpdate?: () => Promise<void>;
    onRestartToUpdate?: () => Promise<void>;
  } = {},
) {
  render(
    <AppSettings
      notifications={false}
      appUpdate={appUpdate}
      onAppUpdateChecks={handlers.onAppUpdateChecks ?? (async () => undefined)}
      onCheckForAppUpdate={
        handlers.onCheckForAppUpdate ?? (async () => undefined)
      }
      onRestartToUpdate={handlers.onRestartToUpdate ?? (async () => undefined)}
      onClose={vi.fn()}
    />,
  );
}

const running = { version: "0.1.0-alpha.1", checks: true } as const;

describe("updates in Settings", () => {
  it("names the version running and says it is up to date, with a way to look now", async () => {
    const onCheckForAppUpdate = vi.fn(async () => undefined);
    settings(
      {
        ...running,
        phase: { kind: "idle" },
        lastLook: { at: looked, outcome: "current" },
      },
      { onCheckForAppUpdate },
    );

    const check = screen.getByRole("button", { name: "Check now" });
    expect(check).toHaveAccessibleDescription(
      expect.stringMatching(/^Up to date, as of \d\d:\d\d\.$/),
    );
    expect(screen.getByText("Version 0.1.0-alpha.1")).toBeInTheDocument();
    fireEvent.click(check);

    await waitFor(() => expect(onCheckForAppUpdate).toHaveBeenCalled());
  });

  it("turns looking off with a switch that says what it sends", async () => {
    const onAppUpdateChecks = vi.fn(async () => undefined);
    settings({ ...running, phase: { kind: "idle" } }, { onAppUpdateChecks });

    const toggle = screen.getByRole("switch", {
      name: "Look for newer versions",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(
      "Zhiyin looks on GitHub, or on its own site when GitHub cannot be reached, and installs only versions its makers signed. Nothing of yours is sent.",
    );
    fireEvent.click(toggle);

    await waitFor(() => expect(onAppUpdateChecks).toHaveBeenCalledWith(false));
  });

  it("offers no look while looking is off, and says so", () => {
    settings({ ...running, checks: false, phase: { kind: "idle" } });

    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    expect(
      screen.getByText("Zhiyin does not look for newer versions."),
    ).toBeInTheDocument();
  });

  it("shows how much of a download has arrived, with no button to press", () => {
    settings({
      ...running,
      phase: { kind: "downloading", version: "0.1.0-alpha.2", fraction: 0.42 },
    });

    expect(
      screen.getByText("Downloading version 0.1.0-alpha.2: 42%."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
  });

  it("says why no newer version could be used", () => {
    settings({
      ...running,
      phase: { kind: "idle" },
      lastLook: {
        at: looked,
        outcome: "failed",
        reason: "GitHub: The release's signature does not match it.",
      },
    });

    expect(
      screen.getByText(
        "No newer version could be used. GitHub: The release's signature does not match it.",
      ),
    ).toBeInTheDocument();
  });

  it("restarts into a ready update, and shows the core's refusal when it says no", async () => {
    settings(
      { ...running, phase: { kind: "ready", version: "0.1.0-alpha.2" } },
      {
        onRestartToUpdate: async () => {
          throw new Error(
            "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
          );
        },
      },
    );

    const restart = screen.getByRole("button", { name: "Restart to update" });
    expect(restart).toHaveAccessibleDescription(
      "Version 0.1.0-alpha.2 is ready. It installs when Zhiyin restarts.",
    );
    fireEvent.click(restart);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conversation is still working.",
    );
  });

  it("cannot be pressed twice while Zhiyin restarts", () => {
    settings({
      ...running,
      phase: { kind: "restarting", version: "0.1.0-alpha.2" },
    });

    expect(
      screen.getByRole("button", { name: "Restart to update" }),
    ).toBeDisabled();
  });

  it("is not shown where this copy does not update itself", () => {
    render(<AppSettings notifications={false} onClose={vi.fn()} />);

    expect(
      screen.queryByRole("heading", { name: "Updates" }),
    ).not.toBeInTheDocument();
  });
});
