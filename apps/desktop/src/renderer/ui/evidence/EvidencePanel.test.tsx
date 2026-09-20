import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EvidenceState } from "@zhiyin/contract";
import { EvidencePanel } from "./EvidencePanel.js";

const evidence: EvidenceState = {
  corrections: {
    retainedEntries: 1,
    shownEntries: 1,
    maximumEntries: 5_000,
    entries: [
      {
        at: "2026-09-13T10:00:00.000Z",
        taskId: "task-1",
        taskTitle: "Prepare release",
        toolName: "multi_edit",
        kind: "repair-rejected",
        reason: "The repair changed protected content.",
        cause: "content-changed",
        before: '{"path":"notes.md"}',
        after: '{"path":"notes.md","replace_all":true}',
      },
    ],
  },
  recovery: {
    usedBytes: 6,
    retainedFiles: 1,
    excludedFiles: 2,
    limits: {
      totalBytes: 256 * 1024 * 1024,
      fileBytes: 10 * 1024 * 1024,
      versionsPerPath: 10,
      maximumAgeDays: 30,
    },
  },
  policy: {
    correctionRedaction:
      "Common credential fields are removed; arbitrary sensitive text cannot be detected reliably.",
    taskDeletion:
      "Deleting a conversation deletes its transcript, action evidence, and derived context.",
    privateStorage: "Private evidence is not added to telemetry.",
  },
};

const emptyEvidence: EvidenceState = {
  ...evidence,
  corrections: {
    retainedEntries: 0,
    shownEntries: 0,
    maximumEntries: 5_000,
    entries: [],
  },
  recovery: {
    ...evidence.recovery,
    usedBytes: 0,
    retainedFiles: 0,
    excludedFiles: 0,
  },
};

describe("EvidencePanel", () => {
  it("shows limits, exclusions, corrections, and explicit deletion", async () => {
    const clear = vi.fn(async () => ({
      ...evidence,
      recovery: { ...evidence.recovery, usedBytes: 0, retainedFiles: 0 },
    }));
    render(
      <EvidencePanel
        onClose={() => undefined}
        read={async () => evidence}
        clear={clear}
      />,
    );

    expect(await screen.findByText("File recovery")).toBeInTheDocument();
    expect(screen.getByText("6 B")).toBeInTheDocument();
    expect(screen.getByText(/256.0 MiB total/)).toBeInTheDocument();
    expect(screen.getByText("10.0 MiB")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(
      screen.getByText(/2 changed files have no saved copy/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 changes have no saved copy"),
    ).toBeInTheDocument();
    expect(screen.getByText("Prepare release")).toBeInTheDocument();
    expect(screen.getByText(/cannot be detected reliably/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete all recovery copies" }),
    );
    expect(screen.getByText(/This cannot be undone./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(clear).toHaveBeenCalledWith("recovery"));
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it("states how full the recovery store is without making the reader divide", async () => {
    render(
      <EvidencePanel
        onClose={() => undefined}
        read={async () => evidence}
        clear={async () => evidence}
      />,
    );

    const meter = await screen.findByRole("meter", {
      name: "Recovery storage used",
    });
    expect(meter).toHaveAttribute("aria-valuenow", "6");
    expect(meter).toHaveAttribute("aria-valuemax", String(256 * 1024 * 1024));
    expect(meter).toHaveAttribute("aria-valuetext", "6 B of 256.0 MiB");
  });

  it("says each correction in words, with the arguments it refused and repaired", async () => {
    render(
      <EvidencePanel
        onClose={() => undefined}
        read={async () => evidence}
        clear={async () => evidence}
      />,
    );

    expect(await screen.findByText("Repair rejected")).toBeInTheDocument();
    expect(screen.queryByText("repair-rejected")).toBeNull();
    expect(
      screen.getByText("It would have changed approved content"),
    ).toBeInTheDocument();
    expect(screen.queryByText("content-changed")).toBeNull();

    fireEvent.click(screen.getByText("Arguments"));
    expect(screen.getByText('{"path":"notes.md"}')).toBeInTheDocument();
    expect(
      screen.getByText('{"path":"notes.md","replace_all":true}'),
    ).toBeInTheDocument();
  });

  it("offers nothing to delete when nothing is being kept", async () => {
    render(
      <EvidencePanel
        onClose={() => undefined}
        read={async () => emptyEvidence}
        clear={async () => emptyEvidence}
      />,
    );

    expect(
      await screen.findByText("No correction has been made behind your back."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete all recovery copies" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete correction log" }),
    ).toBeDisabled();
  });

  it("reports a failed deletion instead of showing evidence as gone", async () => {
    render(
      <EvidencePanel
        onClose={() => undefined}
        read={async () => evidence}
        clear={async () => {
          throw new Error("The recovery store is in use.");
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete all recovery copies" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("The recovery store is in use."),
    ).toBeInTheDocument();
    expect(screen.getByText("6 B")).toBeInTheDocument();
  });
});
