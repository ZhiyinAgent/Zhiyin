import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskArtifact } from "@zhiyin/contract";
import { ArtifactPanel } from "./ArtifactPanel.js";

const brief: TaskArtifact = {
  path: "reports/brief.md",
  name: "brief.md",
  change: "created",
  bytes: 1536,
  updatedAt: "2026-09-05T10:00:00.000Z",
};

const notes: TaskArtifact = {
  path: "notes.md",
  name: "notes.md",
  change: "updated",
  bytes: 240,
  updatedAt: "2026-09-05T10:05:00.000Z",
};

describe("ArtifactPanel", () => {
  it("shows nothing until the task has produced a file", () => {
    const { container } = render(
      <ArtifactPanel artifacts={[]} onPreview={vi.fn()} onExport={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("separates files it created from files it replaced", () => {
    render(
      <ArtifactPanel
        artifacts={[brief, notes]}
        onPreview={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText("Created by this task · 1.5 KB")).toBeVisible();
    expect(
      screen.getByText("Replaced an existing file · 240 bytes"),
    ).toBeVisible();
    expect(screen.getByText("reports/brief.md")).toBeVisible();
  });

  it("opens a produced file for review and says when it is shortened", async () => {
    const onPreview = vi.fn(async () => ({
      status: "ready" as const,
      path: brief.path,
      text: "The opening paragraph.",
      truncated: true,
    }));
    render(
      <ArtifactPanel
        artifacts={[brief]}
        onPreview={onPreview}
        onExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /brief\.md/ }));

    expect(onPreview).toHaveBeenCalledWith("reports/brief.md");
    expect(await screen.findByText("The opening paragraph.")).toBeVisible();
    expect(
      screen.getByText(
        "Only the beginning is shown here. Save a copy to read all of it.",
      ),
    ).toBeVisible();
  });

  it("explains a produced file that is no longer in the workspace", async () => {
    render(
      <ArtifactPanel
        artifacts={[brief]}
        onPreview={async () => ({
          status: "missing",
          path: brief.path,
          reason: "brief.md is no longer in the workspace.",
        })}
        onExport={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /brief\.md/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "brief.md is no longer in the workspace.",
    );
  });

  it("reports a failed save instead of showing the copy as written", async () => {
    render(
      <ArtifactPanel
        artifacts={[brief]}
        onPreview={vi.fn()}
        onExport={async () => ({
          status: "failed",
          reason: "brief.md could not be saved to that location.",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "brief.md could not be saved to that location.",
    );
    expect(screen.queryByText(/Saved a copy/)).toBeNull();
  });

  it("names where a copy was saved and stays quiet when the choice is cancelled", async () => {
    const onExport = vi
      .fn()
      .mockResolvedValueOnce({
        status: "saved",
        destination: "C:\\Users\\sam\\Desktop\\brief.md",
      })
      .mockResolvedValueOnce({ status: "cancelled" });
    render(
      <ArtifactPanel
        artifacts={[brief]}
        onPreview={vi.fn()}
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved a copy to C:\\Users\\sam\\Desktop\\brief.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not start a second save while one is still running", async () => {
    let release = (): void => undefined;
    const onExport = vi.fn(
      async () =>
        new Promise<{ status: "cancelled" }>((resolve) => {
          release = () => resolve({ status: "cancelled" });
        }),
    );
    render(
      <ArtifactPanel
        artifacts={[brief]}
        onPreview={vi.fn()}
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    expect(
      await screen.findByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    release();
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
  });
});
