import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewerHistoryGate } from "./NewerHistoryGate.js";

describe("NewerHistoryGate", () => {
  it("says which version saved a newer history and that nothing was changed", () => {
    const { container } = render(
      <NewerHistoryGate newer={{ writtenBy: "0.2.0" }} />,
    );

    expect(container.textContent).toMatch(/saved by Zhiyin 0\.2\.0/);
    expect(container.textContent).toMatch(/Nothing in it has been changed/);
    expect(container.textContent).not.toMatch(/clean slate|start again/i);
  });

  it("offers the newer version and the data folder, and nothing that changes the history", () => {
    const download = vi.fn(async () => {});
    const folder = vi.fn(async () => {});
    render(
      <NewerHistoryGate
        newer={{ writtenBy: "0.2.0" }}
        onGetLatest={download}
        onOpenDataFolder={folder}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Get the latest version" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    expect(download).toHaveBeenCalled();
    expect(folder).toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("says so when the release page or the data folder cannot be opened", async () => {
    render(
      <NewerHistoryGate
        newer={{ writtenBy: "0.2.0" }}
        onGetLatest={async () => {
          throw new Error("The page could not be opened.");
        }}
        onOpenDataFolder={async () => {
          throw new Error("The folder could not be opened.");
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Get the latest version" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The page could not be opened.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The folder could not be opened.",
      ),
    );
  });
});
