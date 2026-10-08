import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedConversationsUpdate } from "./SavedConversationsUpdate.js";

const three = [
  { title: "Trip to Shanghai", writtenBy: "0.1.0-alpha.1" },
  { title: "Bakery website", writtenBy: "0.1.0-alpha.1" },
  { title: "Lease check", writtenBy: "0.1.0-alpha.2" },
];

describe("SavedConversationsUpdate", () => {
  it("offers to update, wait or delete", () => {
    render(
      <SavedConversationsUpdate
        waiting={three}
        onSettle={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /3 conversations were saved by an earlier version of Zhiyin \(0\.1\.0-alpha\.1, 0\.1\.0-alpha\.2\)/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update them" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete them…" })).toBeTruthy();
  });

  it("updates them and closes when every one was updated", async () => {
    const settle = vi.fn(async () => ({ done: 3, failed: 0 }));
    const close = vi.fn();
    render(
      <SavedConversationsUpdate
        waiting={three}
        onSettle={settle}
        onClose={close}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update them" }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(settle).toHaveBeenCalledWith("update");
  });

  it("asks before moving conversations to the Recycle Bin, saying how many", async () => {
    const settle = vi.fn(async () => ({ done: 3, failed: 0 }));
    render(
      <SavedConversationsUpdate
        waiting={three}
        onSettle={settle}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete them…" }));

    expect(settle).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Move 3 conversations to the Recycle Bin\?/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Update them" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete them…" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move to the Recycle Bin" }),
    );
    await waitFor(() => expect(settle).toHaveBeenCalledWith("recycle"));
  });

  it("says how many could not be updated", async () => {
    const close = vi.fn();
    render(
      <SavedConversationsUpdate
        waiting={three}
        onSettle={async () => ({ done: 2, failed: 1 })}
        onClose={close}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update them" }));

    expect(
      await screen.findByText(
        "2 conversations were updated. One could not be, and was left as it was.",
      ),
    ).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalled();
  });

  it("says nothing was changed when the answer could not be carried out", async () => {
    render(
      <SavedConversationsUpdate
        waiting={three.slice(0, 1)}
        onSettle={async () => {
          throw new Error("Another copy of the app is using this data.");
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update it" }));

    expect(
      await screen.findByText(
        "That could not be done. Your saved conversations have not been changed.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update it" })).toBeTruthy();
  });

  it("shows the work under way and accepts no second answer", async () => {
    let finish: (value: { done: number; failed: number }) => void = () => {};
    const settle = vi.fn(
      () =>
        new Promise<{ done: number; failed: number }>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <SavedConversationsUpdate
        waiting={three}
        onSettle={settle}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update them" }));

    const working = screen.getByRole("button", { name: "Updating…" });
    expect((working as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Later" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(working);
    expect(settle).toHaveBeenCalledTimes(1);
    finish({ done: 3, failed: 0 });
  });
});
