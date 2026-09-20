import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RewindPreview } from "@zhiyin/contract";
import { RewindMessage } from "./RewindMessage.js";

const preview: RewindPreview = {
  id: "rewind-1",
  taskId: "task-1",
  messageId: "message-2",
  draft: "Change the second request",
  discardedMessages: 3,
  discardedActions: [
    {
      id: "action-2",
      action: "Run a shell command",
      target: "pnpm test",
      status: "completed",
      sequence: 4,
    },
  ],
  files: [],
};

describe("RewindMessage", () => {
  it("reviews a rewind and returns the message draft only after it commits", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    const committed = vi.fn();
    render(
      <RewindMessage
        taskId="task-1"
        messageId="message-2"
        bubble={<p>Change the second request</p>}
        onPreview={async () => preview}
        onCommit={commit}
        onCommitted={committed}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Rewind to this message" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Rewind conversation" }),
    ).toBeVisible();
    expect(
      screen.getByText("Current workspace files will stay as they are."),
    ).toBeVisible();
    expect(screen.getByText(/Run a shell command/)).toBeVisible();
    expect(committed).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Rewind conversation" }),
    );
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith("task-1", "rewind-1", "keep"),
    );
    expect(committed).toHaveBeenCalledWith("Change the second request", {
      files: [],
    });
  });

  it("offers restoration only for file effects that can be restored safely", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    render(
      <RewindMessage
        taskId="task-1"
        messageId="message-2"
        bubble={<p>Change it</p>}
        onPreview={async () => ({
          ...preview,
          files: [
            { path: "note.txt", action: "restore", status: "recoverable" },
            { path: "manual.txt", action: "restore", status: "conflict" },
          ],
        })}
        onCommit={commit}
        onCommitted={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rewind to this message" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("radio", { name: /Restore recoverable files/ }),
    );
    expect(screen.getByText(/will not be overwritten/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Rewind conversation" }),
    );
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith("task-1", "rewind-1", "restore"),
    );
  });

  it("leaves the conversation unchanged when review is cancelled", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    render(
      <RewindMessage
        taskId="task-1"
        messageId="message-2"
        bubble={<p>Change the second request</p>}
        onPreview={async () => preview}
        onCommit={commit}
        onCommitted={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rewind to this message" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Keep conversation" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
  });
});
