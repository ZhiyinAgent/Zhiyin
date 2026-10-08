import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportConversationDialog } from "./ExportConversationDialog.js";

function renderDialog(
  onExport: (
    format: "html" | "json",
  ) => Promise<
    | { status: "saved"; destination: string }
    | { status: "cancelled" }
    | { status: "failed"; reason: string }
  >,
  more: { onShowInFolder?: (path: string) => void; onClose?: () => void } = {},
) {
  render(
    <ExportConversationDialog
      title="Prepare release notes"
      onExport={onExport}
      onShowInFolder={more.onShowInFolder}
      onClose={more.onClose ?? (() => undefined)}
    />,
  );
  return screen.getByRole("dialog", { name: "Export conversation" });
}

describe("ExportConversationDialog", () => {
  it("asks what to make of the conversation, saying what each file is for, and exports the chosen one", async () => {
    const onExport = vi.fn().mockResolvedValue({ status: "cancelled" });
    const dialog = renderDialog(onExport);

    expect(within(dialog).getByText("Prepare release notes")).toBeVisible();
    const page = within(dialog).getByRole("radio", { name: /A page to read/ });
    const data = within(dialog).getByRole("radio", { name: /Data to analyse/ });
    expect(page).toBeChecked();
    expect(
      within(dialog).getByText(/Opens in any browser, even offline/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/model requests and responses included/),
    ).toBeVisible();

    fireEvent.click(data);
    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(onExport).toHaveBeenCalledWith("json");
    expect(
      await within(dialog).findByRole("button", { name: "Export…" }),
    ).toBeEnabled();
  });

  it("says where the file was saved, and shows it in its folder", async () => {
    const onShowInFolder = vi.fn();
    const onClose = vi.fn();
    const destination = "C:\\Users\\sam\\Documents\\Prepare release notes.html";
    const dialog = renderDialog(
      async () => ({ status: "saved", destination }),
      { onShowInFolder, onClose },
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(await within(dialog).findByText("Saved")).toBeVisible();
    expect(within(dialog).getByTestId("path")).toHaveAttribute(
      "data-tip",
      destination,
    );
    expect(within(dialog).queryByRole("radio")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show in folder" }),
    );
    expect(onShowInFolder).toHaveBeenCalledWith(destination);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says why an export failed, and lets the person try again", async () => {
    const onExport = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failed",
        reason: "The file could not be written there.",
      })
      .mockResolvedValueOnce({ status: "cancelled" });
    const dialog = renderDialog(onExport);

    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The file could not be written there.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));
    expect(onExport).toHaveBeenCalledTimes(2);
  });

  it("holds the choice while a file is being written", async () => {
    let finish!: () => void;
    const dialog = renderDialog(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: "cancelled" });
        }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Export…" }));

    expect(
      within(dialog).getByRole("button", { name: "Exporting…" }),
    ).toBeDisabled();
    for (const radio of within(dialog).getAllByRole("radio"))
      expect(radio).toBeDisabled();
    finish();
    expect(
      await within(dialog).findByRole("button", { name: "Export…" }),
    ).toBeEnabled();
  });
});
