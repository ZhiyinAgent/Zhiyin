import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPermissions } from "./ConversationPermissions.js";
import type { WorkspaceTask } from "./workspaceState.js";

describe("conversation permissions panel", () => {
  it("lists each covered action and revokes the selected rule", async () => {
    const onRevoke = vi.fn(async () => {});
    const task: WorkspaceTask = {
      id: "task-1",
      title: "Prepare report",
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "draft" },
      conversationPermissions: [
        {
          id: "permission-1",
          kind: "file-folder",
          toolName: "write_file",
          label: "Changes to files in reports/",
          at: "2026-09-28T14:02:00.000Z",
          workspaceRoot: "C:/workspace",
          folder: "C:/workspace/reports",
        },
      ],
      actions: [
        {
          id: "action-1",
          action: "Edit report",
          target: "reports/one.md",
          status: "completed",
          approval: {
            by: "conversation-permission",
            at: "2026-09-28T14:03:00.000Z",
            permissionId: "permission-1",
            label: "Changes to files in reports/",
          },
        },
      ],
    };
    render(
      <ConversationPermissions
        task={task}
        onClose={() => {}}
        onRevoke={onRevoke}
      />,
    );
    expect(screen.getByText("Edit report · reports/one.md")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("permission-1"));
  });
});
