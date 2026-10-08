import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryRecoveryGate } from "./HistoryRecoveryGate.js";

const partial = {
  readable: 5,
  damaged: 2,
  keptAt: "damaged-history/workspace-2026-09-10.json",
};

const nothingReadable = {
  readable: 0,
  damaged: 0,
  keptAt: "damaged-history/workspace-2026-09-10.json",
};

describe("HistoryRecoveryGate", () => {
  it("says how many conversations survived and how many did not", () => {
    render(<HistoryRecoveryGate recovery={partial} onChoose={vi.fn()} />);

    expect(
      screen.getByText(/5 conversations can still be opened/),
    ).toBeTruthy();
    expect(screen.getByText(/2 conversations cannot/)).toBeTruthy();
  });

  it("offers to open what survived", async () => {
    const choose = vi.fn(async () => {});
    render(<HistoryRecoveryGate recovery={partial} onChoose={choose} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Open the 5 conversations/ }),
    );

    await waitFor(() => expect(choose).toHaveBeenCalledWith("recover"));
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
    const onShowKept = vi.fn();
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
