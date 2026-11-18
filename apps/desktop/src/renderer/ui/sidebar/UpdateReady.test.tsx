/**
 * The sidebar says when an update is ready (ADR 0027), and nothing before.
 * Restarting is the core's to allow; its refusal is shown where the person
 * pressed.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateReady } from "./UpdateReady.js";

const running = { version: "0.1.0-alpha.1", checks: true } as const;

describe("an update ready, in the sidebar", () => {
  it("names the version and restarts into it", () => {
    const onRestart = vi.fn(async () => undefined);
    render(
      <UpdateReady
        update={{
          ...running,
          phase: { kind: "ready", version: "0.1.0-alpha.2" },
        }}
        onRestart={onRestart}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Zhiyin 0.1.0-alpha.2 is ready",
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));

    expect(onRestart).toHaveBeenCalled();
  });

  it("shows why Zhiyin did not restart", async () => {
    render(
      <UpdateReady
        update={{
          ...running,
          phase: { kind: "ready", version: "0.1.0-alpha.2" },
        }}
        onRestart={async () => {
          throw new Error(
            "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
          );
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conversation is still working. Zhiyin can restart once it has finished or been stopped.",
    );
  });

  it("says nothing until an update is ready", () => {
    const { container } = render(
      <UpdateReady
        update={{
          ...running,
          phase: {
            kind: "downloading",
            version: "0.1.0-alpha.2",
            fraction: 0.5,
          },
        }}
        onRestart={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("cannot be pressed again while Zhiyin restarts", () => {
    render(
      <UpdateReady
        update={{
          ...running,
          phase: { kind: "restarting", version: "0.1.0-alpha.2" },
        }}
        onRestart={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  });
});
