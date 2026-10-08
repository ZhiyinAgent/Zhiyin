import { fireEvent, render, screen } from "@testing-library/react";
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
    const download = vi.fn();
    const folder = vi.fn();
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
});
