import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryRecoveryGate } from "./HistoryRecoveryGate.js";

const partial = {
  readable: 5,
  waiting: 0,
  damaged: 2,
  keptAt: "damaged-history/workspace-2026-09-10.json",
};

const waitingOnly = {
  readable: 0,
  waiting: 3,
  damaged: 1,
  keptAt: "damaged-history/workspace-2026-09-10.json",
};

const nothingReadable = {
  readable: 0,
  waiting: 0,
  damaged: 0,
  keptAt: "damaged-history/workspace-2026-09-10.json",
};

describe("HistoryRecoveryGate", () => {
  it("says how many conversations survived and how many did not", () => {
    render(<HistoryRecoveryGate recovery={partial} onChoose={vi.fn()} />);

    expect(
      screen.getByText(/5 conversations can still be opened/),
    ).toBeTruthy();
    expect(screen.getByText(/2 conversations cannot be read\./)).toBeTruthy();
  });

  it("says in a sentence of its own which conversations cannot be read", () => {
    const { container } = render(
      <HistoryRecoveryGate recovery={waitingOnly} onChoose={vi.fn()} />,
    );

    expect(container.textContent).toMatch(
      /3 conversations were saved by another version of Zhiyin and wait for an update\. 1 conversation cannot be read\. Nothing has been changed yet/,
    );
  });

  it("speaks of a single kept conversation as one", () => {
    render(
      <HistoryRecoveryGate
        recovery={{ ...partial, readable: 1, damaged: 0 }}
        onChoose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Zhiyin opens empty. The conversation stays in the kept copy, but Zhiyin will not show it.",
      ),
    ).toBeVisible();
  });

  it("speaks of a single conversation that cannot be read as one", () => {
    render(
      <HistoryRecoveryGate
        recovery={{ ...partial, readable: 3, damaged: 1 }}
        onChoose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("The one that cannot be read stays in the kept copy."),
    ).toBeVisible();
  });

  it("offers to open what survived", async () => {
    const choose = vi.fn(async () => {});
    render(<HistoryRecoveryGate recovery={partial} onChoose={choose} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Open the 5 conversations/ }),
    );

    await waitFor(() => expect(choose).toHaveBeenCalledWith("recover"));
  });

  it("counts conversations another version saved as waiting, not lost, and offers to keep them", async () => {
    const choose = vi.fn(async () => {});
    render(<HistoryRecoveryGate recovery={waitingOnly} onChoose={choose} />);

    expect(
      screen.getByText(
        /3 conversations were saved by another version of Zhiyin and wait for an update/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep the 3 conversations waiting for an update",
      }),
    );
    expect(
      screen.getByText(
        "The other one stays in the kept copy, and Zhiyin will not show it. The 3 waiting for an update stay where they are.",
      ),
    ).toBeVisible();

    await waitFor(() => expect(choose).toHaveBeenCalledWith("recover"));
  });

  it("counts as kept only the conversations that are not waiting, when some can still be opened", () => {
    render(
      <HistoryRecoveryGate
        recovery={{ ...partial, waiting: 1 }}
        onChoose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "The 2 that cannot be read stay in the kept copy. The 1 waiting for an update stays where it is.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The other 7 stay in the kept copy, and Zhiyin will not show them. The 1 waiting for an update stays where it is.",
      ),
    ).toBeVisible();
  });

  it("says nothing of conversations that cannot be read when only the settings are damaged", () => {
    const { container } = render(
      <HistoryRecoveryGate
        recovery={{ ...partial, damaged: 0 }}
        onChoose={vi.fn()}
      />,
    );

    expect(container.textContent).toMatch(
      /5 conversations can still be opened\. Nothing has been changed yet/,
    );
    expect(container.textContent).not.toMatch(/0 conversations/);
  });

  it("does not offer to recover conversations when none could be read", () => {
    render(
      <HistoryRecoveryGate recovery={nothingReadable} onChoose={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: /^Open the/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start with a clean slate" }),
    ).toBeTruthy();
  });

  it("never asks anybody to find or repair a file", () => {
    const { container } = render(
      <HistoryRecoveryGate recovery={partial} onChoose={vi.fn()} />,
    );

    expect(container.textContent).not.toMatch(
      /repair|restore the file|\.json/i,
    );
  });

  it("says the original is kept, whichever choice is offered", () => {
    const { container } = render(
      <HistoryRecoveryGate recovery={nothingReadable} onChoose={vi.fn()} />,
    );

    expect(container.textContent).toMatch(/kept safely aside/);
  });

  it("says what each choice does with the conversations", () => {
    render(<HistoryRecoveryGate recovery={partial} onChoose={vi.fn()} />);

    expect(
      screen.getByText("The 2 that cannot be read stay in the kept copy."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Zhiyin opens empty. All 7 stay in the kept copy, but Zhiyin will not show them.",
      ),
    ).toBeVisible();
  });

  it("says once, in the page itself, that nothing has been deleted", () => {
    const { container } = render(
      <HistoryRecoveryGate recovery={partial} onChoose={vi.fn()} />,
    );

    expect(container.textContent?.match(/Nothing has been/g)).toHaveLength(1);
  });

  it("shows the kept copy where it is, when asked", () => {
    const onShowKept = vi.fn(async () => {});
    render(
      <HistoryRecoveryGate
        recovery={partial}
        onChoose={vi.fn()}
        onShowKept={onShowKept}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the kept copy" }));

    expect(onShowKept).toHaveBeenCalledWith(partial.keptAt);
  });

  it("says so when the kept copy cannot be shown", async () => {
    render(
      <HistoryRecoveryGate
        recovery={partial}
        onChoose={vi.fn()}
        onShowKept={async () => {
          throw new Error("The folder could not be opened.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the kept copy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The folder could not be opened.",
    );
  });

  it("shows both choices as busy while one is being carried out", () => {
    let settle = () => {};
    render(
      <HistoryRecoveryGate
        recovery={partial}
        onChoose={() =>
          new Promise<void>((resolve) => {
            settle = resolve;
          })
        }
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Open the 5 conversations/ }),
    );

    expect(screen.getByRole("button", { name: "Restoring…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Start with a clean slate" }),
    ).toBeDisabled();
    settle();
  });

  it("says nothing was changed when the choice could not be carried out, and lets it be tried again", async () => {
    render(
      <HistoryRecoveryGate
        recovery={partial}
        onChoose={async () => {
          throw new Error("still damaged");
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Start with a clean slate" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "have not been changed",
    );
    expect(
      screen.getByRole("button", { name: "Start with a clean slate" }),
    ).toBeEnabled();
  });
});
